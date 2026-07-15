/**
 * **DEV-only TTY stderr approval presenter (I/O adapter).** Shows the out-of-band pairing approval secret on
 * the agent's OWN console, so the human reading it is — by construction — someone with a terminal attached to
 * this agent process. Kept out of the pure {@link ./approval-presenter} port, mirroring how
 * `defaultPairingStoreFs` keeps `node:fs` out of the `PairingStoreFs` port.
 *
 * **The TTY check is the whole point.** `available()` requires `stderr.isTTY === true`. A redirected stderr
 * (`2> agent.log`, a supervisor pipe, a service wrapper) is NOT a human channel: nobody would see the code,
 * and it would instead land in a file that any same-uid process can read — handing the secret to exactly the
 * local process this defends against. So a non-TTY stderr reports `no_human_channel` and pairing refuses
 * rather than leaking. This turns "the code might be written somewhere unseen" from a silent weakness into
 * an explicit refusal.
 *
 * **DEV only.** Refused under `NODE_ENV=production`, mirroring the `--dev-insecure-auto-approve` gate in
 * `cli/bridge.ts`. A terminal is not a shippable consent surface for a packaged agent; production needs a
 * native adapter (the repo has NO desktop/tray host today — Runtime ADR §1 records this as a repo-wide
 * finding, and §3.3 records tray/installer/autostart as explicitly unimplemented). Until such an adapter
 * exists, a production agent has no presenter and therefore refuses to pair (`503 approval_unavailable`).
 *
 * **The code never goes through `log()`.** `log()` writes to stdout AND pushes to the in-memory
 * `getLogSink()` array, and `safeMeta`'s forbidden-key list would not drop a key like `approvalCode`. This
 * adapter writes to the injected stderr directly and only.
 *
 * Implementation note for FUTURE native adapters (macOS `osascript`, Windows PowerShell, Linux
 * `zenity`/`kdialog`): pass the code via **stdin, never argv** — argv is world-readable in the process table,
 * which would hand the secret straight to the local process this defends against.
 */

import type { ApprovalPresentation, ApprovalPresenter, PresentResult } from "./approval-presenter";

/** The minimal stderr surface this adapter needs, injected so the TTY/write behaviour is hermetically testable. */
export interface ApprovalStderr {
  /** `true` only when stderr is a real terminal — i.e. a human could actually see what we write. */
  readonly isTTY?: boolean;
  write(chunk: string): unknown;
}

export interface StderrApprovalPresenterOptions {
  /** Defaults to `process.stderr`. */
  stderr?: ApprovalStderr;
  /** Defaults to `process.env.NODE_ENV`. The presenter is refused when this is `"production"`. */
  nodeEnv?: string | undefined;
}

/** The console block the human reads the code from. Untrusted inputs are shown as-is (plain text, no markup). */
function render(p: ApprovalPresentation): string {
  return [
    "",
    "  ┌─ SellerOps 로컬 에이전트 연결 승인 ─────────────────────",
    "  │",
    `  │  요청 출처 : ${p.origin}`,
    `  │  워크스페이스: ${p.workspaceLabel}`,
    "  │",
    `  │  승인 코드 : ${p.approvalCode}`,
    "  │",
    "  │  이 코드를 브라우저의 연결 확인 화면에 입력하세요.",
    "  │  요청한 적이 없다면 무시하세요 (코드를 알려주지 마세요).",
    "  └────────────────────────────────────────────────────────",
    "",
    "",
  ].join("\n");
}

/**
 * Build the DEV TTY stderr presenter. Unavailable — so pairing fails closed — whenever stderr is not a real
 * terminal, or when running under production.
 */
export function createStderrApprovalPresenter(opts: StderrApprovalPresenterOptions = {}): ApprovalPresenter {
  const stderr: ApprovalStderr = opts.stderr ?? process.stderr;
  const nodeEnv = "nodeEnv" in opts ? opts.nodeEnv : process.env.NODE_ENV;
  // A non-TTY stderr is redirected — no human would see the code, so this is NOT a human channel.
  const available = (): boolean => nodeEnv !== "production" && stderr.isTTY === true;
  return {
    available,
    present(presentation: ApprovalPresentation): PresentResult {
      // Re-check rather than trust the caller: never write a secret to a non-human channel.
      if (!available()) return { status: "unavailable", reason: "no_human_channel" };
      try {
        stderr.write(render(presentation));
        return { status: "presented" };
      } catch {
        return { status: "unavailable", reason: "presenter_failed" };
      }
    },
  };
}
