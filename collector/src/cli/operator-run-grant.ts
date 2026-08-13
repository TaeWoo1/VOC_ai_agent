/**
 * **The RUN-LEVEL grant, on the same channel as every checkpoint inside the run.**
 *
 * ## What was still made of text
 *
 * `docs/sellerops_live_approval_contract.md` §3 says a prepared Approval Manifest is granted by one line:
 * `Seated and ready.` The operator types it into a chat window, and the assistant then starts the run by
 * passing the CLI's approval flag. Both halves of that are things a language model can produce — the same
 * defect the per-checkpoint sentinel had, one level up. The checkpoints inside a run were closed on
 * 2026-08-13; the door the run comes through was not.
 *
 * ## What replaces it
 *
 * The flag still gates the CLI — it is the assistant's statement of INTENT, and it stays. What it no longer
 * does is authorize anything: before a run touches the marketplace, it renders the manifest's binding fields on
 * the SellerOps confirmation surface and waits for a verified press. The operator therefore grants against the
 * fields the RUN actually holds, in a window only they can press — not against a paraphrase in a terminal, and
 * not against one in a chat log.
 *
 * ## The fields are the manifest's binding, and they are shown VERBATIM
 *
 * Root `CLAUDE.md` names what a grant binds to: channel / account / surface / operation / mode / allowed
 * actions, pinned by `approvalId` + `runId` + the commit. A grant surface that summarised them would be a third
 * paraphrase; these are passed through as given, and a run whose manifest says something else says it here.
 *
 * ## What this does NOT claim
 *
 * It does not verify the manifest — the CLIs' own prerequisite gates do that, before this is reached, and they
 * refuse before any browser opens. It does not defend against an operator who presses without reading. It
 * closes exactly one hole: **a live run can no longer start on text.**
 */
import type { OperatorConfirmAsk, OperatorConfirmation } from "./operator-confirm";

/**
 * The manifest fields a grant binds to. Every one is passed through to the surface as written, so this
 * interface is deliberately all-strings: a field this module could compute is a field the operator would be
 * granting against something other than the manifest.
 */
export interface RunGrantBinding {
  /** `apr-…` — the approval this run claims to be running under. */
  readonly approvalId: string;
  /** The run's own id, so a second run under one approval is visibly a second run. */
  readonly runId: string;
  /** The commit the manifest was prepared against, already verified by the caller's identity gate. */
  readonly gitSha: string;
  readonly channel: string;
  readonly account: string;
  readonly surface: string;
  /** What this run does, in the manifest's own words. */
  readonly operation: string;
  /** `READ_ONLY` / `WRITE`. Shown on its own line because it is the field that changes what a press means. */
  readonly mode: string;
  /** The action budget the manifest declares — what the operator is agreeing may happen. */
  readonly maxActions: string;
  /**
   * The IRREVERSIBLE thing the operator will do in this run, in the manifest's own words — or absent when the
   * run has none.
   *
   * It is separate from {@link mode} because on this workstream `mode` does not carry it: the destructive key
   * deletion is declared `READ_ONLY`, and honestly so — the AGENT only reads; the SELLER deletes their own key.
   * A grant screen that read the mode alone would show `READ_ONLY` above a run that ends with a key gone.
   */
  readonly irreversible?: string;
}

/** The run-level ask. One screen, the manifest's fields, and what pressing means. */
export function runGrantAsk(binding: RunGrantBinding): OperatorConfirmAsk {
  const changes = binding.mode.toUpperCase().includes("WRITE") || binding.irreversible !== undefined;
  return {
    title: `RUN GRANT — ${binding.mode}${binding.irreversible ? " · 되돌릴 수 없음" : ""}`,
    headline: changes
      ? "이 실행은 되돌릴 수 없는 결과를 남깁니다. 아래 내용이 맞을 때만 확인해 주세요."
      : "아래 내용이 승인하신 것과 같을 때만 확인해 주세요.",
    lines: [
      ...(binding.irreversible ? [`⚠ ${binding.irreversible}`, ""] : []),
      `channel:    ${binding.channel}`,
      `account:    ${binding.account}`,
      `surface:    ${binding.surface}`,
      `operation:  ${binding.operation}`,
      `mode:       ${binding.mode}`,
      `actions:    ${binding.maxActions}`,
      "",
      `approvalId: ${binding.approvalId}`,
      `runId:      ${binding.runId}`,
      `commit:     ${binding.gitSha}`,
      "",
      "이 화면의 내용이 승인하신 Approval Manifest와 다르면 누르지 마세요 — 누르지 않으면 아무것도 시작되지 않습니다.",
      "확인은 이 실행 하나에만 적용됩니다. 다음 실행은 다시 확인해야 합니다.",
    ],
  };
}

/** How a run-level grant ended. Only `GRANTED` may proceed; the rest are refusals with different causes. */
export type RunGrantOutcome = "GRANTED" | "REFUSED_NO_CONFIRMATION" | "REFUSED_ABORTED" | "REFUSED_INCOMPLETE";

/**
 * A binding is only shown if it is COMPLETE. A run whose manifest fields did not reach it would otherwise
 * display blanks — and an operator pressing against a screen with an empty `operation` has granted nothing,
 * while the run would read that press as a full authorization.
 */
export function runGrantBindingComplete(binding: RunGrantBinding): boolean {
  // `irreversible` is optional — absent is a real answer ("this run has none"). Every other field must be a
  // real value: `unknown` is the literal each CLI's builder falls back to for an unbound run env.
  const { irreversible: _irreversible, ...required } = binding;
  return Object.values(required).every(
    (v) => typeof v === "string" && v.trim().length > 0 && v.trim() !== "unknown",
  );
}

/** The operator-facing refusal, by cause. Sanitized: it names fields, never their values. */
export function runGrantRefusalMessage(outcome: Exclude<RunGrantOutcome, "GRANTED">): string {
  switch (outcome) {
    case "REFUSED_INCOMPLETE":
      return (
        "Refusing to start: the Approval Manifest binding is incomplete, so there is nothing honest to show you. " +
        "Re-bootstrap the run so channel / account / surface / operation / mode / actions / approvalId / runId / commit are all bound."
      );
    case "REFUSED_ABORTED":
      return "Aborted before the run began. Nothing was started.";
    default:
      return (
        "Refusing to start: the run grant was not confirmed. The Approval Manifest is granted by pressing the " +
        "button on the SellerOps confirmation tab — a chat line, a terminal flag, or a file is not a grant."
      );
  }
}

/** The one seam a caller supplies: an armed confirmation surface. */
export interface RunGrantHost {
  announce(ask: OperatorConfirmAsk): void;
  confirm(ask: OperatorConfirmAsk): Promise<OperatorConfirmation>;
}

/**
 * Show the binding and wait for a verified press. Fails closed on every axis: an incomplete binding is never
 * shown, and anything that is not a `ready` confirmation refuses.
 */
export async function confirmRunGrant(host: RunGrantHost, binding: RunGrantBinding): Promise<RunGrantOutcome> {
  if (!runGrantBindingComplete(binding)) return "REFUSED_INCOMPLETE";
  const ask = runGrantAsk(binding);
  host.announce(ask);
  const confirmation = await host.confirm(ask);
  if (confirmation.signal === "ready") return "GRANTED";
  return confirmation.signal === "abort" ? "REFUSED_ABORTED" : "REFUSED_NO_CONFIRMATION";
}
