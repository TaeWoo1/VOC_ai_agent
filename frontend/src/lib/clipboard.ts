// Copying operator-approved text to the clipboard.
//
// This exists for the reason `commandId.ts` exists, and it is the same trap wearing a
// different hat: `navigator.clipboard` is declared `[SecureContext]`, so on a non-secure
// origin it is not a blocked API — it is UNDEFINED. `vite.config.ts` sets
// `server.host: true`, whose whole purpose is serving the dev app on a LAN IP
// (`http://192.168.x.x:5173`), which is not a secure context. jsdom does not model the
// gating either, so no test can see it: the suite stays green while the button does
// nothing in the browser it ships to.
//
// Unlike a command id there is no non-secure equivalent to fall back to
// (`document.execCommand("copy")` is deprecated, and is a different reliability problem
// rather than a fix). So the honest answer is not to fake success: the caller reveals the
// approved text and lets the operator copy it themselves. The one thing this must never do
// is claim a copy that did not happen — the operator would paste stale text into a public
// reply and never know why.

/** Why a copy could not be performed, when it could not. */
export type CopyFailure =
  /** No clipboard API on this origin — the caller should reveal the text to copy manually. */
  | "UNAVAILABLE"
  /** The API exists and refused (permission, transient). Retrying is meaningful. */
  | "DENIED";

export type CopyResult = { ok: true } | { ok: false; reason: CopyFailure };

/**
 * Copy `text` to the clipboard, or say precisely why not.
 *
 * The two failures are kept apart because they lead the operator somewhere different:
 * `UNAVAILABLE` is a property of the origin and no number of retries will change it, so
 * the surface must offer the text instead; `DENIED` is a refusal that a second click can
 * genuinely resolve. Collapsing them into one "copy failed" would send half the operators
 * clicking forever and the other half hunting for a control that is not there.
 */
export async function copyText(text: string): Promise<CopyResult> {
  const clipboard = typeof navigator === "undefined" ? undefined : navigator.clipboard;
  if (clipboard?.writeText == null) {
    return { ok: false, reason: "UNAVAILABLE" };
  }
  try {
    await clipboard.writeText(text);
    return { ok: true };
  } catch {
    // Deliberately no detail. A DOMException name tells the operator nothing they can act
    // on, and the text being copied is the last thing that should reach an error surface.
    return { ok: false, reason: "DENIED" };
  }
}
