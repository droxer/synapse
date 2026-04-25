import NextAuth from "next-auth";
import Google from "next-auth/providers/google";
import Credentials from "next-auth/providers/credentials";
import { authorizeDesktopTokenCredentials } from "@/lib/desktop-auth-credentials";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
const PROXY_SECRET = process.env.PROXY_SECRET ?? "";
const BACKEND_API_KEY = process.env.API_KEY ?? "";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [
    Google,
    Credentials({
      id: "desktop-token",
      name: "Desktop Token",
      credentials: {
        token: { type: "text" },
      },
      async authorize(credentials) {
        return authorizeDesktopTokenCredentials(credentials);
      },
    }),
  ],

  session: {
    strategy: "jwt",
  },

  callbacks: {
    async jwt({ token, user, account, profile }) {
      // Desktop token sign-in: user data comes from credentials, not Google profile
      if (account?.provider === "desktop-token" && user) {
        token.googleId = user.id;
        token.picture = user.image;
        token.userId = user.id;

        // Sync to backend
        try {
          const syncHeaders: Record<string, string> = {
            "X-User-Google-Id": user.id ?? "",
            "X-User-Email": user.email ?? "",
            "X-User-Name": user.name ?? "",
            "X-User-Picture": user.image ?? "",
          };
          if (PROXY_SECRET) {
            syncHeaders["X-Proxy-Secret"] = PROXY_SECRET;
          }
          if (BACKEND_API_KEY) {
            syncHeaders.Authorization = `Bearer ${BACKEND_API_KEY}`;
          }
          await fetch(`${BACKEND_URL}/auth/me`, {
            method: "POST",
            headers: syncHeaders,
          });
        } catch (err) {
          console.error("[auth] Failed to sync desktop user to backend:", err);
        }
        return token;
      }

      // On initial sign-in, persist Google profile data in the JWT
      // and sync user record to backend
      if (account && profile) {
        token.googleId = profile.sub ?? undefined;
        token.picture = profile.picture as string | undefined;

        // Sync to backend — fires only on initial sign-in
        try {
          const syncHeaders: Record<string, string> = {
            "X-User-Google-Id": profile.sub ?? "",
            "X-User-Email": profile.email ?? user?.email ?? "",
            "X-User-Name": profile.name ?? user?.name ?? "",
            "X-User-Picture": (profile.picture as string) ?? user?.image ?? "",
          };
          if (PROXY_SECRET) {
            syncHeaders["X-Proxy-Secret"] = PROXY_SECRET;
          }
          if (BACKEND_API_KEY) {
            syncHeaders.Authorization = `Bearer ${BACKEND_API_KEY}`;
          }
          const res = await fetch(`${BACKEND_URL}/auth/me`, {
            method: "POST",
            headers: syncHeaders,
          });
          if (!res.ok) {
            const body = await res.text();
            console.error("[auth] backend sync failed:", res.status, body);
          }
        } catch (err) {
          console.error("[auth] Failed to sync user to backend:", err);
        }
      }
      if (user) {
        token.userId = user.id;
      }
      return token;
    },

    session({ session, token }) {
      if (token.userId) {
        session.user.id = token.userId as string;
      }
      if (token.googleId) {
        session.user.googleId = token.googleId as string;
      } else if (token.userId) {
        session.user.googleId = token.userId as string;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
});
