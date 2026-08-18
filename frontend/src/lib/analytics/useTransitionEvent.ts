import { useEffect, useRef } from "react";

/**
 * Fire `onEnter` only when `active` turns from false to true AFTER the first render — never for a state that
 * was already true on mount (a returning seller re-opening a wizard is not a new connection).
 */
export function useTransitionEvent(active: boolean, onEnter: () => void): void {
  const previous = useRef(active);
  useEffect(() => {
    if (active && !previous.current) onEnter();
    previous.current = active;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [active]);
}
