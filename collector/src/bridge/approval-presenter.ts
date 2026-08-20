/**
 * **Approval presenter port (pure).** The human channel through which the Local Agent shows a pairing
 * approval secret to the person sitting at the device — and the ONLY way that secret ever leaves the agent.
 *
 * Why this exists: the pairing confirmation flow authenticates nothing that a local process cannot obtain.
 * `requestId` and `confirmationCode` are both returned in the `POST /bridge/pair/request` response, so the
 * caller — which, in the threat model, may be a malicious local process spoofing the `Origin` header — holds
 * every value the confirm endpoint checks. The fix is an **out-of-band approval secret**: minted per request,
 * never returned over HTTP, never rendered into the confirmation page, never persisted, never logged, and
 * delivered ONLY through an {@link ApprovalPresenter}. A caller confined to the HTTP surface therefore cannot
 * learn it, and cannot forge a human approval.
 *
 * **Fail-closed by construction.** {@link ApprovalPresenter.available} is asked BEFORE a secret is minted. A
 * presenter that cannot prove it reaches a human reports `false`, and the transport shell refuses to pair
 * rather than minting a secret that goes nowhere (or, worse, into a log file that any same-uid process reads).
 * {@link nullApprovalPresenter} — always unavailable — is the DEFAULT, so an agent whose presenter was never
 * wired refuses to pair instead of silently bypassing the human step. The dangerous default is unrepresentable.
 *
 * This module is a pure leaf: no I/O, no imports. Adapters live outside it (see `./stderr-approval-presenter`
 * for the DEV TTY adapter), exactly as `PairingStoreFs` keeps its port pure and its `node:fs` pass-through
 * adapter separate.
 */

/**
 * What the human is shown. `origin`/`workspaceLabel` are UNTRUSTED request inputs (display-only — an adapter
 * that renders them into any markup/shell context must escape them). `approvalCode` is THE SECRET: an adapter
 * must deliver it only to a human-visible channel, and must never log, persist, or echo it over HTTP.
 */
export interface ApprovalPresentation {
  /** Opaque request id — already public (returned to the requesting frontend). */
  requestId: string;
  /** The requesting frontend origin, as presented by the caller. Untrusted; display-only. */
  origin: string;
  /** The workspace display label, as presented by the caller. Untrusted; display-only. */
  workspaceLabel: string;
  /** The out-of-band approval secret, human-formatted. NEVER log/persist/return this. */
  approvalCode: string;
}

/**
 * Why a presentation could not reach a human.
 * - `no_human_channel` — this presenter has no human attached right now (e.g. stderr is not a TTY, so it is
 *   redirected to a file/pipe and no human would ever see the code).
 * - `presenter_failed` — a human channel existed but the delivery itself faulted.
 * - `no_response` — a human channel existed, the prompt WAS shown, and nobody answered it before the channel
 *   gave up. Distinct from the other two because the fix is different (the person was away, not the machine
 *   misconfigured) and because on an ATTESTING channel it is the only non-answer outcome: there is no second
 *   place for the person to finish, so an unanswered prompt is the end of that request rather than a state
 *   they might still complete elsewhere.
 */
export type PresenterUnavailable = "no_human_channel" | "presenter_failed" | "no_response";

/**
 * Sanitized outcome of one presentation attempt — a coarse status/reason only, never the code or a path.
 *
 * **`approved` is an ATTESTATION, and only a channel the agent itself owns may return it.** It means: a human
 * was reached, and in a surface this process created and controls, they affirmatively said yes — as opposed to
 * `presented`, which claims only that the secret was put somewhere a human could read it. The distinction is
 * what lets the seller stop retyping the code: the out-of-band secret exists so that a caller confined to the
 * HTTP surface cannot forge a human approval, and an attested verdict establishes exactly that same fact
 * without the human having to carry the secret across the boundary by hand. The transport shell may therefore
 * confirm the request itself, with the real secret, through the ordinary `confirmPairing` check — the
 * verification is unchanged; only the courier is.
 *
 * A presenter that CANNOT distinguish "the person approved" from "the person dismissed it" (a console write,
 * a notification, a log line) must never return `approved` — it returns `presented` and the human completes
 * the confirmation the long way. Getting this wrong turns a dismissal into a pairing, which is why the two
 * statuses are separate rather than one boolean.
 *
 * `declined` is deliberately distinct from `unavailable`: it means a human WAS reached and actively refused.
 * A channel that cannot express refusal leaves the person staring at a security prompt with no way to say
 * no — their only options being to dismiss it (indistinguishable from approval) or ignore it. An adapter
 * whose UI has a refuse affordance MUST map it here so the request is discarded immediately rather than
 * lingering until it times out.
 */
export type PresentResult =
  | { status: "presented" }
  | { status: "approved" }
  | { status: "declined" }
  | { status: "unavailable"; reason: PresenterUnavailable };

/**
 * WHERE this presenter puts the code, so the agent's own confirmation page can tell the person where to look
 * for it. Declared BY the presenter rather than configured beside it: an instruction that can disagree with the
 * channel that actually presented is worse than no instruction — it sends the person to a window that is not
 * there. A presenter that omits it gets neutral copy, never a guess.
 */
export const APPROVAL_CHANNELS = ["os_dialog", "terminal"] as const;
export type ApprovalChannel = (typeof APPROVAL_CHANNELS)[number];

export interface ApprovalPresenter {
  /** Where this presenter shows the code. Optional: an adapter that does not declare it gets neutral copy. */
  readonly channel?: ApprovalChannel;
  /**
   * Can this presenter reach a human RIGHT NOW? Asked before any secret is minted, so an unavailable channel
   * costs nothing and leaves no ephemeral state behind. Must be side-effect free.
   */
  available(): boolean;
  /**
   * Deliver the approval to the human. `presented` (the secret is where a human can read it) and `approved`
   * (a human affirmatively approved, in a surface this agent owns) are the two success shapes; anything else
   * means no approval exists and the caller MUST discard the pairing request.
   *
   * May be async: a native adapter shells out to an OS dialog and must NOT block the event loop (that would
   * freeze every WS socket, the heartbeat, and any hosted run for the life of the dialog). Sync adapters may
   * still return a plain result — the caller awaits either.
   */
  present(presentation: ApprovalPresentation): PresentResult | Promise<PresentResult>;
}

/**
 * **The fail-closed default.** Never available, never presents. An agent with no presenter wired refuses to
 * pair — it does not fall back to an unauthenticated confirm.
 */
export const nullApprovalPresenter: ApprovalPresenter = {
  available: () => false,
  present: () => ({ status: "unavailable", reason: "no_human_channel" }),
};
