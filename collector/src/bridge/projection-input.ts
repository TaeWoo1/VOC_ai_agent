/**
 * **Projection input boundary (pure, slice §8 / §E).** Classifies a proposed projection input as allowed or
 * rejected, and converts normalized frontend coordinates to real page CSS pixels **in the Local Agent**
 * (never round-tripping page coordinates to the frontend). No I/O, no CDP — the adapter calls these before
 * dispatching, so the allow/deny policy is one testable place.
 *
 * V0 allows ONLY: pointer move, primary press/release, wheel, basic key down/up, reviewed text insertion.
 * Everything else — secondary/middle click, drag/drop, clipboard, file, browser navigation buttons, DevTools
 * and OS shortcuts — is rejected here (slice §0.3). There is no marketplace/workflow input path.
 */

import type { ProjectionInput, ProjectionInputRejection } from "./projection-protocol";

export interface Viewport {
  /** Page CSS width/height the normalized coordinate maps into. */
  width: number;
  height: number;
}

export type InputClassification = { allow: true } | { allow: false; reason: ProjectionInputRejection };

/** True if the string contains an ASCII control char (0x00-0x1f, 0x7f) — text input must be plain typed chars. */
function hasControlChar(s: string): boolean {
  for (let i = 0; i < s.length; i++) {
    const c = s.charCodeAt(i);
    if (c <= 0x1f || c === 0x7f) return true;
  }
  return false;
}

/** OS/browser modifier chords that must never reach the page (nav, DevTools, clipboard, tab control). */
function isForbiddenKeyChord(key: string, meta: boolean, ctrl: boolean): boolean {
  if (key === "F12") return true; // DevTools
  const k = key.toLowerCase();
  if ((meta || ctrl) && ["t", "w", "n", "r", "l", "q", "c", "v", "x", "a", "p", "s", "f", "h", "m"].includes(k)) return true;
  if ((meta || ctrl) && ["i", "j", "u"].includes(k)) return true; // DevTools / view-source
  return false;
}

/**
 * Classify a proposed input. `modifiers` carries meta/ctrl so a plain letter is allowed but a chord is not.
 * Coordinates are validated as normalized [0,1] for pointer/wheel kinds.
 */
export function classifyProjectionInput(
  input: ProjectionInput,
  modifiers: { meta?: boolean; ctrl?: boolean } = {},
): InputClassification {
  const inRange = (v: number): boolean => typeof v === "number" && Number.isFinite(v) && v >= 0 && v <= 1;
  switch (input.kind) {
    case "pointer_move":
    case "pointer_down":
    case "pointer_up":
      if (!inRange(input.x) || !inRange(input.y)) return { allow: false, reason: "out_of_bounds" };
      // Only the primary (left) button is permitted; the type already constrains this, guard anyway.
      if ((input.kind === "pointer_down" || input.kind === "pointer_up") && input.button !== "left") {
        return { allow: false, reason: "forbidden_input" };
      }
      return { allow: true };
    case "wheel":
      if (!inRange(input.x) || !inRange(input.y)) return { allow: false, reason: "out_of_bounds" };
      if (!Number.isFinite(input.dy)) return { allow: false, reason: "forbidden_input" };
      return { allow: true };
    case "key_down":
    case "key_up":
      if (typeof input.key !== "string" || input.key.length === 0) return { allow: false, reason: "forbidden_input" };
      if (isForbiddenKeyChord(input.key, !!modifiers.meta, !!modifiers.ctrl)) return { allow: false, reason: "forbidden_input" };
      return { allow: true };
    case "text":
      if (typeof input.text !== "string") return { allow: false, reason: "forbidden_input" };
      // Reject control characters that could carry pasted/hidden payloads beyond plain typed text.
      if (hasControlChar(input.text)) return { allow: false, reason: "forbidden_input" };
      return { allow: true };
    default:
      return { allow: false, reason: "forbidden_input" };
  }
}

export interface CssPoint {
  x: number;
  y: number;
}

/** Convert a normalized [0,1] coordinate to page CSS px within `viewport`; null if out of range. */
export function normalizedToCss(x: number, y: number, viewport: Viewport): CssPoint | null {
  if (!(x >= 0 && x <= 1 && y >= 0 && y <= 1)) return null;
  if (!(viewport.width > 0 && viewport.height > 0)) return null;
  return { x: Math.round(x * viewport.width), y: Math.round(y * viewport.height) };
}
