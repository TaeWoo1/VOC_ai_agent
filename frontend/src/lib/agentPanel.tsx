import { createContext, useCallback, useContext, useEffect, useMemo, useState, type ReactNode } from "react";
import type { AgentContext } from "./agentContext";

/**
 * The contextual Agent panel — one per app, closed by default (docs/reviewnary_design.md §8-A).
 *
 * <b>Two things are held here and they are different.</b> `surface` is WHAT THE SELLER IS LOOKING AT:
 * the page registers it on mount (`useAgentSurface`) and clears it on unmount, so the panel can say
 * 「이 상품 · 선바로 몰딩」 without the seller repeating it. `request` is WHAT THE SELLER ASKED FOR: a
 * launcher put a sentence in the box (`openPanel`), or the home command box handed over a sentence the
 * palette did not recognise. The panel shows the first as a label and the second as the input.
 *
 * <b>Structured context, not a smuggled prompt.</b> `productId` / `channelCode` / `surface` travel as
 * fields to `StartRunRequest`, where the runtime verifies them with a read before they mean anything.
 * Nothing here appends 「(상품 id: …)」 to the text.
 *
 * <b>Nothing here sends, writes, approves or dispatches.</b> The seller presses the button in the
 * panel; the runtime's tool catalogue is READ-only; approval stays where it lives (the inquiry screen).
 */
export interface AgentPanelRequest {
  readonly context: AgentContext;
  /**
   * `true` only when the seller has ALREADY pressed send on this sentence somewhere else (the home
   * command box). A launcher never sets it — 「이 상품 분석하기」 lands the sentence and the seller sends.
   */
  readonly autorun: boolean;
  /** Monotonic — the same sentence pressed twice is two requests. */
  readonly seq: number;
}

/** What a page tells the panel about itself. The label is the seller's word for the object in view. */
export interface AgentSurface extends AgentContext {
  /** 「이 상품 · 선바로 몰딩」 — rendered in the panel header. Never customer text. */
  readonly label: string;
}

interface AgentPanelState {
  readonly open: boolean;
  readonly pinned: boolean;
  readonly surface: AgentSurface | null;
  readonly request: AgentPanelRequest | null;
  openPanel(context?: AgentContext, options?: { autorun?: boolean }): void;
  closePanel(): void;
  togglePinned(): void;
  setSurface(surface: AgentSurface | null): void;
}

const AgentPanelContext = createContext<AgentPanelState | null>(null);

const PIN_KEY = "reviewnary.agentPanel.pinned";

/** Docked beside the page is the default where the page has room (≥1440px); the seller may unpin. */
function readPinned(): boolean {
  try {
    const stored = window.localStorage.getItem(PIN_KEY);
    return stored === null ? true : stored === "1";
  } catch {
    return true;
  }
}

export function AgentPanelProvider({ children }: { children: ReactNode }) {
  const [open, setOpen] = useState(false);
  const [pinned, setPinned] = useState<boolean>(() => (typeof window === "undefined" ? true : readPinned()));
  const [surface, setSurfaceState] = useState<AgentSurface | null>(null);
  const [request, setRequest] = useState<AgentPanelRequest | null>(null);

  const openPanel = useCallback((context: AgentContext = {}, options: { autorun?: boolean } = {}) => {
    setRequest((prev) => ({ context, autorun: options.autorun === true, seq: (prev?.seq ?? 0) + 1 }));
    setOpen(true);
  }, []);
  const closePanel = useCallback(() => setOpen(false), []);
  const togglePinned = useCallback(() => {
    setPinned((prev) => {
      const next = !prev;
      try {
        window.localStorage.setItem(PIN_KEY, next ? "1" : "0");
      } catch {
        // storage unavailable — the pin is a convenience, not state the product depends on
      }
      return next;
    });
  }, []);
  const setSurface = useCallback((next: AgentSurface | null) => setSurfaceState(next), []);

  const value = useMemo<AgentPanelState>(
    () => ({ open, pinned, surface, request, openPanel, closePanel, togglePinned, setSurface }),
    [open, pinned, surface, request, openPanel, closePanel, togglePinned, setSurface],
  );
  return <AgentPanelContext.Provider value={value}>{children}</AgentPanelContext.Provider>;
}

/** Null outside the app shell (tests render pages bare) — callers fall back to the `/agent` route. */
export function useAgentPanel(): AgentPanelState | null {
  return useContext(AgentPanelContext);
}

/**
 * A page says what it is showing. Called once per page component; the panel header reads it.
 *
 * The dependency is the label + the ids, not the object — a page re-rendering on a keystroke must not
 * re-register the same surface and reset anything.
 */
export function useAgentSurface(surface: AgentSurface | null): void {
  const panel = useAgentPanel();
  const setSurface = panel?.setSurface;
  const label = surface?.label ?? null;
  const productId = surface?.productId ?? null;
  const channelCode = surface?.channelCode ?? null;
  const route = surface?.surface ?? null;
  const goal = surface?.goal ?? null;
  useEffect(() => {
    if (!setSurface) return;
    if (!label || !route) {
      setSurface(null);
      return;
    }
    setSurface({
      label,
      surface: route,
      ...(productId ? { productId } : {}),
      ...(channelCode ? { channelCode } : {}),
      ...(goal ? { goal } : {}),
    });
    return () => setSurface(null);
  }, [setSurface, label, route, productId, channelCode, goal]);
}
