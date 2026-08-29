/**
 * The motion system (Chat Motion v1) — one file, a handful of numbers, no springs.
 *
 * Calm and fast: 150–250 ms ease-out; a new message rises 8 px as it fades in; layout changes glide
 * instead of jumping; a control that swaps in place (send ↔ stop, copy ↔ check) crossfades with a
 * small scale. `MotionConfig reducedMotion="user"` in the shell honours `prefers-reduced-motion`
 * (transforms are dropped, opacity stays). Nothing here delays an interaction: every animation runs on
 * the element that already changed, never as a gate before it.
 */
import type { Transition, Variants } from "motion/react";

export const EASE_OUT: readonly [number, number, number, number] = [0.22, 1, 0.36, 1];

export const FAST: Transition = { duration: 0.15, ease: EASE_OUT };
export const BASE: Transition = { duration: 0.2, ease: EASE_OUT };
export const LAYOUT: Transition = { layout: { duration: 0.22, ease: EASE_OUT }, opacity: { duration: 0.18 } };

/** A message entering the transcript: fade + rise 8 px. */
export const MESSAGE: Variants = {
  hidden: { opacity: 0, y: 8 },
  shown: { opacity: 1, y: 0, transition: BASE },
  gone: { opacity: 0, transition: { duration: 0.12 } },
};

/** A control swapped in place (send ↔ stop, copy ↔ check). */
export const SWAP: Variants = {
  hidden: { opacity: 0, scale: 0.85 },
  shown: { opacity: 1, scale: 1, transition: FAST },
  gone: { opacity: 0, scale: 0.85, transition: { duration: 0.1 } },
};

/** A block that opens and closes (the sidebar thread list). */
export const COLLAPSE: Variants = {
  hidden: { height: 0, opacity: 0 },
  shown: { height: "auto", opacity: 1, transition: BASE },
  gone: { height: 0, opacity: 0, transition: { duration: 0.15, ease: EASE_OUT } },
};
