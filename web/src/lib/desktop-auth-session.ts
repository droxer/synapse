import type { DesktopAuthUser } from "@/lib/desktop-auth-store";

type DesktopAuthUserResolver = () => Promise<DesktopAuthUser | null>;

let desktopAuthUserResolverForTests: DesktopAuthUserResolver | null = null;

export function setDesktopAuthUserResolverForTests(
  resolver: DesktopAuthUserResolver | null,
): void {
  desktopAuthUserResolverForTests = resolver;
}

export async function getAuthenticatedDesktopAuthUser(): Promise<DesktopAuthUser | null> {
  if (desktopAuthUserResolverForTests) {
    return desktopAuthUserResolverForTests();
  }

  const { auth } = await import("@/lib/auth");
  const session = await auth();
  if (!session?.user?.email) {
    return null;
  }

  return {
    email: session.user.email,
    name: session.user.name ?? "",
    image: session.user.image ?? "",
    googleId: session.user.googleId ?? session.user.id ?? "",
  };
}
