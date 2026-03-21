import { useCallback, useEffect, useRef } from "react";
import { useSession } from "next-auth/react";
import { useTheme } from "next-themes";
import { useTranslation, type Locale } from "@/i18n";

interface Preferences {
  theme?: string;
  locale?: string;
}

/**
 * Fetches user preferences from the backend on login and provides
 * a debounced `savePreferences` function to persist changes.
 */
export function useUserPreferences() {
  const { data: session, status } = useSession();
  const { setTheme } = useTheme();
  const { setLocale } = useTranslation();
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const initializedRef = useRef(false);

  // Fetch preferences from backend on session init
  useEffect(() => {
    if (status !== "authenticated" || !session?.user || initializedRef.current) {
      return;
    }
    initializedRef.current = true;

    fetch("/api/user/me")
      .then((res) => {
        if (!res.ok) return null;
        return res.json();
      })
      .then((data) => {
        if (!data) return;
        if (data.theme) {
          setTheme(data.theme);
        }
        if (data.locale) {
          setLocale(data.locale as Locale);
        }
      })
      .catch(() => {
        // Silently ignore — preferences will use client defaults
      });
  }, [status, session, setTheme, setLocale]);

  // Debounced save to backend
  const savePreferences = useCallback(
    (prefs: Preferences) => {
      if (status !== "authenticated") return;

      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }

      timerRef.current = setTimeout(() => {
        fetch("/api/user/me/preferences", {
          method: "PATCH",
          headers: { "Content-Type": "application/json" },
          body: JSON.stringify(prefs),
        }).catch(() => {
          // Silently ignore — local state is already updated
        });
      }, 300);
    },
    [status],
  );

  // Cleanup timer on unmount
  useEffect(() => {
    return () => {
      if (timerRef.current) {
        clearTimeout(timerRef.current);
      }
    };
  }, []);

  return { savePreferences };
}
