import { useEffect } from "react";

/**
 * Run `handler` when the user presses Escape, while `active` is true.
 *
 * Standard pattern for dismissable surfaces (modals, popovers, command
 * palettes). Listens on `window` with `capture: true` so the dismissal
 * happens before any underlying focused input's own keydown handler runs.
 * No-op when `active === false` so a modal mounted as `{isOpen && <Modal/>}`
 * can keep calling this unconditionally.
 *
 * Convention: by 2026 the OpenClaw Easy dashboard ships ~6 modal-like
 * surfaces that all had to be re-checked when Escape behavior was
 * inconsistent. One shared hook eliminates that duplication and keeps
 * every dismissable surface behaving the same way.
 */
export function useEscapeKey(handler: () => void, active = true): void {
  useEffect(() => {
    if (!active) return;
    const onKey = (e: KeyboardEvent) => {
      if (e.key === "Escape") {
        // Stop the event so a wrapped text input doesn't ALSO clear itself.
        e.stopPropagation();
        handler();
      }
    };
    window.addEventListener("keydown", onKey, { capture: true });
    return () => window.removeEventListener("keydown", onKey, { capture: true } as any);
  }, [handler, active]);
}
