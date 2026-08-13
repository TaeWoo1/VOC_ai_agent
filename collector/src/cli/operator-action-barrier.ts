/**
 * **The ACTION BARRIER: where auto-read stops and a person decides.**
 *
 * ## The policy this implements
 *
 * A run may watch the seller's screen and advance its own guidance on what it sees. That is the Action Window's
 * whole shape, and it is what makes the walks usable — nobody wants a confirmation prompt in front of every
 * read. Reading is not acting.
 *
 * What a reading may never do is cross into ACTING. Before any of {@link ActionBarrierKind} — a click on the
 * marketplace, a submission, an export, a download, an upload, a credential reveal, a destructive act — the run
 * asks, and waits for a verified press.
 *
 * ## Two provenances, and they are not substitutable
 *
 * {@link OBSERVED_BY_AUTO_READ} says a page LOOKED a certain way. {@link OPERATOR_UI_CONFIRMED} says a person
 * decided something. A run that treats the first as the second has decided on the seller's behalf and called it
 * their choice — which is the same defect as advancing on chat text, arriving through a nicer-looking door: the
 * reading is real, the inference from it is not the seller's.
 *
 * They are separate types here so that "the page looked ready" cannot be passed where an approval is required.
 *
 * ## Why the ask sits at the barrier and not at the top of the run
 *
 * A readiness hand-off at the start authorizes a run; it cannot authorize an act the run decides on minutes
 * later, on a page the operator has since changed. `capture-export-same-session`'s opt-in hand-off ran at the
 * top and the export click happened after a reconnect, a re-read, a gate and a readiness poll — the operator who
 * pressed at the beginning was not shown the thing that was eventually clicked.
 *
 * So the ask names what is about to happen, and what happens after it, at the moment it is about to happen.
 */
import type { OperatorConfirmAsk, OperatorConfirmation } from "./operator-confirm";

/**
 * What a READING is. Deliberately not a provenance that any approval field will accept — a page that looked a
 * certain way is evidence about the page, never a decision by a person.
 */
export const OBSERVED_BY_AUTO_READ = "AUTO_READ" as const;
export type ObservationProvenance = typeof OBSERVED_BY_AUTO_READ;

/**
 * The acts that may not be reached by reading alone. Each is a thing the seller would have to undo, explain, or
 * could not undo at all.
 */
export const ACTION_BARRIER_KINDS = [
  /** A real click on the marketplace's own control. */
  "MARKETPLACE_CLICK",
  /** A form submission on the marketplace. */
  "MARKETPLACE_SUBMIT",
  /** Triggering an export — the marketplace does work on the seller's data because we asked. */
  "EXPORT_TRIGGER",
  /** A file lands on this machine. */
  "DOWNLOAD",
  /** The seller's data leaves this machine for a backend. */
  "UPLOAD",
  /** A credential is put on screen or read. */
  "CREDENTIAL_REVEAL",
  /** Something the seller cannot undo. */
  "DESTRUCTIVE",
] as const;
export type ActionBarrierKind = (typeof ACTION_BARRIER_KINDS)[number];

/** What the operator is being asked to allow. Every field is copy they will read. */
export interface ActionBarrierSpec {
  readonly kind: ActionBarrierKind;
  /** Step header, e.g. `계정 재연결`. */
  readonly title: string;
  /** The one line: what is about to happen, in the seller's terms. */
  readonly headline: string;
  /**
   * Everything this ONE press allows, in order — including what follows automatically.
   *
   * A press that covers a chain must disclose the chain: an operator who approves "click the export control"
   * and then finds a file downloaded and uploaded has been told less than they agreed to. One press per
   * disclosed chain is honest; one press per hidden chain is not.
   */
  readonly allows: readonly string[];
  /** What this run still will not do, even after the press. */
  readonly stillWillNot: string;
}

/** Build the barrier's ask. The kind is on the title, so the operator sees the CLASS of act, not only its words. */
export function actionBarrierAsk(spec: ActionBarrierSpec): OperatorConfirmAsk {
  return {
    title: `동작 확인 — ${spec.title}`,
    headline: spec.headline,
    confirmLabel: ACTION_BARRIER_BUTTON_LABEL,
    lines: [
      "이 버튼을 누르시면 SellerOps가 다음을 실행합니다:",
      ...spec.allows.map((a) => `  · ${a}`),
      "",
      `그래도 하지 않는 것: ${spec.stillWillNot}`,
      "",
      "누르지 않으시면 아무것도 실행되지 않고 여기서 멈춥니다.",
    ],
  };
}

/** The button that allows an ACT. Named for what the press does — not "this screen is ready". */
export const ACTION_BARRIER_BUTTON_LABEL = "실행 허용";

/** The one seam a caller supplies: an armed confirmation surface. */
export interface ActionBarrierHost {
  announce(ask: OperatorConfirmAsk): void;
  confirm(ask: OperatorConfirmAsk): Promise<OperatorConfirmation>;
}

/**
 * Ask, and report whether the act may proceed. `false` for everything that is not a verified press — a timeout
 * and an abort are both "the operator did not allow this", and a caller that cannot tell them apart cannot get
 * them wrong.
 */
export async function confirmActionBarrier(host: ActionBarrierHost, spec: ActionBarrierSpec): Promise<boolean> {
  const ask = actionBarrierAsk(spec);
  host.announce(ask);
  return (await host.confirm(ask)).signal === "ready";
}

/**
 * The machine-readable refusal, for stdout — ONE shape across every CLI that has a barrier.
 *
 * A refusal that prints nothing is indistinguishable from a crash before the print to anything reading the
 * output, and four CLIs each inventing their own shape is four things a harness has to know. This is also why
 * **no status file is written on a refusal**: every `CollectorState` describes something that happened to a
 * collection attempt, and nothing happened. The record says so out loud instead, so "the seller declined" is a
 * fact a reader can see rather than the absence of one.
 */
export function barrierRefusedRecord(kind: ActionBarrierKind): string {
  return JSON.stringify({ event: "ACTION_BARRIER", outcome: "NOT_ALLOWED", kind, acted: false });
}

/** The operator-facing line when an act was not allowed. Sanitized: it names the act's KIND, never a value. */
export function actionBarrierRefusedMessage(kind: ActionBarrierKind): string {
  return `실행이 확인되지 않아 여기서 멈춥니다 (${kind}). 아무것도 실행되지 않았습니다.`;
}
