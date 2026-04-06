"use client";

import { useEffect, useState } from "react";
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
  const [done, setDone] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (status !== "authenticated" || !session?.user || !nonce) return;

    const user = session.user as {
      email?: string;
      name?: string;
      image?: string;
      googleId?: string;
    };

    const payload = {
      nonce,
      email: user.email ?? "",
      name: user.name ?? "",
      image: user.image ?? "",
      googleId: user.googleId ?? "",
    };
    console.log("[desktop-callback] Posting token with nonce:", nonce, payload);

    fetch("/api/auth/desktop-token", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(payload),
    })
      .then(async (res) => {
        const body = await res.text();
        console.log("[desktop-callback] Response:", res.status, body);
        if (res.ok) {
          setDone(true);
        } else {
          setError(`Handoff failed: ${res.status} ${body}`);
        }
      })
      .catch((err) => {
        console.error("[desktop-callback] Fetch error:", err);
        setError(`Server error: ${err.message}`);
      });
  }, [session, status, nonce]);

  return (
    <div className="flex min-h-screen flex-col items-center justify-center gap-4 bg-background">
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
            Sign in successful! Return to the Synapse desktop app.
          </p>
          <p className="text-xs text-muted-foreground-dim">
            You can close this browser tab.
          </p>
        </>
      )}
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
