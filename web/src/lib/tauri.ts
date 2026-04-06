/**
 * Tauri desktop integration utilities.
 *
 * These functions are safe to call in both browser and Tauri contexts —
 * they no-op gracefully when not running inside Tauri.
 */

/** Check if the app is running inside a Tauri desktop shell. */
export function isTauri(): boolean {
  if (typeof window === "undefined") return false;

  // Primary check: Tauri injects this when withGlobalTauri is true
  if ("__TAURI_INTERNALS__" in window) return true;

  // Fallback 1: URL param set by the proxy/middleware redirect
  const params = new URLSearchParams(window.location.search);
  if (params.get("desktop") === "1") return true;

  // Fallback 2: localStorage flag persisted by DesktopModeDetector
  try {
    return localStorage.getItem("synapse-desktop") === "1";
  } catch {
    return false;
  }
}

/**
 * Open a URL in the system browser (not the Tauri webview).
 *
 * When running on localhost inside Tauri's webview, __TAURI_INTERNALS__
 * is not available, so we call our custom `open_url` Tauri command
 * which uses the `open` crate to launch the OS default browser.
 */
export async function openInSystemBrowser(url: string): Promise<void> {
  if (typeof window === "undefined") return;

  // Try all Tauri paths if we detect desktop mode
  if (isTauri()) {
    // Path 1: Tauri shell plugin (requires ACL permission)
    if ("__TAURI_INTERNALS__" in window) {
      try {
        const { open } = await import("@tauri-apps/plugin-shell");
        await open(url);
        return;
      } catch {
        // ACL may block this — fall through to custom command
      }
    }

    // Path 2: Custom open_url command (uses `open` crate, no ACL needed)
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      await invoke("open_url", { url });
      return;
    } catch (e) {
      console.error("[tauri] invoke open_url failed:", e);
    }
  }

  // Path 3: Not in Tauri at all — standard browser behavior
  window.open(url, "_blank");
}

/**
 * Get the configured frontend URL from the Tauri backend.
 * Returns the current origin in non-Tauri environments.
 */
export async function getFrontendUrl(): Promise<string> {
  if (typeof window === "undefined") return "http://localhost:3000";

  if ("__TAURI_INTERNALS__" in window) {
    try {
      const { invoke } = await import("@tauri-apps/api/core");
      return await invoke<string>("get_frontend_url");
    } catch {
      // Fall through
    }
  }

  return window.location.origin;
}
