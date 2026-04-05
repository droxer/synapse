import { auth } from "@/lib/auth";
import { NextResponse } from "next/server";

export default auth((req) => {
  const { nextUrl, auth: session } = req;
  const isLoggedIn = !!session?.user;
  const isLoginPage = nextUrl.pathname === "/login";
  const isApiRoute = nextUrl.pathname.startsWith("/api/");
  const isDesktopCallback = nextUrl.pathname === "/auth/desktop-callback";

  // Never redirect API routes — let route handlers manage auth
  if (isApiRoute) {
    return NextResponse.next();
  }

  // Allow unauthenticated access to the desktop OAuth callback page.
  // This page is loaded in the system browser after Google OAuth and
  // triggers a deep link back to the Tauri app.
  if (isDesktopCallback) {
    return NextResponse.next();
  }

  // Redirect authenticated users away from login page
  if (isLoginPage && isLoggedIn) {
    return NextResponse.redirect(new URL("/", nextUrl));
  }

  // Allow unauthenticated access to login page
  if (isLoginPage) {
    return NextResponse.next();
  }

  // Redirect unauthenticated users to login (preserve query string)
  if (!isLoggedIn) {
    const loginUrl = new URL("/login", nextUrl);
    loginUrl.searchParams.set(
      "callbackUrl",
      nextUrl.pathname + nextUrl.search,
    );
    // Preserve desktop flag so the login page can detect Tauri mode
    if (nextUrl.searchParams.get("desktop") === "1") {
      loginUrl.searchParams.set("desktop", "1");
    }
    return NextResponse.redirect(loginUrl);
  }

  return NextResponse.next();
});

export const config = {
  matcher: [
    "/((?!_next/static|_next/image|favicon.ico|favicon-16.png|favicon-32.png|favicon-dark-16.png|favicon-dark-32.png|favicon-light.svg|favicon-dark.svg|apple-touch-icon.png|apple-touch-icon-dark.png).*)",
  ],
};
