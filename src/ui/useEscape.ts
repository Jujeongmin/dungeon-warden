import { useEffect, useRef } from "react";

/**
 * Escape closes the dialog that calls this.
 *
 * Every dialog closed on its × and on a click outside it, and none on the one
 * key a keyboard reaches for first. Read through a ref so a parent that hands
 * down a fresh arrow function each render does not re-bind the listener.
 */
export function useEscape(onClose: () => void): void {
  const close = useRef(onClose);
  close.current = onClose;

  useEffect(() => {
    const onKey = (event: KeyboardEvent) => {
      if (event.key !== "Escape" || event.repeat) return;
      close.current();
    };
    window.addEventListener("keydown", onKey);
    return () => window.removeEventListener("keydown", onKey);
  }, []);
}
