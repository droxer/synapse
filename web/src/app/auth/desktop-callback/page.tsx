"use client";

import { useEffect, useRef, useState } from "react";
import { useSearchParams } from "next/navigation";
import { useSession } from "next-auth/react";
import { Suspense } from "react";
import { Logo } from "@/shared/components/Logo";

/**
 * Desktop OAuth callback page.
 *
 * Loaded in the system browser after Google OAuth completes.
 * Reads the NextAuth session, then posts the user data to the
 * desktop-token API keyed by the nonce that the Tauri webview
 * is polling.
 */
function CallbackContent() {
  const { data: session, status } = useSession();
  const searchParams = useSearchParams();
  const nonce = searchParams.get("nonce");
  const deepLinkHref = nonce
    ? `synapse://auth/callback?nonce=${encodeURIComponent(nonce)}`
    : "";
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const handoffStarted = useRef(false);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user || !nonce) return;
    if (handoffStarted.current) return;
    handoffStarted.current = true;

    const payload = {
      nonce,
    };

    fetch("/api/auth/desktop-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        const body = await res.text();
        if (res.ok) {
          setDone(true);
          window.location.href = deepLinkHref;
        } else {
          setError(`Handoff failed: ${res.status} ${body}`);
        }
      })
      .catch((err) => {
        console.error("[desktop-callback] Fetch error:", err);
        setError(`Server error: ${err.message}`);
      });
  }, [deepLinkHref, session, status, nonce]);

  return (
    <div className="flex min-h-screen items-center justify-center bg-background px-4">
      <div className="surface-panel w-full max-w-md px-6 py-8 text-center">
        <div className="flex flex-col items-center gap-4">
          <Logo size={48} tone="auto" className="rounded-lg" />
          {status === "loading" && (
            <>
              <div className="h-5 w-5 rounded skeleton-shimmer bg-muted" />
              <p className="text-sm text-muted-foreground">Verifying session...</p>
            </>
          )}
          {error && <p className="text-sm text-destructive">{error}</p>}
          {!nonce && status !== "loading" && (
            <p className="text-sm text-destructive">Missing nonce parameter</p>
          )}
          {done && (
            <>
              <p className="text-sm text-muted-foreground">
                Sign in successful! Opening the Synapse desktop app...
              </p>
              {deepLinkHref && (
                <a
                  className="text-sm font-medium text-primary underline-offset-4 hover:underline"
                  href={deepLinkHref}
                >
                  Open desktop app
                </a>
              )}
              <p className="text-xs text-muted-foreground-dim">
                You can close this browser tab.
              </p>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

export default function DesktopCallbackPage() {
  return (
    <Suspense
      fallback={
        <div className="flex min-h-screen items-center justify-center bg-background">
          <div className="h-6 w-6 rounded skeleton-shimmer bg-muted" />
        </div>
      }
    >
      <CallbackContent />
    </Suspense>
  );
}
