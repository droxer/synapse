import { auth } from "@/lib/auth";
import { NextRequest, NextResponse } from "next/server";

const BACKEND_URL = process.env.BACKEND_URL ?? "http://127.0.0.1:8000";
const PROXY_SECRET = process.env.PROXY_SECRET ?? "";

/**
 * Proxy all /api/* requests (except /api/auth/*) to the FastAPI backend.
 * Injects X-User-* headers from the NextAuth session and the shared
 * PROXY_SECRET so the backend can verify the request origin.
 */
async function handler(req: NextRequest) {
  const session = await auth();

  // Debug: log session state for API requests
  if (process.env.NODE_ENV === "development") {
    const { pathname } = req.nextUrl;
    console.log("[proxy]", req.method, pathname, {
      hasSession: !!session,
      user: session?.user?.email ?? "none",
      googleId: session?.user?.googleId ?? "none",
    });
  }

  // Build the backend URL: /api/conversations/123 → http://backend/conversations/123
  const { pathname, search } = req.nextUrl;
  const backendPath = pathname.replace(/^\/api/, "");
  const url = `${BACKEND_URL}${backendPath}${search}`;

  // Forward original headers, inject user identity + proxy secret
  const headers = new Headers(req.headers);
  headers.delete("host");

  // Inject proxy secret for backend verification
  if (PROXY_SECRET) {
    headers.set("X-Proxy-Secret", PROXY_SECRET);
  }

  if (session?.user) {
    headers.set("X-User-Email", session.user.email ?? "");
    headers.set("X-User-Name", session.user.name ?? "");
    headers.set("X-User-Picture", session.user.image ?? "");
    headers.set("X-User-Google-Id", session.user.googleId ?? "");
  }

  try {
    // Stream SSE responses
    if (req.headers.get("accept")?.includes("text/event-stream")) {
      const backendResponse = await fetch(url, {
        method: req.method,
        headers,
        duplex: "half",
      } as RequestInit & { duplex: "half" });

      // Forward upstream headers, override streaming-specific ones
      const sseHeaders = new Headers(backendResponse.headers);
      sseHeaders.delete("transfer-encoding");
      sseHeaders.set("Content-Type", "text/event-stream");
      sseHeaders.set("Cache-Control", "no-cache");
      sseHeaders.set("Connection", "keep-alive");
      sseHeaders.set("X-Accel-Buffering", "no");

      return new NextResponse(backendResponse.body, {
        status: backendResponse.status,
        headers: sseHeaders,
      });
    }

    // Regular requests: forward body as-is
    const body =
      req.method !== "GET" && req.method !== "HEAD"
        ? await req.blob()
        : undefined;

    const backendResponse = await fetch(url, {
      method: req.method,
      headers,
      body,
    });

    // Forward the response back to the client
    const responseHeaders = new Headers(backendResponse.headers);
    responseHeaders.delete("transfer-encoding");

    return new NextResponse(backendResponse.body, {
      status: backendResponse.status,
      statusText: backendResponse.statusText,
      headers: responseHeaders,
    });
  } catch (err) {
    console.error("[proxy] backend request failed", {
      url,
      method: req.method,
      error: err,
    });
    return NextResponse.json(
      { error: "Backend unavailable" },
      { status: 502 },
    );
  }
}

export const GET = handler;
export const POST = handler;
export const PUT = handler;
export const PATCH = handler;
export const DELETE = handler;

export const runtime = "nodejs";
