import {
  consumeDesktopAuthExchangeToken,
  type DesktopAuthUser,
} from "@/lib/desktop-auth-store";

export function authorizeDesktopTokenCredentials(
  credentials: Partial<Record<string, unknown>> | undefined,
) {
  const token = typeof credentials?.token === "string" ? credentials.token : "";
  if (!token) return null;

  const user = consumeDesktopAuthExchangeToken(token);
  if (!user?.email) return null;

  return desktopAuthUserToNextAuthUser(user);
}

function desktopAuthUserToNextAuthUser(user: DesktopAuthUser) {
  const id = user.googleId || user.email;
  return {
    id,
    email: user.email,
    name: user.name,
    image: user.image,
    googleId: user.googleId || undefined,
  };
}
