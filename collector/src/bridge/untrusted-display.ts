/**
 * **Untrusted display sanitization (pure leaf, zero imports).** One rule for every human-facing approval
 * surface: an UNTRUSTED field (`origin`, `workspaceLabel` — both arbitrary caller-supplied strings) is inert
 * TEXT. It may never influence how the surface around it renders.
 *
 * Both approval presenters interpolate those fields into a rendered surface — an AppleScript dialog body, a
 * terminal box — next to the approval code and the "요청한 적이 없다면 취소하세요" instruction. Those two
 * things are what let the human judge the request, so anything a field can do to displace, overwrite, hide,
 * or reorder them is a consent-integrity bug, not a cosmetic one. Hence the two primitives here:
 *
 * - {@link stripDisplayControls} — drop every code point that renders as nothing but *acts* on the renderer.
 * - {@link sanitizeDisplayField} — strip, then cap PER FIELD so one field cannot consume another's space.
 *
 * The cap is deliberately per-field rather than on the composed body: capping the body would let a long
 * origin or workspace label push the approval code (or the warning) off the end, leaving a prompt that asks
 * the human to approve something while showing them no code at all.
 *
 * Shared, not duplicated: `macos-approval-presenter` (dialog) and `stderr-approval-presenter` (terminal) had
 * independent notions of "safe to show", and only the dialog had one. A single leaf means a new adapter
 * (Windows/Linux) inherits the rule instead of re-deriving it. Adapters still add their OWN context escaping
 * on top — `appleScriptLiteral` for AppleScript string literals, HTML escaping for the confirmation page.
 * This module is about the RENDERER; that escaping is about the SYNTAX.
 */

/** Per-field display cap. The bridge server already caps `workspaceLabel` at 80; this is the last line. */
export const DEFAULT_MAX_FIELD_CHARS = 80;

/** Marks a value as shortened, so the human can tell they are not seeing all of it. */
const ELISION = "…";

/**
 * True for a code point that renders as nothing yet changes how the text around it renders. Each class is
 * here because it is actively dangerous on at least one of our surfaces:
 *
 * - **C0 + DEL** (`< 0x20`, `0x7f`) — `ESC` starts an ANSI escape sequence, so a terminal would execute a
 *   crafted label instead of showing it: `\x1b[2J` clears the screen, `\x1b[1A` moves the cursor up over the
 *   승인 코드 line and rewrites it with an attacker-chosen code. `\r` alone re-writes the current line. `\n`
 *   breaks out of the box. Inside an AppleScript literal these are a syntax error instead.
 * - **C1** (`0x80–0x9f`) — the 8-bit control block. U+009B is CSI, i.e. a second, less-known way to start the
 *   same escape sequence; terminals configured for 8-bit controls honour it, so stripping only ESC would
 *   leave a bypass.
 * - **Bidi controls + invisible formatters** (U+200B–U+200F, U+202A–U+202E, U+2060–U+2064, U+2066–U+2069,
 *   U+FEFF) — the Trojan-Source class. An RLO/RLI reorders the glyphs AFTER it, so a label or origin can be
 *   made to read on screen as a completely different string than the one the request actually carries. That
 *   defeats the only judgement we ask the human to make ("do I recognize this origin?"), so a display-only
 *   field must not carry them. They never render, so dropping them removes no information from the human.
 *
 * Everything else — including Korean, emoji, and ordinary punctuation — passes through untouched: this is a
 * control-character filter, not an allowlist. Narrowing it to ASCII would mangle every legitimate Korean
 * workspace label, which is the common case, not the attack.
 */
function isDisplayControl(code: number): boolean {
  if (code < 0x20 || code === 0x7f) return true; // C0 + DEL
  if (code >= 0x80 && code <= 0x9f) return true; // C1 (U+009B is CSI)
  if (code >= 0x200b && code <= 0x200f) return true; // zero-width + LRM/RLM
  if (code >= 0x202a && code <= 0x202e) return true; // bidi embedding / override
  if (code >= 0x2060 && code <= 0x2064) return true; // word-joiner + invisible operators
  if (code >= 0x2066 && code <= 0x2069) return true; // bidi isolates
  if (code === 0xfeff) return true; // BOM / zero-width no-break space
  return false;
}

/**
 * Drop every {@link isDisplayControl} code point. Iterates by code point (`[...value]`), not by UTF-16 code
 * unit, so a surrogate pair (emoji) is never split into lone halves — which would itself corrupt the render.
 *
 * Deliberately does NOT cap: the approval code and the fixed instruction lines run through their adapters
 * unchanged and must always render IN FULL. Only untrusted fields are capped, by {@link sanitizeDisplayField}.
 */
export function stripDisplayControls(value: string): string {
  return [...value].filter((ch) => !isDisplayControl(ch.codePointAt(0) ?? 0)).join("");
}

/**
 * Sanitize and cap ONE untrusted field for display: strip the controls, then bound the length by CODE POINT
 * so a multi-byte value (Korean, emoji) is bounded by what the human sees rather than by its byte length.
 *
 * Capping AFTER stripping is the load-bearing order. Capping first would let a field spend its whole budget
 * on invisible controls and then render past the cap once they were removed — the cap must bound what
 * actually reaches the screen.
 */
export function sanitizeDisplayField(value: string, maxChars: number = DEFAULT_MAX_FIELD_CHARS): string {
  const printable = [...stripDisplayControls(value)];
  return printable.length > maxChars ? `${printable.slice(0, maxChars).join("")}${ELISION}` : printable.join("");
}
