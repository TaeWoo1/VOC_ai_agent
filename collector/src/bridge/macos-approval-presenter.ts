/**
 * **macOS native-dialog approval presenter (production adapter).** Shows the out-of-band pairing approval
 * secret in a native macOS dialog owned by the Local Agent process, so a human physically at the device sees
 * it. This is the first PRODUCTION-capable {@link ApprovalPresenter}: unlike the DEV stderr adapter it needs
 * no terminal, so a packaged agent can pair.
 *
 * **No shell, ever.** We exec `/usr/bin/osascript` by absolute path with `shell: false`. No string is ever
 * handed to `/bin/sh`, so no shell metacharacter in any dynamic value can be interpreted — the classic
 * command-injection surface simply does not exist here.
 *
 * **All dynamic content travels on stdin.** `osascript -` reads its script from standard input, and every
 * dynamic value (origin, workspace label, and the approval code itself) is inside that script text. Nothing
 * dynamic is ever passed in `argv`: argv is world-readable in the process table (`ps`), so an argv-passed
 * code would hand the secret straight to the local process this whole design defends against. The only argv
 * is the constant `["-"]`.
 *
 * **AppleScript injection is escaped, not trusted.** `origin` and `workspaceLabel` are UNTRUSTED request
 * inputs (the workspace label is arbitrary caller-supplied text). They are interpolated into AppleScript
 * string literals, so {@link appleScriptLiteral} strips control characters and escapes `\` and `"` — without
 * it, a crafted label could close the literal and run arbitrary AppleScript in the agent's session.
 *
 * **Fail-closed.** Not macOS, or `osascript` missing → `available()` is false and pairing refuses. A dialog
 * that errors, cannot be displayed (no GUI session), or exceeds the timeout → `unavailable`, and the caller
 * discards the request. We never report `presented` for a dialog we did not see succeed.
 *
 * **Not blocking.** `present` is async and the child is spawned, never `spawnSync`'d: a blocking dialog would
 * freeze the agent's event loop — every WS socket, the heartbeat, and any hosted run — until dismissed.
 *
 * **NOT live-verified.** The dialog's on-screen behaviour (front-most, focus, GUI-session requirements) has
 * not been observed on a real macOS desktop — doing so pops a real dialog on the operator's machine and was
 * not authorized. The logic below is hermetically tested with an injected process seam only. Treat the
 * on-screen presentation as unconfirmed until an operator runs it, per the honesty rule (collector §4.6).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import type { ApprovalPresentation, ApprovalPresenter, PresentResult } from "./approval-presenter";
import { DEFAULT_MAX_FIELD_CHARS, sanitizeDisplayField, stripDisplayControls } from "./untrusted-display";

/** The absolute, constant binary path. Never composed from input, never resolved via PATH or a shell. */
export const OSASCRIPT_PATH = "/usr/bin/osascript";
/** The ONLY argv: read the script from stdin. No dynamic value is ever added here. */
export const OSASCRIPT_ARGS: readonly string[] = ["-"];

/** How long the dialog stays on screen before AppleScript gives up (seconds). */
const DEFAULT_DIALOG_SECONDS = 90;
/** Hard cap on the child process. Must exceed the dialog window so a normal give-up is not read as a timeout. */
const DEFAULT_TIMEOUT_MS = (DEFAULT_DIALOG_SECONDS + 10) * 1000;
/**
 * Defensive cap applied to EACH untrusted field independently (the server already caps workspaceLabel at 80).
 * Per-field is the point: capping the composed body instead would let a long origin or workspace label push
 * the approval code — or the "누가 요청했는지 모르면 취소하세요" instruction — off the end of the dialog,
 * leaving a prompt that asks the human to approve something while showing them no code at all.
 */
const MAX_FIELD_CHARS = DEFAULT_MAX_FIELD_CHARS;

export type OsascriptOutcome = { ok: true; stdout: string } | { ok: false; reason: "timeout" | "error" };

/**
 * The verdict tokens the AppleScript echoes on stdout. We decide the outcome INSIDE AppleScript and print a
 * stable ASCII token, rather than exiting non-zero and parsing osascript's stderr — that text
 * (`execution error: User canceled. (-128)`) is localized and version-dependent, so matching on it would be
 * brittle. An unrecognized token fails closed.
 */
const VERDICT_APPROVED = "sellerops_approved";
const VERDICT_DECLINED = "sellerops_declined";
const VERDICT_GAVE_UP = "sellerops_gave_up";

/**
 * The process seam: run `command` with `args`, feeding `input` on stdin. Injected so every branch — success,
 * non-zero exit, spawn error, timeout — is hermetically testable without spawning a real process or ever
 * putting a dialog on the operator's screen.
 */
export interface OsascriptProcess {
  run(command: string, args: readonly string[], input: string, timeoutMs: number): Promise<OsascriptOutcome>;
}

export interface MacOsApprovalPresenterOptions {
  /** Defaults to `process.platform`. Anything other than `"darwin"` makes the presenter unavailable. */
  platform?: string;
  /** Defaults to a real `spawn` of {@link OSASCRIPT_PATH}. */
  process?: OsascriptProcess;
  /** Defaults to `existsSync` — used only to check that osascript is present. */
  fileExists?: (path: string) => boolean;
  dialogSeconds?: number;
  timeoutMs?: number;
}

/**
 * Sanitize and CAP ONE untrusted field for display. Capping is per-field, never on the composed body, so a
 * long or hostile value can only ever truncate ITSELF — it can never displace the approval code or the
 * instructions. An elided value is marked so the human can see it was shortened.
 *
 * The rule itself lives in the shared `untrusted-display` leaf, so this dialog and the DEV terminal box
 * agree on what an untrusted field may render.
 */
export function sanitizeField(value: string, maxChars: number = MAX_FIELD_CHARS): string {
  return sanitizeDisplayField(value, maxChars);
}

/**
 * Escape a value into an AppleScript string literal: renderer-active code points dropped
 * ({@link stripDisplayControls}), then `\` and `"` escaped — backslash FIRST, so the escape character itself
 * cannot be used to re-open the literal. The strip and the escape are separate concerns: the strip is about
 * what the DIALOG renders, this is about AppleScript SYNTAX. Both are needed — a raw control character is a
 * syntax error inside a literal, and an unescaped quote closes it.
 *
 * Deliberately does NOT cap: untrusted FIELDS are capped by {@link sanitizeField} before composition, while
 * the fixed instruction lines and the approval code must always render in full.
 */
export function appleScriptLiteral(value: string): string {
  const escaped = stripDisplayControls(value).replace(/\\/g, "\\\\").replace(/"/g, '\\"');
  return `"${escaped}"`;
}

/**
 * Build the AppleScript. Every interpolated value goes through {@link appleScriptLiteral}.
 *
 * `cancel button 1` is what makes refusal expressible: AppleScript only honours Esc when a cancel button is
 * defined (live-verified 2026-07-15 — with a single-button dialog, Esc was inert and the person had no way
 * to decline). Pressing 취소/Esc raises error -128, which we catch and turn into a `declined` verdict.
 *
 * `giving up after` still auto-dismisses an ignored dialog. That is reported as GAVE_UP → `presented`, not
 * declined: the code was on screen long enough to read, and the human may already be typing it into the
 * browser. Treating a give-up as refusal would kill a pairing the person completed correctly.
 *
 * Any OTHER error (no GUI session, automation not permitted, …) is deliberately NOT caught — it propagates,
 * osascript exits non-zero, and the presenter fails closed.
 */
export function buildApprovalScript(p: ApprovalPresentation, dialogSeconds: number): string {
  // Untrusted fields are capped INDIVIDUALLY here, before composition — see `sanitizeField`.
  const lines = [
    "SellerOps 로컬 에이전트 연결 승인",
    "",
    `요청 출처: ${sanitizeField(p.origin)}`,
    `워크스페이스: ${sanitizeField(p.workspaceLabel)}`,
    "",
    `승인 코드: ${p.approvalCode}`,
    "",
    "이 코드를 브라우저의 연결 확인 화면에 입력하세요.",
    "요청한 적이 없다면 [취소]를 누르세요 (코드를 알려주지 마세요).",
  ];
  // Each line is its OWN literal, joined by AppleScript's `linefeed` constant. A line break cannot be a
  // character inside the literal — a raw newline is a syntax error, and `stripControlChars` would eat it
  // anyway — so the breaks must be built as AppleScript syntax. (Composing the body with "\n" and escaping
  // it wholesale silently produced a run-on, truncated wall of text; found by dumping the live script.)
  const body = lines.map((line) => appleScriptLiteral(line)).join(" & linefeed & ");
  const title = appleScriptLiteral("SellerOps 연결 승인");
  // The trailing bare `_verdict` is the script's result, which osascript prints on stdout.
  return [
    `set _verdict to ${appleScriptLiteral(VERDICT_GAVE_UP)}`,
    "try",
    `  set _r to display dialog ${body} with title ${title} buttons {"취소", "확인"} default button 2 cancel button 1 with icon note giving up after ${dialogSeconds}`,
    "  if gave up of _r then",
    `    set _verdict to ${appleScriptLiteral(VERDICT_GAVE_UP)}`,
    "  else",
    `    set _verdict to ${appleScriptLiteral(VERDICT_APPROVED)}`,
    "  end if",
    "on error number -128",
    `  set _verdict to ${appleScriptLiteral(VERDICT_DECLINED)}`,
    "end try",
    "_verdict",
    "",
  ].join("\n");
}

/** Real spawn of osascript: absolute path, `shell: false`, script delivered on stdin. */
function defaultOsascriptProcess(): OsascriptProcess {
  return {
    run(command, args, input, timeoutMs) {
      return new Promise<OsascriptOutcome>((resolve) => {
        let settled = false;
        const finish = (outcome: OsascriptOutcome): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(outcome);
        };
        let child: ReturnType<typeof spawn>;
        try {
          // shell:false is the default and is stated explicitly — no shell may ever see these strings.
          // stdout is piped: the AppleScript prints its verdict token there.
          child = spawn(command, [...args], { shell: false, stdio: ["pipe", "pipe", "ignore"] });
        } catch {
          return resolve({ ok: false, reason: "error" });
        }
        let stdout = "";
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => { stdout += chunk; });
        const timer = setTimeout(() => {
          try { child.kill("SIGKILL"); } catch { /* already gone */ }
          finish({ ok: false, reason: "timeout" });
        }, timeoutMs);
        child.on("error", () => finish({ ok: false, reason: "error" })); // e.g. ENOENT
        child.on("close", (code) => finish(code === 0 ? { ok: true, stdout } : { ok: false, reason: "error" }));
        child.stdin?.on("error", () => finish({ ok: false, reason: "error" }));
        // The script — and every dynamic value in it — reaches osascript ONLY here.
        child.stdin?.end(input, "utf8");
      });
    },
  };
}

/** Build the macOS native-dialog presenter. Unavailable (so pairing fails closed) off macOS. */
export function createMacOsApprovalPresenter(opts: MacOsApprovalPresenterOptions = {}): ApprovalPresenter {
  const platform = opts.platform ?? process.platform;
  const proc = opts.process ?? defaultOsascriptProcess();
  const fileExists = opts.fileExists ?? existsSync;
  const dialogSeconds = opts.dialogSeconds ?? DEFAULT_DIALOG_SECONDS;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;

  const available = (): boolean => platform === "darwin" && fileExists(OSASCRIPT_PATH);

  return {
    available,
    async present(presentation: ApprovalPresentation): Promise<PresentResult> {
      // Re-check rather than trust the caller: never try to show a secret on an unsupported host.
      if (!available()) return { status: "unavailable", reason: "no_human_channel" };
      const script = buildApprovalScript(presentation, dialogSeconds);
      const outcome = await proc.run(OSASCRIPT_PATH, OSASCRIPT_ARGS, script, timeoutMs);
      if (!outcome.ok) {
        // Timeout or error alike: we did NOT see the dialog succeed, so we must not claim the human saw the
        // code. Both collapse to `presenter_failed` — a channel existed, the delivery did not complete.
        return { status: "unavailable", reason: "presenter_failed" };
      }
      switch (outcome.stdout.trim()) {
        case VERDICT_APPROVED:
          return { status: "presented" };
        case VERDICT_GAVE_UP:
          // Ignored until auto-dismiss. The code WAS on screen long enough to read and the human may be
          // typing it right now — so this is a presentation, not a refusal.
          return { status: "presented" };
        case VERDICT_DECLINED:
          return { status: "declined" };
        default:
          // Unrecognized output — we cannot tell what the human did, so fail closed.
          return { status: "unavailable", reason: "presenter_failed" };
      }
    },
  };
}
