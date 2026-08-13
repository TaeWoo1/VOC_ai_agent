/**
 * **The OPERATOR CONFIRMATION channel — the only thing that may advance a live checkpoint.**
 *
 * ## Why this module exists
 *
 * Every live/calibration run in this workstream advanced on a **sentinel file**: the operator said the screen was
 * ready, and something created `…/probe-wing-issuance-selectors.ready`. On 2026-08-13 that "something" was the
 * assistant, acting on a line of chat text — a line the operator had never written. The run advanced on a
 * fabricated confirmation. Nothing was pressed (the screen gate halted the run one checkpoint later), but the
 * mechanism was sound only for as long as every participant behaved, which is not a mechanism.
 *
 * The defect is structural, not behavioural: **chat text and a `touch` are both things a language model can
 * produce.** A channel that a model can produce cannot be evidence that a human looked at a screen.
 *
 * ## What replaces it
 *
 * A confirmation event that only a real press can create:
 *
 *  1. The run mints a **random 32-hex token per checkpoint** ({@link mintOperatorConfirmToken}). It is written
 *     into the page and held in the run's memory — never printed, never logged, never written to disk. A model
 *     reading this repository, the terminal, or the status directory cannot learn the value it would have to
 *     echo.
 *  2. The token is armed in a **SellerOps-owned confirmation surface** ({@link buildOperatorConfirmArmScript}) —
 *     a blank tab that renders the step, the instruction the operator was given, and one button: `현재 화면 확인`.
 *  3. The button's handler records the event **only for a trusted event** (`ev.isTrusted === true`, which no
 *     in-page `element.click()` or `dispatchEvent` can set) and only while its own token is the armed one.
 *  4. The run polls, and {@link verifyOperatorConfirmEvent} admits the event only if the token matches the one it
 *     minted for THIS checkpoint and the press was trusted. Everything else — no event, a stale token, an
 *     untrusted event, a malformed record — is refused, and refusal never advances.
 *
 * A confirmation that passes carries {@link OPERATOR_UI_CONFIRMED} as its provenance, and that literal is the
 * ONLY way to construct the `ready` arm of {@link OperatorConfirmation}. Callers therefore cannot record a
 * checkpoint as confirmed without naming the channel it came through — the type system carries the audit, not a
 * convention.
 *
 * ## What this does NOT claim
 *
 * It does not defend against an operator who presses without looking.
 *
 * **And `isTrusted` is not a defence against this repository.** It rejects synthesised in-page events; it does
 * NOT reject a Playwright/CDP click, which arrives through the browser's own input pipeline and is trusted like
 * a human's. Every host here already holds a handle to the confirmation tab, so code in this package could press
 * its own button. What stops that is the shape of {@link OperatorConfirmSeams} and of the host's page interface —
 * `url` / `evaluate` / `bringToFront`, with no click path — plus review. It is a boundary, not a wall.
 *
 * What this closes is exactly one hole: **a checkpoint can no longer advance on text**, or on anything a process
 * that is not driving this browser can produce.
 *
 * String IIFEs (never passed functions): tsx/esbuild instruments named/module functions with a `__name` helper
 * absent in the page, so a serialized function throws `ReferenceError: __name`. Kept ES5-plain and free of
 * backticks (a backtick would terminate the TypeScript template literal that carries it).
 */

import { randomUUID } from "node:crypto";

/**
 * The one provenance a confirmed checkpoint may carry. It is a literal type as well as a value: the `ready` arm of
 * {@link OperatorConfirmation} requires it, so no code path can report a confirmation without naming this channel.
 */
export const OPERATOR_UI_CONFIRMED = "OPERATOR_UI_CONFIRMED" as const;
export type OperatorConfirmProvenance = typeof OPERATOR_UI_CONFIRMED;

/**
 * The result of one wait. `ready` is reachable ONLY through a verified press; `abort` and `timeout` carry a null
 * provenance because nothing confirmed them.
 */
export type OperatorConfirmation =
  | { readonly signal: "ready"; readonly provenance: OperatorConfirmProvenance; readonly choice: OperatorConfirmChoice }
  | { readonly signal: "abort"; readonly provenance: null }
  | { readonly signal: "timeout"; readonly provenance: null };

/**
 * WHICH button the operator pressed.
 *
 * Some runs offer a second answer that is not "the screen is ready" — the calibration stages offer "skip this
 * optional stage". That is still an ADVANCE, so it needs the same trusted channel rather than a file beside it;
 * it is a different answer to the same ask, not a different ask.
 *
 * `primary` is what a surface with one button always produces, so nothing that ignores this field can be wrong.
 */
export type OperatorConfirmChoice = "primary" | "secondary";

/** Every way a poll can end. Only `CONFIRMED` advances; the rest are recorded and waited through. */
export const OPERATOR_CONFIRM_VERDICTS = [
  "CONFIRMED",
  /** Nothing has been pressed yet — the ordinary state of a wait. */
  "NO_EVENT",
  /** An event whose token is not the one THIS checkpoint armed (a stale press, or a forged one). */
  "TOKEN_MISMATCH",
  /** `isTrusted` was not true: a dispatched/synthesised event, not a human press. */
  "UNTRUSTED_EVENT",
  /** The record is not shaped like a confirmation. Refused rather than interpreted. */
  "MALFORMED",
  /** The confirmation surface could not be armed at all (tab closed, evaluate threw). Fail closed. */
  "UI_NOT_ARMED",
] as const;
export type OperatorConfirmVerdict = (typeof OPERATOR_CONFIRM_VERDICTS)[number];

/** The page global holding the armed token and the event. Distinctive so nothing on a host page collides. */
export const OPERATOR_CONFIRM_STATE_KEY = "__sellerOpsOperatorConfirm";
/** The confirmation surface's root element id. */
export const OPERATOR_CONFIRM_ROOT_ID = "sellerops-operator-confirm-root";
/** The button's own id — named in the copy so an operator can be told exactly what to look for. */
export const OPERATOR_CONFIRM_BUTTON_ID = "sellerops-operator-confirm-button";
/** The SECOND button's id, present only when the ask offers a second answer. */
export const OPERATOR_CONFIRM_SECONDARY_BUTTON_ID = "sellerops-operator-confirm-secondary";
/** The button's label. The operator is told this string and nothing else advances the run. */
export const OPERATOR_CONFIRM_BUTTON_LABEL = "현재 화면 확인";
/** The confirmation tab's title, so it is findable among the seller's own tabs. */
export const OPERATOR_CONFIRM_PAGE_TITLE = "SellerOps 확인";

/** 32 lowercase hex — the shape {@link mintOperatorConfirmToken} produces and the only shape accepted. */
const TOKEN_PATTERN = /^[0-9a-f]{32}$/;

/** Whether a value is a well-formed confirmation token. Used on BOTH sides of the comparison (see verify). */
export function isOperatorConfirmToken(value: unknown): value is string {
  return typeof value === "string" && TOKEN_PATTERN.test(value);
}

/**
 * A fresh per-checkpoint token. Never printed, never logged, never persisted — its whole value is that the only
 * copies are the run's memory and the confirmation page the operator is looking at.
 */
export function mintOperatorConfirmToken(): string {
  return randomUUID().replace(/-/g, "");
}

/** What the operator is being asked to confirm. Copy only — the same lines the terminal printed. */
export interface OperatorConfirmAsk {
  /** Step header, e.g. `DISCOVERY 5/7`. */
  readonly title: string;
  /** The one-line ask. */
  readonly headline: string;
  /** The detail lines, already sanitized (this module renders them verbatim as text nodes). */
  readonly lines: readonly string[];
  /**
   * The PRIMARY button's label, when the default one would misname what the press does.
   *
   * Every checkpoint asks "is this screen ready", and `현재 화면 확인` says that. The run-level grant asks
   * something else — whether this run may start at all — and a button labelled "check the current screen"
   * above an approval is the kind of small wrongness that teaches an operator to press without reading.
   */
  readonly confirmLabel?: string;
  /**
   * An optional SECOND answer, rendered as a second button. Present only where the run genuinely has two
   * operator-decidable outcomes; its press is verified exactly like the first one and reports
   * {@link OperatorConfirmChoice} `secondary`.
   */
  readonly secondary?: { readonly label: string };
}

/**
 * Build the arm IIFE for ONE checkpoint. Self-mounting: it creates the surface if the tab is blank, so a reloaded
 * or freshly-opened tab needs no separate setup call and cannot end up armed-but-unrendered.
 *
 * Returns `true` in the page when the surface is armed. Anything else (including a throw) is {@link
 * OperatorConfirmVerdict} `UI_NOT_ARMED` host-side, which fails the wait closed rather than waiting on a button
 * nobody can see.
 */
export function buildOperatorConfirmArmScript(ask: OperatorConfirmAsk & { readonly token: string }): string {
  return `(function () {
  /* sellerops-operator-confirm (arm) */
  var KEY = ${JSON.stringify(OPERATOR_CONFIRM_STATE_KEY)};
  var TOKEN = ${JSON.stringify(ask.token)};
  var TITLE = ${JSON.stringify(ask.title)};
  var HEADLINE = ${JSON.stringify(ask.headline)};
  var LINES = ${JSON.stringify(ask.lines)};
  var d = document;
  if (!d || !d.body) return false;
  d.title = ${JSON.stringify(OPERATOR_CONFIRM_PAGE_TITLE)};
  var st = window[KEY];
  if (!st) { st = { armed: null, event: null }; window[KEY] = st; }
  /* Arming CLEARS any earlier press. A confirmation belongs to exactly one checkpoint. */
  st.event = null;
  st.armed = TOKEN;
  d.body.style.margin = "0";
  d.body.style.background = "#0d1117";
  d.body.style.color = "#e6edf3";
  d.body.style.font = "14px/1.6 -apple-system, BlinkMacSystemFont, sans-serif";
  var root = d.getElementById(${JSON.stringify(OPERATOR_CONFIRM_ROOT_ID)});
  if (!root) {
    root = d.createElement("div");
    root.id = ${JSON.stringify(OPERATOR_CONFIRM_ROOT_ID)};
    d.body.appendChild(root);
  }
  while (root.firstChild) root.removeChild(root.firstChild);
  root.style.cssText = "max-width:720px;margin:0 auto;padding:28px 24px";
  /* textContent everywhere: this surface renders copy, never markup, so nothing it is handed can become DOM. */
  var mk = function (tag, text, css) {
    var el = d.createElement(tag);
    if (text !== null) el.textContent = text;
    if (css) el.style.cssText = css;
    root.appendChild(el);
    return el;
  };
  mk("div", TITLE, "font-size:12px;letter-spacing:.08em;color:#7d8590;text-transform:uppercase");
  mk("div", HEADLINE, "font-size:19px;font-weight:600;margin:6px 0 16px");
  var body = mk("div", null, "color:#adbac7;white-space:pre-wrap");
  for (var i = 0; i < LINES.length; i++) {
    var p = d.createElement("div");
    p.textContent = LINES[i];
    p.style.cssText = "margin:0 0 4px";
    body.appendChild(p);
  }
  /* The tab's OWN business, and only that. What advances the run is said once, in the ask's tail — saying it
     here as well put the same sentence on the screen twice and taught the operator to skim it. */
  var note = mk(
    "div",
    "이 탭은 SellerOps 화면입니다 — 여기서 다른 주소로 이동하지 마세요. 마켓플레이스는 옆 탭에서 진행하시면 됩니다.",
    "margin:20px 0 10px;color:#7d8590;font-size:13px"
  );
  var SECONDARY = ${JSON.stringify(ask.secondary?.label ?? null)};
  var buttons = [];
  var mkButton = function (id, label, choice, primary) {
    var btn = d.createElement("button");
    btn.id = id;
    btn.type = "button";
    btn.textContent = label;
    btn.style.cssText =
      "font:600 16px/1 -apple-system,BlinkMacSystemFont,sans-serif;padding:14px 22px;border-radius:8px;" +
      "margin-right:10px;cursor:pointer;" +
      (primary
        ? "border:1px solid #2f81f7;background:#1f6feb;color:#fff"
        : "border:1px solid #444c56;background:transparent;color:#adbac7");
    btn.addEventListener(
      "click",
      function (ev) {
        /* isTrusted is false for any in-page dispatched or programmatic click. A synthesised press is refused
           HERE as well as host-side, so the page never even holds a record a verifier would have to reject.
           (A CDP-driven click IS trusted — see this module's header for what does and does not stop that.) */
        if (!ev || ev.isTrusted !== true) {
          note.textContent = "직접 누른 것이 아닌 신호는 무시됩니다. 버튼을 눌러 주세요.";
          return;
        }
        if (st.armed !== TOKEN) return;
        st.event = { token: TOKEN, trusted: true, choice: choice };
        st.armed = null;
        for (var b = 0; b < buttons.length; b++) {
          buttons[b].disabled = true;
          buttons[b].style.opacity = "0.55";
          buttons[b].style.cursor = "default";
        }
        btn.textContent = "확인됨 — 다음 단계를 준비합니다";
      },
      false
    );
    buttons.push(btn);
    root.appendChild(btn);
    return btn;
  };
  mkButton(${JSON.stringify(OPERATOR_CONFIRM_BUTTON_ID)}, ${JSON.stringify(ask.confirmLabel ?? OPERATOR_CONFIRM_BUTTON_LABEL)}, "primary", true);
  if (SECONDARY) mkButton(${JSON.stringify(OPERATOR_CONFIRM_SECONDARY_BUTTON_ID)}, SECONDARY, "secondary", false);
  return true;
})()`;
}

/** Read the pending confirmation event, or null. Returns a copy: the page's own object never leaves the page. */
export const OPERATOR_CONFIRM_READ_SCRIPT = `(function () {
  /* sellerops-operator-confirm (read) */
  var st = window[${JSON.stringify(OPERATOR_CONFIRM_STATE_KEY)}];
  if (!st || !st.event) return null;
  return { token: st.event.token, trusted: st.event.trusted === true, choice: st.event.choice };
})()`;

/** Drop a refused event so the next poll is not the same refusal again. Leaves the armed token in place. */
export const OPERATOR_CONFIRM_CLEAR_SCRIPT = `(function () {
  /* sellerops-operator-confirm (clear) */
  var st = window[${JSON.stringify(OPERATOR_CONFIRM_STATE_KEY)}];
  if (st) st.event = null;
  return true;
})()`;

/**
 * Decide whether a raw page record is THIS checkpoint's confirmation. Pure, and deliberately narrow: every field
 * is checked, and anything unrecognized is `MALFORMED` rather than best-effort interpreted.
 *
 * `expectedToken` is validated too. A caller that lost its token (empty string, undefined threaded through) would
 * otherwise be comparing against a value the page could match by accident — so an unusable expectation refuses
 * everything instead of accepting something.
 */
/**
 * WHICH answer a verified event carries. Anything that is not exactly `"secondary"` reads as `primary` — the
 * default is the answer every single-button surface produces, so an unrecognised value can only ever under-claim.
 */
export function operatorConfirmChoiceOf(raw: unknown): OperatorConfirmChoice {
  const choice = (raw as { choice?: unknown } | null)?.choice;
  return choice === "secondary" ? "secondary" : "primary";
}

export function verifyOperatorConfirmEvent(raw: unknown, expectedToken: string): OperatorConfirmVerdict {
  if (!isOperatorConfirmToken(expectedToken)) return "MALFORMED";
  if (raw === null || raw === undefined) return "NO_EVENT";
  if (typeof raw !== "object") return "MALFORMED";
  const record = raw as { token?: unknown; trusted?: unknown };
  if (!isOperatorConfirmToken(record.token)) return "MALFORMED";
  if (record.token !== expectedToken) return "TOKEN_MISMATCH";
  if (record.trusted !== true) return "UNTRUSTED_EVENT";
  return "CONFIRMED";
}

/**
 * **How the wait reaches a confirmation surface — the one thing that differs between hosts.**
 *
 * Stated as three intents rather than as "evaluate this string" so a surface that is not a page can implement
 * it. Everything that decides whether a checkpoint advances — the token, the verification, the fail-closed
 * ordering — lives above this interface and is the same for every host.
 */
export interface OperatorConfirmTransport {
  /** Render the ask and arm this token. Resolves `true` only when the operator can now see and press it. */
  arm(ask: OperatorConfirmAsk, token: string): Promise<boolean>;
  /** The pending event record, or null/undefined when nothing has been pressed. Never interpreted here. */
  read(): Promise<unknown>;
  /** Drop a refused event so the next poll is not the same refusal again. */
  clear(): Promise<void>;
}

/**
 * The transport for a surface that is a real DOM: this module's own string IIFEs, evaluated in it. `evaluate`
 * is the caller's — it is what pins the surface to a page the run owns.
 */
export function pageEvaluateTransport(evaluate: (script: string) => Promise<unknown>): OperatorConfirmTransport {
  return {
    arm: (ask, token) =>
      evaluate(buildOperatorConfirmArmScript({ ...ask, token }))
        .then((v) => v === true)
        // An un-armable surface is a wait on a button nobody can see. It fails closed one level up.
        .catch(() => false),
    read: () => evaluate(OPERATOR_CONFIRM_READ_SCRIPT).catch(() => null),
    clear: () => evaluate(OPERATOR_CONFIRM_CLEAR_SCRIPT).then(() => undefined).catch(() => undefined),
  };
}

/** The injected seams, so the whole wait is unit-tested offline over a fake surface. */
export interface OperatorConfirmSeams {
  /** How this run reaches its confirmation surface. */
  readonly transport: OperatorConfirmTransport;
  /** Whether the operator has asked to stop (Ctrl+C or the abort sentinel). Checked before every poll. */
  aborted(): boolean;
  sleep(ms: number): Promise<void>;
  /**
   * Called ONCE, after the surface is armed and before the first poll — the caller's chance to put it where the
   * operator can see it.
   *
   * It exists because of a live sitting on 2026-08-13: the surface was armed and rendered correctly, the
   * operator could not find the window it was in, and raising it from the OS (`open -a`) hit Chrome's
   * user-data-dir singleton and opened a THIRD blank window inside the run's own browser instead. A run that
   * needs the operator to find a window has a step nobody wrote down; a run that raises its own does not.
   *
   * After arming, not before: raising a surface still showing the PREVIOUS checkpoint's instruction would put
   * the wrong words in front of the operator at the exact moment they are deciding.
   */
  onArmed?(): void | Promise<void>;
  /** Sanitized observability: the VERDICT only, never the token or the event. */
  onVerdict?(verdict: OperatorConfirmVerdict): void;
}

export interface OperatorConfirmWaitOptions {
  readonly token: string;
  readonly pollMs: number;
  readonly timeoutMs: number;
}

const ABORTED: OperatorConfirmation = { signal: "abort", provenance: null };
const TIMED_OUT: OperatorConfirmation = { signal: "timeout", provenance: null };

/**
 * Arm the surface for one checkpoint and wait for a verified press.
 *
 * Fails closed on every axis: an un-armable surface returns immediately without waiting on a button nobody can
 * see; a refused event is recorded, cleared, and waited through; and running out of budget is a `timeout`, which
 * every caller treats as "do not advance". There is no branch that returns `ready` without
 * {@link verifyOperatorConfirmEvent} saying `CONFIRMED` first.
 */
export async function awaitOperatorConfirmation(
  seams: OperatorConfirmSeams,
  ask: OperatorConfirmAsk,
  opts: OperatorConfirmWaitOptions,
): Promise<OperatorConfirmation> {
  if (seams.aborted()) return ABORTED;
  const armed = await seams.transport.arm(ask, opts.token).catch(() => false);
  if (!armed) {
    seams.onVerdict?.("UI_NOT_ARMED");
    return TIMED_OUT;
  }
  // Best-effort: a surface that cannot be raised is still a surface the operator can switch to, so a failure
  // here must not end a run that is otherwise ready to be confirmed.
  await Promise.resolve(seams.onArmed?.()).catch(() => undefined);
  const ticks = Math.max(1, Math.ceil(opts.timeoutMs / Math.max(1, opts.pollMs)));
  for (let i = 0; i < ticks; i++) {
    if (seams.aborted()) return ABORTED;
    const raw = await seams.transport.read().catch(() => null);
    const verdict = verifyOperatorConfirmEvent(raw, opts.token);
    if (verdict === "CONFIRMED") {
      seams.onVerdict?.(verdict);
      return { signal: "ready", provenance: OPERATOR_UI_CONFIRMED, choice: operatorConfirmChoiceOf(raw) };
    }
    if (verdict !== "NO_EVENT") {
      seams.onVerdict?.(verdict);
      await seams.transport.clear().catch(() => undefined);
    }
    await seams.sleep(opts.pollMs);
  }
  return TIMED_OUT;
}
