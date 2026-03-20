import NextAuth from "next-auth";
import Google from "next-auth/providers/google";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
const PROXY_SECRET = process.env.PROXY_SECRET ?? "";

export const { handlers, auth, signIn, signOut } = NextAuth({
  providers: [Google],

  session: {
    strategy: "jwt",
  },

  callbacks: {
    async jwt({ token, user, account, profile }) {
      // On initial sign-in, persist Google profile data in the JWT
      // and sync user record to backend
      if (account && profile) {
        token.googleId = profile.sub;
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
        (session.user as { googleId?: string }).googleId =
          token.googleId as string;
      }
      return session;
    },
  },

  pages: {
    signIn: "/login",
  },
});
