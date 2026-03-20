"use client";

import { signIn } from "next-auth/react";
import { useSearchParams } from "next/navigation";
import { Suspense, useState } from "react";
import { AlertCircle, Loader2 } from "lucide-react";
import { Logo } from "@/shared/components/Logo";

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

  const handleSignIn = () => {
    setIsLoading(true);
    signIn("google", { callbackUrl });
  };

  return (
    <div className="welcome-radial-bg flex min-h-screen items-center justify-center px-4">
      <div className="w-full max-w-sm">
        {/* Card */}
        <div className="rounded-2xl border border-border bg-card p-8 shadow-[var(--shadow-elevated)] sm:p-10">
          <div className="flex flex-col items-center gap-6">
            {/* Logo with purple glow */}
            <div
              className="animate-[fadeIn_0.5s_ease-out]"
              style={{ animationFillMode: "both" }}
            >
              <div className="rounded-xl shadow-[0_0_24px_rgba(139,92,246,0.15)]">
                <Logo size={56} className="rounded-xl" />
              </div>
            </div>

            {/* Title block */}
            <div
              className="animate-[fadeIn_0.5s_ease-out_0.1s] text-center"
              style={{ animationFillMode: "both" }}
            >
              <h1 className="text-2xl font-semibold tracking-[-0.03em] text-foreground">
                Welcome to HiAgent
              </h1>
              <p className="mt-2 text-sm text-muted-foreground">
                Sign in to continue
              </p>
            </div>

            {/* Error message */}
            {error && (
              <div
                className="flex w-full items-start gap-2 rounded-lg border border-destructive/50 bg-destructive/10 px-4 py-3 text-sm text-destructive animate-[slideUp_0.3s_ease-out]"
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
            <div
              className="w-full animate-[slideUp_0.4s_ease-out_0.2s]"
              style={{ animationFillMode: "both" }}
            >
              <button
                type="button"
                onClick={handleSignIn}
                disabled={isLoading}
                className="flex w-full items-center justify-center gap-3 rounded-lg border border-border bg-card px-4 py-3 text-sm font-medium text-foreground shadow-sm transition-all duration-200 hover:border-[var(--border-strong,var(--border))] hover:shadow-[var(--shadow-card-hover)] active:scale-[0.98] disabled:cursor-not-allowed disabled:opacity-60 focus-visible:outline-none focus-visible:ring-2 focus-visible:ring-ring"
              >
                {isLoading ? (
                  <Loader2 className="h-5 w-5 animate-spin" />
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
          </div>
        </div>

        {/* Footer flourish */}
        <p
          className="mt-6 text-center text-xs text-muted-foreground/50 animate-[fadeIn_0.5s_ease-out_0.4s]"
          style={{ animationFillMode: "both" }}
        >
          Secure · Private · Powerful
        </p>
      </div>
    </div>
  );
}

export default function LoginPage() {
  return (
    <Suspense
      fallback={
        <div className="welcome-radial-bg flex min-h-screen items-center justify-center">
          <div className="h-8 w-8 animate-spin rounded-full border-2 border-muted-foreground border-t-transparent" />
        </div>
      }
    >
      <LoginForm />
    </Suspense>
  );
}
