import { useEffect } from "react";

interface ScreenWakeLockSentinel extends EventTarget {
  release(): Promise<void>;
}

interface WakeLockNavigator {
  wakeLock?: {
    request(type: "screen"): Promise<ScreenWakeLockSentinel>;
  };
}

/** Keeps the display awake during an active brew where the browser supports Screen Wake Lock. */
export function useScreenWakeLock(enabled: boolean): void {
  useEffect(() => {
    if (!enabled) return;
    const wakeLock = (navigator as unknown as WakeLockNavigator).wakeLock;
    if (!wakeLock) return;

    let sentinel: ScreenWakeLockSentinel | null = null;
    let requesting = false;
    let disposed = false;

    async function requestLock() {
      if (disposed || requesting || sentinel || document.visibilityState !== "visible") return;
      requesting = true;
      try {
        const next = await wakeLock!.request("screen");
        if (disposed) {
          await next.release().catch(() => undefined);
          return;
        }
        sentinel = next;
        next.addEventListener("release", () => {
          if (sentinel === next) sentinel = null;
        });
      } catch {
        // Browsers can deny the request or omit the API; brewing continues normally.
      } finally {
        requesting = false;
      }
    }

    const onVisibilityChange = () => {
      if (document.visibilityState === "visible") void requestLock();
    };
    document.addEventListener("visibilitychange", onVisibilityChange);
    void requestLock();

    return () => {
      disposed = true;
      document.removeEventListener("visibilitychange", onVisibilityChange);
      const current = sentinel;
      sentinel = null;
      if (current) void current.release().catch(() => undefined);
    };
  }, [enabled]);
}
