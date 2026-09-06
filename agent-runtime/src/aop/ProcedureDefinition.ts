/**
 * <b>AOP Runtime Core — a business procedure stated as data, so the runtime can execute it.</b>
 *
 * LangGraph Orchestration Migration + AOP Runtime Core v1 §4. Agent Procedure Layer v1 named this
 * product's six procedures and gave each a PRECONDITION and a NEXT STEP; everything else about them —
 * which steps run, which tools they may reach, which guardrails hold, when they are finished, where a
 * human must decide — lived as control flow inside {@code ConversationService}. This file is that
 * remainder, written down.
 *
 * <b>What a definition is allowed to be.</b> A typed record. Not a DSL, not a script, not a string a
 * business user edits: {@code compile.ts} turns one of these into a LangGraph subgraph and nothing
 * else reads them. A natural-language compiler, a visual editor and a builder for non-engineers are
 * explicitly out of scope for v1 — the value being bought here is that the six procedures become
 * INSPECTABLE and TESTABLE as data, not that they become editable by anyone.
 *
 * <b>What a definition may never contain.</b> A tool that writes; an approval decision; a sentence
 * keyed to an example phrase; a new capability. The first is checked structurally
 * ({@link ProcedureDefinition.allowedTools} is intersected with the READ-only registry), the second is
 * the reason {@link InterruptKind} exists at all — a procedure may STOP for a human, and it may never
 * be the thing that says yes.
 *
 * <b>Versioning.</b> Every definition carries {@code version}. A procedure's shape is now part of the
 * runtime's provenance the way a prompt version is: a checkpoint resumed against a different shape is
 * a different procedure, and the id alone cannot say so.
 */
import type { ProcedureId } from "../operator/procedure/Procedure";

/**
 * What the runtime may put in graph state on this procedure's behalf.
 *
 * <b>References, never objects</b> (§5). A checkpoint is an execution cursor; the draft, the evidence,
 * the approval and the marketplace outcome are facts that belong to the database, and a copy of one in
 * a checkpoint is a second source of truth that can disagree with the first after a resume.
 */
export type ReferenceKind =
  /** `inquiry_work_item.id` — the identifier every inquiry read and write is addressed by. */
  | "WORK_ITEM_ID"
  /** `inquiries.id`, as the conversation's artifacts and deep links carry it. */
  | "INQUIRY_ID"
  | "REVIEW_ID"
  | "PRODUCT_ID"
  /** `review_issue.id` — the repeated problem an improvement opportunity is derived from. */
  | "ISSUE_ID"
  /** The knowledge candidate a capture question is bound to. */
  | "CANDIDATE_ID"
  /** A channel code (`NAVER` | `COUPANG` | `CAFE24`) — a closed token, not a row. */
  | "CHANNEL_CODE"
  /** The append-only draft version a tone revision or an approval is bound to. */
  | "DRAFT_VERSION";

/**
 * A property that must hold for every run of this procedure, named so a test can hold it to it.
 *
 * These are not new rules. Each one already exists in this repository — the list makes the procedure
 * say WHICH of them it is standing on, which is the difference between a rule that is enforced
 * somewhere and a rule this procedure is known to depend on.
 */
export type GuardrailId =
  /** The tool catalogue is 100% READ and a structural test refuses a write into it. */
  | "READ_ONLY_TOOLS"
  /** Nothing in this procedure sends to a marketplace; execution is a separate, approved node. */
  | "NO_MARKETPLACE_WRITE"
  /** 「없습니다」 may only be said from `ZERO_MEASURED` — `Procedure.absenceSentence`. */
  | "ABSENCE_ONLY_FROM_MEASURED_ZERO"
  /** A draft is prepared only through the object's own precondition. */
  | "DRAFT_BEHIND_PRECONDITION"
  /** The seller's approval is validated by the existing contract, never by an interrupt resuming. */
  | "APPROVAL_VALIDATED_SEPARATELY"
  /** A resumed run re-reads the stored record instead of replaying the side effect. */
  | "RESUME_IS_IDEMPOTENT"
  /** No sentence in this procedure is selected by matching the seller's words. */
  | "NO_PHRASE_MATCHING";

/**
 * Where this procedure may stop and wait for a person — and for what.
 *
 * <b>An interrupt is a pause, not a permission</b> (§6). Resuming one does not approve anything: the
 * approval contract runs afterwards, in its own node, against its own record.
 */
export type InterruptKind =
  /** A step only the seller can perform on the marketplace (export, consent, login). */
  | "HUMAN_ACTION_ON_CHANNEL"
  /** A question this procedure asked the seller, whose answer becomes seller-entered knowledge. */
  | "KNOWLEDGE_ANSWER"
  /** A prepared draft waiting for the seller to approve sending it. */
  | "SEND_APPROVAL";

/** How a run of this procedure ends. Closed, because «it finished» and «it stopped» are different. */
export type TerminalKind =
  /** The procedure produced its answer. */
  | "ANSWERED"
  /** Its precondition failed; the answer says why, and offers the next step when there is one. */
  | "BLOCKED_BY_PRECONDITION"
  /** It is waiting for a person. The turn is not finished and says so. */
  | "WAITING_HUMAN"
  /** Nothing could be read to decide. Claim nothing. */
  | "UNKNOWN";

/**
 * One named unit of work inside a procedure.
 *
 * <b>The step names an implementation, it does not contain one.</b> This repository's semantics live in
 * tested code, and a v1 that re-expressed them as data would be re-implementing them — so the step
 * carries a {@link HandlerName} and {@code compile.ts} binds it to the runtime's handler table. What
 * the definition adds is the NAME, the ORDER and the contract around them; what it refuses to add is a
 * second implementation of anything.
 */
export interface ProcedureStep {
  readonly id: string;
  /** One line, for the trace and for a reader of the definition. Never shown to the seller. */
  readonly does: string;
  /** The runtime handler that performs it. Every name here must exist — a test asserts it. */
  readonly handler: HandlerName;
  /** May this step be skipped when its inputs are already present? */
  readonly optional?: boolean;
}

/**
 * The handlers a procedure may name.
 *
 * Closed on purpose: a procedure cannot reach a behaviour the runtime has not published, and adding a
 * behaviour is a deliberate edit in two places rather than a string appearing in a definition.
 */
export type HandlerName =
  /** Derive this turn's {@code WorldState} (one coverage read, memoised for the turn). */
  | "hydrateWorld"
  /** Evaluate the procedure's precondition and, when it fails, settle the absence and next step. */
  | "checkPrecondition"
  /** Run the Operator graph for this turn's plan — specialists, tools, evidence, judge. */
  | "runOperator"
  /** Resolve the object this procedure acts on, from the anchor or the sentence's own narrowing. */
  | "resolveTarget"
  /** Prepare a reply draft through the backend's production draft path. */
  | "prepareDraft"
  /** Re-run the draft with a tone hint, over the SAME evidence and a new version. */
  | "reviseDraft"
  /** Ask the seller for a missing answer basis, and stop. */
  | "askKnowledge"
  /** Store the seller's answer through the seller-write seam, then resume the original work once. */
  | "storeKnowledge"
  /** Read the improvement opportunities derived from a repeated problem. */
  | "readOpportunities"
  /** Turn what the run produced into artifacts, sentences and chips. */
  | "compose"
  /** Publish the human step the seller must perform, and stop. */
  | "requestHumanAction"
  /** Validate a standing approval against its own record — never against the fact of a resume. */
  | "validateApproval"
  /** Perform the approved side effect, once, behind the existing single-use fence. */
  | "execute";

/**
 * The entry condition, as data.
 *
 * <b>Declarative because routing is the thing being moved.</b> LangGraph now owns procedure routing
 * (§2), and a router that had to call arbitrary predicates could not be inspected, ordered or tested
 * as a table. Every field below is a closed token this runtime already has; an absent field means the
 * procedure does not care about that axis.
 */
export interface ProcedureEntry {
  /** One line, for the reader. */
  readonly when: string;
  /** Which readiness states admit this procedure. Absent ⇒ any. */
  readonly readiness?: readonly ("NO_CHANNEL" | "NO_DATA" | "WORKING" | "UNKNOWN")[];
  /** Which anchored object this procedure needs. Absent ⇒ it does not need one. */
  readonly anchor?: "INQUIRY" | "REVIEW" | "PRODUCT";
  /** Which requested actions admit it. Absent ⇒ any. */
  readonly requestedAction?: readonly string[];
  /** Any one of these plan need kinds present admits it. Absent ⇒ not considered. */
  readonly needKinds?: readonly string[];
  /** Requires a knowledge question already standing on this conversation. */
  readonly pendingCapture?: boolean;
  /**
   * Order among procedures whose conditions both hold — lower runs first.
   *
   * A total order rather than a first-match list, because the table is read by two things (the router
   * and its test) and «first in the file» is not a property either of them should depend on.
   */
  readonly priority: number;
}

export interface ProcedureDefinition {
  readonly id: ProcedureId;
  /** `<kebab-id>/v<n>` — part of the runtime's provenance, like a prompt version. */
  readonly version: string;
  readonly entry: ProcedureEntry;
  readonly steps: readonly ProcedureStep[];
  /** Tool names this procedure may reach. Intersected with the READ-only registry by a test. */
  readonly allowedTools: readonly string[];
  /** What may sit in graph state on its behalf — ids and closed tokens only. */
  readonly references: readonly ReferenceKind[];
  readonly guardrails: readonly GuardrailId[];
  /** The terminals this procedure can reach. A terminal it cannot reach is not listed. */
  readonly completion: readonly TerminalKind[];
  /** Where it may stop for a person. Empty means it never does. */
  readonly humanInterrupt: readonly InterruptKind[];
}

/** Every definition, by id — filled by the registry. */
export type ProcedureCatalogue = Readonly<Record<ProcedureId, ProcedureDefinition>>;
