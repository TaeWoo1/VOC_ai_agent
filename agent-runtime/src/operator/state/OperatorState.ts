/**
 * The OperatorGraph's shared state (a LangGraph `Annotation.Root`).
 *
 * <b>Evidence is a first-class channel here, not a by-product.</b> Every read a specialist makes lands
 * as an {@link EvidenceRef}, every sentence the Operator wants to say is a {@link Finding} that names
 * the evidence ids it rests on, and `compose` drops any finding whose list is empty. That chain —
 * finding → evidenceId → tool + arguments + locator — is what makes an answer traceable back to the
 * row it came from, which is the property the whole design is for.
 *
 * <b>No customer text lives in any channel.</b> An `EvidenceRef` carries ids, closed-vocabulary
 * labels, counts and dates. A `Finding.statement` is a sentence SellerOps composed. The one piece of
 * prose that may appear anywhere near this state is a past APPROVED reply (operator-authored, masked
 * at the backend) reaching the inquiry draft path — and it does not live here.
 */
import { Annotation } from "@langchain/langgraph";
import type { AgentGoal } from "../../goal/parseGoal";
import type { SpecialistTerminal, ToolFailure } from "../failure/SpecialistOutcome";
import type { AttentionCoverage, KnowledgeCoverageRow, ProductKnowledge, SignalCoverage } from "../../spring/types";
import type { InvestigationPlan, NeedState, ResolvedEntity } from "../plan/InvestigationPlan";
import { mergeNeedState } from "../plan/needOutcome";
import type { EventRange } from "../scope/EvidenceTime";
import type { Artifact, WorkingSetView } from "../../conversation/contract";

/**
 * What a tool is allowed to do.
 *
 * `WRITE` exists in this type and in no tool. Naming it is the point: a class that cannot be spelled
 * is a class nobody can check for, and {@link OperatorToolRegistry} refuses at construction time any
 * tool declaring it. See `docs/sellerops_operator_graph_v1.md` §3.
 */
export type ActionClass = "READ" | "PREPARE" | "WRITE";

/** The specialists an Operator plan may dispatch to. A closed set; an unknown name fails closed. */
export type SpecialistName = "PRODUCT_OPS" | "REVIEW_OPS" | "INQUIRY_OPS" | "ORDER_OPS" | "REPORT_OPS";

/** The evidence kinds. Mirrors the backend's `SignalCoverageView` signal names plus the run-only ones. */
export type EvidenceKind =
  | "REVIEW_ISSUE"
  /* How many of ONE issue's review rows belong to ONE product — the only product-scoped issue fact. */
  | "ISSUE_EVIDENCE"
  /**
   * How many NEGATIVE REVIEWS one product has, and when they arrived.
   *
   * <b>Its own kind because it counts a different thing.</b> `ISSUE_EVIDENCE` counts opinion units an
   * extractor tied to a repeated problem; this counts whole reviews the ingest marked negative. Giving
   * them one kind would let a sentence about 부정 리뷰 rest on issue rows and vice versa — the rename
   * `group/ReviewEvidenceSense.ts` exists to refuse.
   */
  | "NEGATIVE_REVIEW"
  | "REVIEW"
  | "INQUIRY"
  | "PAST_REPLY"
  | "ITEM_ANALYSIS"
  | "INBOX_COUNT"
  | "PRODUCT_SIGNAL"
  | "REPEATED_INQUIRY"
  | "CUSTOMER_MEMORY"
  /* Operator Graph v2 — product knowledge is evidence, so it has its own kinds. */
  | "PRODUCT_FACT"
  | "PRODUCT_LISTING"
  | "PRODUCT_VARIANT"
  | "PRODUCT_KNOWLEDGE_GAP"
  /**
   * A passage of the seller's OWN writing about a product — the Product Knowledge library.
   *
   * A separate kind from `PRODUCT_FACT` on purpose: that is what a CHANNEL stated and carries the
   * channel's name and observation time, this is what a PERSON wrote and carries an author. An answer
   * grounded in the seller's own words is a different claim from one grounded in a catalogue read,
   * and a judge that cannot tell them apart cannot weigh either.
   */
  | "PRODUCT_KNOWLEDGE_DOC"
  /**
   * A passage of the company's OWN operating rules — `org_knowledge_sources` (Knowledge Context v1-A).
   * Not a product fact and not a product document: it belongs to the org, names no product, and is what
   * a sentence about 배송·교환·환불 기준 rests on.
   */
  | "ORG_POLICY"
  /** The company has no registered rule that covers this question — its own fact, never a refusal. */
  | "ORG_POLICY_GAP"
  /**
   * An axis the data cannot be cut along — "반복 문의에는 상품 정보가 없다".
   *
   * <b>Its own kind because it is its own fact.</b> A grouped answer that quietly stopped grouping
   * would read as "these are the totals"; this row is what a sentence about the MISSING axis rests on,
   * and giving it the kind of the rows it could not group ("REPEATED_INQUIRY") would put an undated,
   * countless row into a channel whose every member knows when it was seen.
   */
  | "GROUPING_GAP"
  /**
   * What one channel can currently say about one data type — the FRESHNESS axis, as evidence.
   *
   * <b>Its own kind because it is the only evidence about what is NOT there.</b> Every other kind is
   * minted from rows and can therefore only describe what was seen; this one is minted from a channel's
   * capability, connection, routine state and newest row, and it is what a sentence like "네이버 문의는
   * 자동 수집이 멈춰 있어 지금이 최신인지 확인하지 못했습니다" rests on. Giving it the kind of the rows
   * it is about would let a coverage sentence be cited as a count, and a count as a coverage sentence.
   */
  | "CHANNEL_COVERAGE"
  /* ── Agentic Operating Workspace v2 (2026-08-27) ── */
  /** Review ROWS in a window — a list, dated by the rows' own dates. Never the issue signal. */
  | "REVIEW_LIST"
  /** A window's order/sales totals — a COUNT dated by the window. */
  | "ORDER_SUMMARY"
  /** A step only the seller can take before a question can be answered — a GAP, stated as evidence. */
  | "HUMAN_ACTION";

/**
 * Where a claim came from. Ids, labels, counts and dates — never a body, never a quote.
 *
 * `sourceCall` is a stable digest of the tool arguments rather than the arguments themselves: it is
 * enough to tell two reads apart and to dedupe them, and it cannot accidentally carry a parameter that
 * turns out to be content.
 */
export interface EvidenceRef {
  readonly evidenceId: string;
  readonly kind: EvidenceKind;
  readonly sourceTool: string;
  readonly sourceCall: string;
  readonly locator: EvidenceLocator;
  /**
   * When SellerOps READ this (ISO date-only). Proves freshness, and nothing else.
   *
   * <b>It is not the data's own date.</b> Keeping the two apart is the whole of
   * `scope/EvidenceTime.ts`: an inbox count read today says nothing about when the inquiries in it
   * arrived, and letting this field stand in for that is how "현재 미답변 69건" becomes
   * "오늘 들어온 문의 69건".
   */
  readonly asOf: string | null;
  /**
   * When the underlying rows actually happened. `null` when the source cannot say — never "now".
   *
   * Only evidence carrying this may support a claim about a period.
   */
  readonly events: EventRange | null;
  /**
   * Whether the source that produced this evidence could answer for the scope at all. Carried on the
   * evidence rather than beside it, because the judge reads one finding's evidence and must be able
   * to see, without any other context, that an empty count came from a blind spot.
   */
  readonly coverage: AttentionCoverage;
  readonly provenance: string;
}

/** Locating fields only. Every one is an id, a closed-vocabulary label, or a count. */
export interface EvidenceLocator {
  readonly issueId?: string;
  readonly workItemId?: string;
  readonly inquiryId?: string;
  readonly reviewActionRef?: string;
  readonly productId?: string;
  readonly productName?: string;
  readonly accountId?: string;
  readonly channelCode?: string;
  readonly count?: number;
  readonly label?: string;
  readonly severity?: string;
  /**
   * One inquiry's operational state — the work-item phase (`OPEN`/`PROPOSED`/…) and the channel
   * answer status (`UNANSWERED`/`ANSWERED`). Closed backend vocabulary, never text; carried so a
   * contextual run can SAY what state the inquiry it was opened on is in without a second read.
   */
  readonly phase?: string;
  readonly status?: string;
  /** Product-fact evidence: which key, and the source that stated it. Never free prose. */
  readonly factKey?: string;
  readonly factSource?: string;
  readonly variantId?: string;
  /** Which knowledge facet a gap refers to — IDENTITY / LISTING / SPEC / … */
  readonly facet?: string;
  /**
   * Product Knowledge library: which document and which passage of it.
   *
   * Both, not one. The document id is what a seller opens to check the claim; the passage id is what
   * makes two runs of the same question demonstrably cite the same sentence, which is the difference
   * between reproducible evidence and a quote that happens to look familiar.
   */
  readonly sourceId?: string;
  readonly chunkId?: string;
  /** The document's own title, so a citation can be named without re-reading it. */
  readonly title?: string;
}

/** The judge's verdict over one finding. `judgeKind` is provenance — a label is never hardcoded. */
export interface JudgeVerdict {
  readonly hasEvidence: boolean;
  readonly supportingEvidenceIds: readonly string[];
  readonly unsafeAssertion: boolean;
  readonly unsafeReason: string | null;
  readonly needsMore: boolean;
  readonly needsMoreTool: string | null;
  readonly needsMoreReason: string | null;
  readonly judgeKind: "LLM" | "RULE_BASED";
  readonly judgeVersion: string;
}

/**
 * One thing the Operator wants to say, and what it rests on.
 *
 * `confidence` is not a number. It is the three answers a seller actually needs distinguished:
 * `SUPPORTED` (say it), `NEEDS_REVIEW` (show it as something to check, not as a claim), and
 * `UNSUPPORTED` (do not present it as a finding at all). A percentage would imply a calibration
 * nothing here has.
 */
export type FindingConfidence = "SUPPORTED" | "NEEDS_REVIEW" | "UNSUPPORTED";

export interface Finding {
  readonly findingId: string;
  readonly specialist: SpecialistName;
  readonly statement: string;
  /**
   * What the MODEL judge is shown instead of `statement`, when the statement quotes the seller's own
   * passage (Knowledge Context v1-A). The seller reads their own words; the judge needs only that a
   * document of this kind and title covers the question — the passage body never leaves for the vendor.
   */
  readonly judgeStatement?: string;
  readonly evidenceIds: readonly string[];
  readonly confidence: FindingConfidence;
  readonly verdict: JudgeVerdict | null;
  /** A route into the authorized screen where the underlying rows are read. Never a raw body. */
  readonly surfaceLink: string | null;
  /**
   * True when the finding's claim IS the blind spot — "이 상품에 연결된 데이터가 없어 판단할 수 없습니다".
   *
   * <b>Without this flag the honest answer deletes itself.</b> The judge's core rule is that evidence
   * from an uncertain source does not support a claim, which is exactly right for a claim about the
   * DATA and exactly backwards for a claim about the COVERAGE: the uncertainty is what supports it.
   * A finding without the flag and an uncertain citation is dropped as unsupported — which would leave
   * a product with 3,208 unattributable inquiries answering "문제 없습니다", the false calm this whole
   * design exists to prevent.
   */
  readonly claimsCoverageLimit?: boolean;
  /**
   * Which information need this sentence answers.
   *
   * <b>Without it a run cannot notice its own silence.</b> v1 could declare no needs, so a goal that
   * asked three things and got one answer looked exactly like a goal that asked one. `compose` reads
   * this to find required needs that ended PENDING and to SAY so — "규격은 확인하지 못했습니다" —
   * instead of returning a confident partial answer.
   */
  readonly needId?: string;
}

/** A next step the seller may take. Its `actionClass` is always READ or PREPARE — never WRITE. */
export interface NextAction {
  readonly label: string;
  readonly actionClass: ActionClass;
  readonly surfaceLink: string;
}

/** What was spent, and what was left unseen because of it. Reported, never silently applied. */
export interface BudgetReport {
  readonly iterations: number;
  readonly toolCalls: number;
  readonly llmCalls: number;
  readonly elapsedMs: number;
  readonly exhausted: boolean;
  readonly stopReason: OperatorStopReason;
}

/**
 * How a run ended.
 *
 * `NO_PLAN` now means the model understood and refused (`riskClass: REFUSE`, or `supported: false`) —
 * a real answer. A plan that could not be MADE is not a stop reason at all: it is a failed run
 * ({@link OperatorFailureCode}), because there is no deterministic planner to produce a lesser answer.
 */
export type OperatorStopReason =
  | "COMPLETE"
  | "BUDGET_EXHAUSTED"
  | "NO_PLAN"
  | "CLARIFICATION_NEEDED"
  | "REPLAN_UNAVAILABLE";

/**
 * Why a run produced no answer at all.
 *
 * Every value ends the run. None of them selects an alternative planner — that is the whole content of
 * invariant I2, expressed as a type with no "fell back to" member.
 */
export type OperatorFailureCode =
  | "PLANNER_UNAVAILABLE"
  | "PLANNER_CAPABILITY_OFF"
  /**
   * The org spent its daily Agent budget.
   *
   * <b>Its own code, not a flavour of `PLANNER_CAPABILITY_OFF`.</b> A client showing "이 기능이
   * 꺼져 있습니다" for a ceiling that resets at midnight sends the seller to an admin who has nothing
   * to change. The deterministic surfaces are unaffected by this code and a client may say so.
   */
  | "AGENT_QUOTA_EXHAUSTED"
  | "PLAN_INVALID"
  /**
   * The plan was made and the reads were attempted, and none of them came back with anything the run
   * could say.
   *
   * <b>Added because `DONE` with zero findings was being used for two different things.</b> "I looked
   * and your data is quiet" and "the reads that would have answered you failed" are opposite facts, and
   * a seller cannot tell them apart from an empty answer card. This code is only ever returned when a
   * specialist actually FAILED — an empty-but-healthy run stays `DONE`, because it is one.
   */
  | "EVIDENCE_UNAVAILABLE";

/** What a specialist returns: findings, the evidence behind them, and any coverage limits it hit. */
export interface SpecialistResult {
  readonly specialist: SpecialistName;
  readonly findings: readonly Finding[];
  readonly evidence: readonly EvidenceRef[];
  readonly coverage: readonly SignalCoverage[];
  readonly note?: string;
  /**
   * Reads that did not produce evidence, and why. Closed vocabulary; never a value or a message.
   *
   * <b>Optional so that a specialist which cannot fail partially does not have to say so</b> — the
   * graph derives {@link terminal} when a specialist reports neither field, which keeps ReportOps
   * (no tools at all) and the existing suites unchanged.
   */
  readonly failures?: readonly ToolFailure[];
  /** OK / PARTIAL / FAILED, when the specialist knows its own. Derived by the graph otherwise. */
  readonly terminal?: SpecialistTerminal;
  /**
   * Structured objects the conversation lane renders (Agentic Operating Workspace v2).
   *
   * Composed by the specialist from the rows it read — closed {@code ArtifactType}s only. They ride
   * beside findings, never instead of them: every sentence still rests on evidence, and an artifact
   * with no finding behind it is a table with nothing said about it.
   */
  readonly artifacts?: readonly Artifact[];
}

/** What a conversation hands a run: the previous working set, and closed-vocabulary lines for the planner. */
export interface ConversationRunContext {
  readonly workingSet: WorkingSetView | null;
  /** Closed tokens only — `직전 작업 집합: REVIEWS (기간:TODAY, …)`. Built by the conversation service. */
  readonly priorLine?: string;
  /**
   * Human steps this conversation itself saw finish (a REVIEW collection the seller ran after being
   * asked). A finished step is a fact about the channel for the window it covers — the coverage row the
   * backend serves cannot know a file upload was a collection, so the runtime carries it.
   */
  /**
   * The window of a review collection the seller was already asked for and has not finished. Asking the
   * same window again must not ask a second time — the rows held are shown instead.
   */
  readonly pendingHumanWindow?: string | null;
  readonly collected?: ReadonlyArray<{
    readonly channelCode: string; readonly dataType: string; readonly finishedAt: string;
    /** The run's own count of rows it brought in — INGESTED, never "written in the window" (`conversation/reviewClaim.ts`). */
    readonly successRows?: number | null;
  }>;
  /** Whether the seller's local agent is paired, as the frontend last saw it. Absent ⇒ UNKNOWN. */
  readonly localAgent?: "PAIRED" | "ABSENT" | "UNKNOWN";
}

/** One specialist's terminal state as the answer reports it. */
export interface SpecialistOutcomeView {
  readonly specialist: SpecialistName;
  readonly terminal: SpecialistTerminal;
  readonly failures: readonly ToolFailure[];
}

/** The Operator's terminal answer. Sanitized by construction — every field above is. */
export interface OperatorAnswer {
  readonly goalEcho: string;
  /**
   * Which planner produced this answer. One value, because there is one planner.
   *
   * Kept as a field rather than dropped: it is PROVENANCE, and a surface that wants to say how an
   * answer was interpreted must read it rather than assume — the rule `draftKindLabel` follows. The
   * model identity is in {@link plannerVersion}.
   */
  readonly plannerKind: "LLM";
  readonly plannerVersion: string;
  /** What the planner decided it needed to find out, and whether it did. */
  readonly needs: readonly AnsweredNeed[];
  readonly specialists: readonly SpecialistName[];
  readonly findings: readonly Finding[];
  readonly evidence: readonly EvidenceRef[];
  readonly coverage: readonly SignalCoverage[];
  readonly nextActions: readonly NextAction[];
  /** Per-facet availability for any product the run resolved. Reported beside, never merged with, coverage. */
  readonly knowledgeCoverage: readonly KnowledgeCoverageRow[];
  /** Present when the plan asked a question back instead of answering. */
  readonly clarification: string | null;
  readonly budget: BudgetReport;
  /**
   * How each dispatched specialist ended, and what it could not read.
   *
   * <b>Present even when everything worked</b>, because "no failures" is only informative if the field
   * would have shown them. A run that hides a specialist's exception behind a normal-looking answer is
   * the Q5 defect; this is where that stops being possible.
   */
  readonly specialistOutcomes: readonly SpecialistOutcomeView[];
  /** What was NOT seen — a truncated read, a skipped specialist, an uncertain source. Never silent. */
  readonly note?: string;
}

/** One need as the answer reports it — the question, and what became of it. */
export interface AnsweredNeed {
  readonly id: string;
  readonly question: string;
  readonly status: NeedState["status"];
  readonly required: boolean;
  readonly evidenceIds: readonly string[];
  readonly reason?: string;
}

export const OperatorStateAnnotation = Annotation.Root({
  goal: Annotation<AgentGoal | null>({ reducer: (_p, n) => n, default: () => null }),
  goalText: Annotation<string>({ reducer: (_p, n) => n, default: () => "" }),
  plan: Annotation<InvestigationPlan | null>({ reducer: (_p, n) => n, default: () => null }),
  // Needs MERGE by id, and the merge is by STRENGTH: a re-plan may add needs, a second pass may satisfy
  // one the first left open, and two specialists routinely answer the same need on one pass. Replacing
  // the channel wholesale would lose the first pass's answers on every re-plan; keeping the last write
  // loses the better answer whenever a weaker specialist happens to run second.
  //
  // <b>A resolved need never regresses to PENDING, and a complete covered answer is never overwritten
  // by a bounded one.</b> The first was found live 2026-08-21 (a budget-exhausted second pass wrote
  // PENDING over a need the first pass had determined); the second live 2026-08-23, when a six-of-
  // nineteen org sweep replaced a product-scoped measured zero. Both are the same bug — a later write
  // that knows less — and `plan/needOutcome.ts` is the one rule that settles it.
  needs: Annotation<NeedState[]>({
    reducer: (prev, next) => {
      const byId = new Map(prev.map((n) => [n.id, n]));
      for (const state of next) {
        byId.set(state.id, mergeNeedState(byId.get(state.id), state));
      }
      return [...byId.values()];
    },
    default: () => [],
  }),
  // Entities resolved BY TOOLS during the run. The planner cannot write here — it has no id to write.
  entities: Annotation<ResolvedEntity[]>({
    reducer: (prev, next) => {
      const byKey = new Map(prev.map((e) => [`${e.kind}:${e.mention}`, e]));
      for (const entity of next) {
        byKey.set(`${entity.kind}:${entity.mention}`, entity);
      }
      return [...byKey.values()];
    },
    default: () => [],
  }),
  // The product knowledge a run has loaded, by product id — the source every product fact cites.
  knowledge: Annotation<Record<string, ProductKnowledge>>({
    reducer: (prev, next) => ({ ...prev, ...next }),
    default: () => ({}),
  }),
  results: Annotation<SpecialistResult[]>({ reducer: (_p, n) => n, default: () => [] }),
  // Evidence APPENDS: a second pass adds to what the first pass saw rather than replacing it, so a
  // finding's evidence ids stay resolvable after the loop goes round again.
  evidence: Annotation<EvidenceRef[]>({ reducer: (p, n) => [...p, ...n], default: () => [] }),
  findings: Annotation<Finding[]>({ reducer: (_p, n) => n, default: () => [] }),
  /**
   * Citations the evidence-scope gate refused, and why.
   *
   * <b>Carried in state rather than counted in place, because the answer has to be able to SAY it.</b>
   * A run that quietly drops three findings for scope reasons and returns two looks exactly like a run
   * that only ever found two — which is the shape of dishonesty this whole graph is built against.
   * `compose` reads this to add the withholding note. Ids and closed-vocabulary reasons only.
   */
  scopeRejections: Annotation<import("../scope/EvidenceScope").RejectedEvidence[]>({
    reducer: (p, n) => [...p, ...n], default: () => [],
  }),
  /** Every read that did not produce evidence this run, across every specialist and every pass. */
  specialistFailures: Annotation<ToolFailure[]>({
    reducer: (p, n) => [...p, ...n], default: () => [],
  }),
  answer: Annotation<OperatorAnswer | null>({ reducer: (_p, n) => n, default: () => null }),
  trail: Annotation<string[]>({ reducer: (p, n) => [...p, ...n], default: () => [] }),
  /** Artifacts APPEND like evidence: a second pass adds objects rather than replacing the first's. */
  artifacts: Annotation<Artifact[]>({ reducer: (p, n) => [...p, ...n], default: () => [] }),
  /** The conversation's context for this run. Set once by the runtime; the graph only reads it. */
  conversation: Annotation<ConversationRunContext | null>({ reducer: (_p, n) => n, default: () => null }),
});

export type OperatorState = typeof OperatorStateAnnotation.State;
