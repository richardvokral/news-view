"use client";

import { useEffect } from "react";

// Runs `callback` once on mount, then every `intervalMs` while the tab is
// visible. Skips ticks when the document is hidden and re-fires when the tab
// becomes visible again if a full interval has elapsed.
export function usePolling(
  callback: (() => void) | null | undefined,
  intervalMs: number
): void {
  useEffect(() => {
    if (!callback) return;
    let lastRun = 0;
    const run = () => {
      lastRun = Date.now();
      callback();
    };
    run();
    const id = setInterval(() => {
      if (document.visibilityState !== "visible") return;
      run();
    }, intervalMs);
    const onVisible = () => {
      if (
        document.visibilityState === "visible" &&
        Date.now() - lastRun >= intervalMs
      ) {
        run();
      }
    };
    document.addEventListener("visibilitychange", onVisible);
    return () => {
      clearInterval(id);
      document.removeEventListener("visibilitychange", onVisible);
    };
  }, [callback, intervalMs]);
}
