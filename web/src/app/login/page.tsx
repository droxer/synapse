"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useCallback, useEffect, useRef, useState } from "react";
import { AlertCircle } from "lucide-react";
import { Logo } from "@/shared/components/Logo";
import { Button } from "@/shared/components/ui/button";
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
          if (data.status === "complete" && data.token) {
            // Sign in to the webview's own NextAuth session using
            // the desktop-token credentials provider
            const result = await signIn("desktop-token", {
              redirect: false,
              token: data.token,
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
    <main id="main" className="flex min-h-screen items-center justify-center bg-background px-4 py-8">
      <div className="w-full max-w-md">
        <div className="overflow-hidden rounded-xl border border-border bg-card">
          <div className="px-8 py-6 sm:px-9">
            <div className="flex items-center gap-3">
              <Logo size={56} tone="auto" className="rounded-lg" />
              <div>
                <p className="brand-wordmark">{`Synapse`}</p>
                <p className="mt-1 text-caption text-muted-foreground">
                  Workspace sign-in
                </p>
              </div>
            </div>
          </div>
          <div className="px-8 pb-8 sm:px-9 sm:pb-9">
            <div className="flex flex-col gap-6">

              <div className="space-y-2">
                <p className="label-mono text-muted-foreground-dim">Account Access</p>
                <h1 className="text-2xl font-semibold tracking-tight text-foreground sm:text-[1.9rem]">
                  Welcome to Synapse
                </h1>
                <p className="text-sm text-muted-foreground">
                  Sign in to continue
                </p>
              </div>

            {/* Error message */}
            {error && (
              <div
                role="alert"
                className="flex w-full items-start gap-2 rounded-lg border border-destructive bg-destructive/10 px-4 py-3 text-sm text-destructive"
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
                <div className="w-full">
                  <Button
                    type="button"
                    onClick={handleSignIn}
                    disabled={isLoading}
                    variant="outline"
                    size="lg"
                    className="w-full justify-center gap-3 border-border-strong bg-background hover:border-border-active hover:bg-secondary"
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
                  </Button>
                </div>
              )}

            {/* Desktop: waiting for browser auth */}
              {waitingForBrowser && (
                <div className="flex w-full flex-col items-center gap-3 rounded-lg bg-muted/50 px-4 py-4 text-center">
                  <span role="status">
                    <div className="h-5 w-5 rounded skeleton-shimmer bg-muted" />
                    <span className="sr-only">Waiting for browser authentication...</span>
                  </span>
                  <p className="text-sm text-muted-foreground">
                    Complete sign-in in your browser, then return here.
                  </p>
                  <Button
                    type="button"
                    onClick={() => {
                      if (pollingRef.current) {
                        clearInterval(pollingRef.current);
                        pollingRef.current = null;
                      }
                      setWaitingForBrowser(false);
                    }}
                    variant="ghost"
                    size="sm"
                    className="text-xs text-muted-foreground-dim hover:text-foreground"
                  >
                    Cancel
                  </Button>
                </div>
              )}
            </div>
          </div>
        </div>
      </div>
    </main>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background" role="status">
          <div className="h-8 w-full max-w-md rounded skeleton-shimmer bg-muted" />
          <span className="sr-only">Loading...</span>
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
