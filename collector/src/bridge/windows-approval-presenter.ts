/**
 * **Windows native-dialog approval presenter (production adapter).** The pairing approval secret must reach a
 * human sitting at the Windows PC, or production pairing fails closed — which, until now, it always did off
 * macOS (`decideApprovalPresenter` returned `none`). This is the Windows adapter the ADR flagged as
 * unimplemented (§3.3): a PowerShell `MessageBox` owned by the agent, showing the code with an OK/취소 choice.
 *
 * It follows the macOS adapter's rules to the letter, because they are the security contract, not stylistic:
 *
 * **No shell, ever.** `powershell.exe` is exec'd by absolute path under `%SystemRoot%\System32` with
 * `shell:false`. No string is handed to `cmd.exe`, so no shell metacharacter in any value can be interpreted.
 *
 * **All dynamic content travels on stdin.** `powershell -Command -` reads its script from standard input, and
 * every dynamic value (origin, workspace label, and the approval code) is inside that script text. Nothing
 * dynamic is ever in `argv` — argv is world-readable in the process list, so an argv-passed code would hand
 * the secret to the very local process this design defends against. The only argv are constant flags.
 *
 * **PowerShell injection is escaped, not trusted.** `origin`/`workspaceLabel` are UNTRUSTED request inputs.
 * They are interpolated into PowerShell *single-quoted* string literals (which perform no variable/`$()`
 * expansion), so {@link powerShellLiteral} strips control code points and doubles the single quote — without
 * it, a `'` could close the literal and run arbitrary PowerShell in the agent's session.
 *
 * **Fail-closed.** Not Windows, or powershell.exe missing → `available()` is false and pairing refuses. A
 * dialog that errors, cannot display, or exceeds the timeout → `unavailable`, and the request is discarded.
 * We never report `presented` for a dialog we did not see approved.
 *
 * **Not blocking.** `present` is async and the child is spawned, never `spawnSync`'d — a blocking dialog would
 * freeze the agent's event loop (every WS socket, the heartbeat, any hosted run) until dismissed.
 *
 * **NOT live-verified.** The on-screen behaviour (front-most, focus, session-0 vs interactive) has not been
 * observed on a real Windows desktop — the logic below is hermetically tested with an injected process seam
 * only. Treat the presentation as unconfirmed until an operator runs it, per the honesty rule (collector §4.6).
 */

import { spawn } from "node:child_process";
import { existsSync } from "node:fs";
import { join } from "node:path";
import type { ApprovalPresentation, ApprovalPresenter, PresentResult } from "./approval-presenter";
import { DEFAULT_MAX_FIELD_CHARS, sanitizeDisplayField, stripDisplayControls } from "./untrusted-display";

/** The ONLY argv: read the script from stdin, no profile, don't let a policy block `-Command`. All constant. */
export const POWERSHELL_ARGS: readonly string[] = ["-NoProfile", "-ExecutionPolicy", "Bypass", "-Command", "-"];

/** Hard cap on the child process (ms). A MessageBox has no auto-dismiss, so an ignored dialog ends as timeout. */
const DEFAULT_TIMEOUT_MS = 120_000;
const MAX_FIELD_CHARS = DEFAULT_MAX_FIELD_CHARS;

/** Verdict tokens the script prints on stdout. We decide inside PowerShell and print a stable ASCII token. */
const VERDICT_APPROVED = "sellerops_approved";
const VERDICT_DECLINED = "sellerops_declined";

export type PowerShellOutcome = { ok: true; stdout: string } | { ok: false; reason: "timeout" | "error" };

/** Process seam — injected so every branch is testable without spawning PowerShell or showing a dialog. */
export interface PowerShellProcess {
  run(command: string, args: readonly string[], input: string, timeoutMs: number): Promise<PowerShellOutcome>;
}

export interface WindowsApprovalPresenterOptions {
  /** Defaults to `process.platform`. Anything other than `"win32"` makes the presenter unavailable. */
  platform?: string;
  /** Defaults to `process.env` — used to locate `%SystemRoot%`. */
  env?: NodeJS.ProcessEnv;
  /** Defaults to a real spawn of powershell.exe. */
  process?: PowerShellProcess;
  /** Defaults to `existsSync` — used only to check that powershell.exe is present. */
  fileExists?: (path: string) => boolean;
  timeoutMs?: number;
}

/** Resolve the absolute powershell.exe path under `%SystemRoot%\System32`. Never composed from input. */
export function resolvePowerShellPath(env: NodeJS.ProcessEnv = process.env): string {
  const systemRoot = env.SystemRoot?.trim() || "C:\\Windows";
  return join(systemRoot, "System32", "WindowsPowerShell", "v1.0", "powershell.exe");
}

/** Sanitize + CAP one untrusted field for display (per-field, so a hostile value can only truncate itself). */
export function sanitizeField(value: string, maxChars: number = MAX_FIELD_CHARS): string {
  return sanitizeDisplayField(value, maxChars);
}

/**
 * Escape a value into a PowerShell single-quoted string literal: drop renderer-active control code points,
 * then double every `'`. Single-quoted literals do NOT expand `$`, `` ` ``, or `$(...)`, so doubling the
 * quote is the only escape needed to keep the value inert text.
 */
export function powerShellLiteral(value: string): string {
  return `'${stripDisplayControls(value).replace(/'/g, "''")}'`;
}

/**
 * Build the PowerShell script. Every line is its own single-quoted literal, joined by `[char]10` (LF) so a
 * line break is PowerShell syntax, never a character inside a literal. Untrusted fields are capped
 * individually before composition; the fixed instruction lines and the approval code always render in full.
 *
 * `MessageBox` OK/취소 gives refusal an affordance: 취소 (or the window's ✕) returns `Cancel`, which we map to
 * `declined` so the request is discarded at once rather than lingering to time out. `OK` → `approved`. Any
 * PowerShell error (no interactive desktop, assembly load failure) is NOT caught — it exits non-zero and the
 * presenter fails closed.
 */
export function buildApprovalScript(p: ApprovalPresentation): string {
  const lines = [
    "SellerOps 로컬 도우미 연결 승인",
    "",
    `요청 출처: ${sanitizeField(p.origin)}`,
    `워크스페이스: ${sanitizeField(p.workspaceLabel)}`,
    "",
    `승인 코드: ${p.approvalCode}`,
    "",
    "이 코드를 브라우저의 연결 확인 화면에 입력하세요.",
    "요청한 적이 없다면 [취소]를 누르세요 (코드를 알려주지 마세요).",
  ];
  const body = lines.map((line) => powerShellLiteral(line)).join(" + [char]10 + ");
  const title = powerShellLiteral("SellerOps 연결 승인");
  // `MessageBox.Show(text, caption, OKCancel, Information)`. DialogResult compares equal to its string name.
  return [
    "$ErrorActionPreference = 'Stop'",
    "Add-Type -AssemblyName System.Windows.Forms | Out-Null",
    `$body = ${body}`,
    `$title = ${title}`,
    "$r = [System.Windows.Forms.MessageBox]::Show($body, $title, [System.Windows.Forms.MessageBoxButtons]::OKCancel, [System.Windows.Forms.MessageBoxIcon]::Information)",
    `if ($r -eq 'OK') { [Console]::Out.Write('${VERDICT_APPROVED}') } else { [Console]::Out.Write('${VERDICT_DECLINED}') }`,
    "",
  ].join("\n");
}

/** Real spawn of powershell.exe: absolute path, `shell:false`, script delivered on stdin, stdout piped. */
function defaultPowerShellProcess(): PowerShellProcess {
  return {
    run(command, args, input, timeoutMs) {
      return new Promise<PowerShellOutcome>((resolve) => {
        let settled = false;
        const finish = (outcome: PowerShellOutcome): void => {
          if (settled) return;
          settled = true;
          clearTimeout(timer);
          resolve(outcome);
        };
        let child: ReturnType<typeof spawn>;
        try {
          child = spawn(command, [...args], { shell: false, stdio: ["pipe", "pipe", "ignore"] });
        } catch {
          return resolve({ ok: false, reason: "error" });
        }
        let stdout = "";
        child.stdout?.setEncoding("utf8");
        child.stdout?.on("data", (chunk: string) => {
          stdout += chunk;
        });
        const timer = setTimeout(() => {
          try {
            child.kill();
          } catch {
            /* already gone */
          }
          finish({ ok: false, reason: "timeout" });
        }, timeoutMs);
        child.on("error", () => finish({ ok: false, reason: "error" }));
        child.on("close", (code) => finish(code === 0 ? { ok: true, stdout } : { ok: false, reason: "error" }));
        child.stdin?.on("error", () => finish({ ok: false, reason: "error" }));
        child.stdin?.end(input, "utf8");
      });
    },
  };
}

/** Build the Windows native-dialog presenter. Unavailable (so pairing fails closed) off Windows. */
export function createWindowsApprovalPresenter(opts: WindowsApprovalPresenterOptions = {}): ApprovalPresenter {
  const platform = opts.platform ?? process.platform;
  const env = opts.env ?? process.env;
  const proc = opts.process ?? defaultPowerShellProcess();
  const fileExists = opts.fileExists ?? existsSync;
  const timeoutMs = opts.timeoutMs ?? DEFAULT_TIMEOUT_MS;
  const powershellPath = resolvePowerShellPath(env);

  const available = (): boolean => platform === "win32" && fileExists(powershellPath);

  return {
    available,
    async present(presentation: ApprovalPresentation): Promise<PresentResult> {
      if (!available()) return { status: "unavailable", reason: "no_human_channel" };
      const script = buildApprovalScript(presentation);
      const outcome = await proc.run(powershellPath, POWERSHELL_ARGS, script, timeoutMs);
      if (!outcome.ok) {
        // Timeout (ignored dialog) or error alike: we did not see the human approve, so we must not claim it.
        return { status: "unavailable", reason: "presenter_failed" };
      }
      switch (outcome.stdout.trim()) {
        case VERDICT_APPROVED:
          return { status: "presented" };
        case VERDICT_DECLINED:
          return { status: "declined" };
        default:
          return { status: "unavailable", reason: "presenter_failed" };
      }
    },
  };
}
