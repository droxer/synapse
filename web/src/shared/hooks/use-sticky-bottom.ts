import { useCallback, useEffect, useRef } from "react";

const DEFAULT_THRESHOLD_PX = 120;
export const STICKY_BOTTOM_MUTATION_OBSERVER_OPTIONS: MutationObserverInit = {
  childList: true,
  subtree: true,
  characterData: true,
};

export interface UseStickyBottomOptions {
  readonly enabled?: boolean;
  readonly thresholdPx?: number;
  readonly behavior?: ScrollBehavior;
  readonly contentRef?: React.RefObject<HTMLElement | null>;
}

/**
 * Keeps a scrollable container pinned to the bottom while the user is near
 * the bottom edge. Disengages the moment the user scrolls up, and re-engages
 * when they scroll back within `thresholdPx` of the bottom.
 *
 * Uses ResizeObserver to follow content growth (tool outputs, streamed text)
 * without relying on change-diff heuristics.
 */
export function useStickyBottom(
  ref: React.RefObject<HTMLElement | null>,
  options: UseStickyBottomOptions = {},
): void {
  const {
    enabled = true,
    thresholdPx = DEFAULT_THRESHOLD_PX,
    behavior = "smooth",
    contentRef,
  } = options;
  const stuckRef = useRef(true);

  const distanceFromBottom = useCallback((el: HTMLElement) => {
    return el.scrollHeight - el.scrollTop - el.clientHeight;
  }, []);

  useEffect(() => {
    if (!enabled) return;
    const el = ref.current;
    if (!el) return;

    const onScroll = () => {
      stuckRef.current = distanceFromBottom(el) < thresholdPx;
    };
    el.addEventListener("scroll", onScroll, { passive: true });
    stuckRef.current = distanceFromBottom(el) < thresholdPx;

    const scrollToBottom = () => {
      if (!stuckRef.current) return;
      el.scrollTo({ top: el.scrollHeight, behavior });
    };

    // Observe the scroll container and, when provided, the content wrapper so
    // late render growth inside the container keeps the latest output visible.
    const ro = new ResizeObserver(() => {
      scrollToBottom();
    });
    ro.observe(el);
    const contentEl = contentRef?.current;
    if (contentEl && contentEl !== el) {
      ro.observe(contentEl);
    }

    // Use a MutationObserver to detect content changes, but throttle
    // the scroll-to-bottom to avoid layout thrashing.
    let scrollRafId: number | null = null;
    const mo = new MutationObserver(() => {
      if (scrollRafId !== null) return;
      scrollRafId = requestAnimationFrame(() => {
        scrollRafId = null;
        scrollToBottom();
      });
    });
    mo.observe(el, STICKY_BOTTOM_MUTATION_OBSERVER_OPTIONS);

    scrollToBottom();

    return () => {
      el.removeEventListener("scroll", onScroll);
      ro.disconnect();
      mo.disconnect();
      if (scrollRafId !== null) {
        cancelAnimationFrame(scrollRafId);
      }
    };
  }, [ref, contentRef, enabled, thresholdPx, behavior, distanceFromBottom]);
}
