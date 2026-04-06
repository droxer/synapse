"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Logo } from "@/shared/components/Logo";
import { isTauri, openInSystemBrowser, getFrontendUrl } from "@/lib/tauri";

function LoginForm() {
  const searchParams = useSearchParams();
  const rawCallback = searchParams.get("callbackUrl") ?? "/";
  // Validate callbackUrl is a safe relative path (prevent open redirect)
  const callbackUrl =
    rawCallback.startsWith("/") && !rawCallback.startsWith("//")
      ? rawCallback
      : "/";
  const error = searchParams.get("error");
  const [isLoading, setIsLoading] = useState(false);
  const [waitingForBrowser, setWaitingForBrowser] = useState(false);
  const pollingRef = useRef<ReturnType<typeof setInterval> | null>(null);

  // When opened in the system browser with fromDesktop=1, auto-trigger
  // Google sign-in with the desktop callback as the redirect target.
  const fromDesktop = searchParams.get("fromDesktop") === "1";
  const nonce = searchParams.get("nonce");
  const autoTriggered = useRef(false);

  useEffect(() => {
    if (fromDesktop && nonce && !autoTriggered.current) {
      autoTriggered.current = true;
      signIn("google", {
        callbackUrl: `/auth/desktop-callback?nonce=${encodeURIComponent(nonce)}`,
      });
    }
  }, [fromDesktop, nonce]);

  // Poll for desktop auth completion
  const startPolling = useCallback((authNonce: string) => {
    if (pollingRef.current) return;

    let attempts = 0;
    pollingRef.current = setInterval(async () => {
      attempts++;
      if (attempts > 120) {
        // Stop after 2 minutes
        if (pollingRef.current) clearInterval(pollingRef.current);
        pollingRef.current = null;
        setWaitingForBrowser(false);
        return;
      }

      try {
        const res = await fetch(
          `/api/auth/desktop-token?nonce=${encodeURIComponent(authNonce)}`
        );
        if (res.ok) {
          if (pollingRef.current) clearInterval(pollingRef.current);
          pollingRef.current = null;

          const data = await res.json();
          if (data.status === "complete" && data.user) {
            // Sign in to the webview's own NextAuth session using
            // the desktop-token credentials provider
            const result = await signIn("desktop-token", {
              redirect: false,
              email: data.user.email,
              name: data.user.name,
              image: data.user.image,
              googleId: data.user.googleId,
            });

            if (result?.error) {
              setWaitingForBrowser(false);
              return;
            }

            // Reload to home — webview now has its own session cookie
            window.location.href = "/";
          }
        }
      } catch {
        // Network error, keep trying
      }
    }, 1000);
  }, []);

  // Cleanup polling on unmount
  useEffect(() => {
    return () => {
      if (pollingRef.current) clearInterval(pollingRef.current);
    };
  }, []);

  const handleSignIn = async () => {
    setIsLoading(true);

    if (isTauri()) {
      // Generate a nonce to correlate the browser OAuth with this webview
      const authNonce = crypto.randomUUID();

      // Open the login page in the system browser with the nonce
      const baseUrl = await getFrontendUrl();
      const authUrl =
        `${baseUrl}/login?fromDesktop=1` +
        `&nonce=${encodeURIComponent(authNonce)}` +
        `&callbackUrl=${encodeURIComponent("/auth/desktop-callback?nonce=" + authNonce)}`;
      await openInSystemBrowser(authUrl);

      setIsLoading(false);
      setWaitingForBrowser(true);

      // Start polling for the token
      startPolling(authNonce);
      return;
    }

    // Normal browser flow
    if (fromDesktop && nonce) {
      signIn("google", {
        callbackUrl: `/auth/desktop-callback?nonce=${encodeURIComponent(nonce)}`,
      });
      return;
    }

    signIn("google", { callbackUrl });
  };

  return (
    <div className="welcome-radial-bg relative flex min-h-screen items-center justify-center px-4">
      <div className="pointer-events-none absolute inset-0 dot-grid-bg opacity-40" aria-hidden="true" />
      <div className="relative z-10 w-full max-w-sm">
        {/* Card */}
        <div className="relative overflow-hidden rounded-xl border border-border bg-card p-8 shadow-[var(--shadow-elevated)] sm:p-10">
          {/* Brand gradient top strip */}
          <div
            className="absolute inset-x-0 top-0 h-0.5 rounded-t-xl"
            style={{ background: "linear-gradient(90deg, var(--color-accent-purple), var(--color-accent-emerald))" }}
            aria-hidden="true"
          />
          {/* Faint inner dot-grid */}
          <div className="pointer-events-none absolute inset-0 dot-grid-bg opacity-[0.18]" aria-hidden="true" />
          <div className="relative z-10 flex flex-col items-center gap-6">
            {/* Logo with animated glow */}
            <div
              className="rounded-xl"
              style={{ animation: "fadeIn 0.5s ease-out both, glowPulse 3s ease-in-out 0.5s infinite" }}
            >
              <Logo size={64} className="rounded-xl" />
            </div>

            {/* Title block */}
            <div
              className=" text-center"
              style={{ animationFillMode: "both" }}
            >
              <h1 className="text-2xl sm:text-3xl font-semibold tracking-[-0.04em] leading-tight text-foreground">
                Welcome to Synapse
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign in to continue
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div
                role="alert"
                className="flex w-full items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive "
                style={{ animationFillMode: "both" }}
              >
                <AlertCircle className="mt-0.5 h-4 w-4 shrink-0" />
                <span>
                  {error === "OAuthAccountNotLinked"
                    ? "This email is already associated with another account."
                    : "An error occurred during sign in. Please try again."}
                </span>
              </div>
            )}

            {/* Google sign in button */}
            {!waitingForBrowser && (
              <div
                className="w-full "
                style={{ animationFillMode: "both" }}
              >
                <button
                  type="button"
                  onClick={handleSignIn}
                  disabled={isLoading}
                  className="flex w-full items-center justify-center gap-3 rounded-lg border border-border-strong bg-card px-4 py-3 text-sm font-medium text-foreground transition-[color,background-color,border-color,transform] duration-200 ease-out hover:border-border-active hover:bg-secondary active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring focus-visible:ring-offset-2 focus-visible:ring-offset-background"
                >
                  {isLoading ? (
                    <span role="status">
                      <div className="h-5 w-5 rounded skeleton-shimmer bg-primary-foreground/20" />
                      <span className="sr-only">Signing in...</span>
                    </span>
                  ) : (
                    <svg
                      className="h-5 w-5"
                      viewBox="0 0 24 24"
                      aria-hidden="true"
                      focusable="false"
                    >
                      <path
                        d="M22.56 12.25c0-.78-.07-1.53-.2-2.25H12v4.26h5.92a5.06 5.06 0 0 1-2.2 3.32v2.77h3.57c2.08-1.92 3.28-4.74 3.28-8.1z"
                        fill="#4285F4"
                      />
                      <path
                        d="M12 23c2.97 0 5.46-.98 7.28-2.66l-3.57-2.77c-.98.66-2.23 1.06-3.71 1.06-2.86 0-5.29-1.93-6.16-4.53H2.18v2.84C3.99 20.53 7.7 23 12 23z"
                        fill="#34A853"
                      />
                      <path
                        d="M5.84 14.09c-.22-.66-.35-1.36-.35-2.09s.13-1.43.35-2.09V7.07H2.18C1.43 8.55 1 10.22 1 12s.43 3.45 1.18 4.93l2.85-2.22.81-.62z"
                        fill="#FBBC05"
                      />
                      <path
                        d="M12 5.38c1.62 0 3.06.56 4.21 1.64l3.15-3.15C17.45 2.09 14.97 1 12 1 7.7 1 3.99 3.47 2.18 7.07l3.66 2.84c.87-2.6 3.3-4.53 6.16-4.53z"
                        fill="#EA4335"
                      />
                    </svg>
                  )}
                  {isLoading ? "Signing in…" : "Sign in with Google"}
                </button>
              </div>
            )}

            {/* Desktop: waiting for browser auth */}
            {waitingForBrowser && (
              <div className="flex w-full flex-col items-center gap-2 text-center ">
                <span role="status">
                  <div className="h-5 w-5 rounded skeleton-shimmer bg-muted" />
                  <span className="sr-only">Waiting for browser authentication...</span>
                </span>
                <p className="text-sm text-muted-foreground">
                  Complete sign-in in your browser, then return here.
                </p>
              </div>
            )}
          </div>
        </div>

        {/* Footer flourish */}
        <p
          className="mt-6 text-center text-xs text-muted-foreground-dim "
          style={{ animationFillMode: "both" }}
        >
          <span>Secure</span>
          <span className="mx-2 inline-block h-1 w-1 rounded-full bg-muted-foreground/30 align-middle" aria-hidden="true" />
          <span>Private</span>
          <span className="mx-2 inline-block h-1 w-1 rounded-full bg-muted-foreground/30 align-middle" aria-hidden="true" />
          <span>Powerful</span>
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="welcome-radial-bg relative flex min-h-screen items-center justify-center" role="status">
          <div className="pointer-events-none absolute inset-0 dot-grid-bg opacity-40" aria-hidden="true" />
          <div className="relative z-10 h-8 w-full max-w-sm rounded skeleton-shimmer bg-muted" />
          <span className="sr-only">Loading...</span>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
