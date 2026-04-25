import { NextResponse } from "next/server";
import { getAuthenticatedDesktopAuthUser } from "@/lib/desktop-auth-session";
import {
  issueDesktopAuthExchangeToken,
  storeDesktopAuthSession,
} from "@/lib/desktop-auth-store";

/**
 * Desktop auth handoff endpoint.
 *
 * The system-browser callback stores the authenticated user under a nonce.
 * The Tauri webview consumes that nonce and receives an opaque, single-use
 * exchange token for the NextAuth credentials provider.
 */
export async function POST(req: Request) {
  const body = await req.json().catch(() => null);
  const nonce = typeof body?.nonce === "string" ? body.nonce : "";

  if (!nonce) {
    return NextResponse.json({ error: "Missing nonce" }, { status: 400 });
  }

  const user = await getAuthenticatedDesktopAuthUser();
  if (!user) {
    return NextResponse.json({ error: "Not authenticated" }, { status: 401 });
  }

  storeDesktopAuthSession(nonce, user);

  return NextResponse.json({ ok: true });
}

/**
 * GET /api/auth/desktop-token?nonce=xxx
 * Called by the Tauri webview to check if OAuth completed.
 * Returns an opaque exchange token if available, 404 otherwise.
 * Single-use: deletes the entry after successful retrieval.
 */
export async function GET(req: Request) {
  const { searchParams } = new URL(req.url);
  const nonce = searchParams.get("nonce");

  if (!nonce) {
    return NextResponse.json({ error: "Missing nonce" }, { status: 400 });
  }

  const token = issueDesktopAuthExchangeToken(nonce);
  if (!token) {
    return NextResponse.json({ status: "pending" }, { status: 404 });
  }

  return NextResponse.json({ status: "complete", token });
}
