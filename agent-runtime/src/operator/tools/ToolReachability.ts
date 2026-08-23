/**
 * Which tools a specialist can actually execute — the catalogue's claim, made checkable.
 *
 * <b>Why this file exists.</b> On 2026-08-23 the planner was shown 18 tools and only 7 of them were
 * invoked by any line of code. `get_review_issue_evidence_summary` — the ONLY read in the system that
 * can say how many of an issue's review rows belong to one product — was among the eleven, which is
 * why a seller asking about their own product by name got org-wide issue rows, watched the scope gate
 * refuse every one of them, and was told nothing (`docs/agent_real_validation_v1.md` §5 P4, A5, B1).
 * A catalogue that advertises a capability nothing can perform is not a catalogue, it is a promise;
 * the planner spent model budget choosing tools that could never run.
 *
 * <b>What it fixes, and the shape of the fix.</b> Not "make all 18 reachable" — several of them
 * duplicate a read that already runs, and one of them (`get_inquiry_detail`) carries customer text
 * the Operator has no lane to use. The property restored is the honest one: <b>the set of tools the
 * planner is shown equals the set some specialist can actually execute.</b> A tool earns its way into
 * this table by having a caller; everything else stays registered, stays READ, and stays out of the
 * planner's sight until a specialist owns it.
 *
 * <b>The preconditions are part of the capability, not a footnote.</b> A tool that needs a resolved
 * product must not be called without one — the failure that produces is not an error, it is an answer
 * about a product nobody looked at. They are declared here so a test can assert them and so the
 * unreachable rows can be told apart from the merely-unsatisfied ones.
 *
 * This table does not authorize anything by itself: {@link OperatorToolRegistry} still refuses a name
 * outside the run's plan, and the registry is still READ end to end.
 */
import type { SpecialistName } from "../state/OperatorState";
import type { NeedKind } from "../plan/InvestigationPlan";
import { OPERATOR_TOOL } from "./OperatorTools";
import type { OperatorToolName } from "./OperatorTools";

/**
 * What must already be true before a tool may be called.
 *
 * `NONE` is a real value and not a shrug: an org-wide list read needs nothing but the caller's org,
 * and saying so is what makes the other rows meaningful.
 */
export type ToolPrecondition =
  /** Nothing beyond the authenticated org. */
  | "NONE"
  /** The seller named something to look up. Not yet an id — that is what the tool produces. */
  | "PRODUCT_MENTION"
  /** A product this run RESOLVED. Never a mention, never a planner-supplied id. */
  | "RESOLVED_PRODUCT"
  /** An issue id from a list this run already read. */
  | "ISSUE_ID";

export interface ToolCapability {
  readonly specialist: SpecialistName;
  readonly tool: OperatorToolName;
  /** The need kinds this call can contribute to. Empty is not allowed — a tool serves some need. */
  readonly needKinds: readonly NeedKind[];
  readonly requires: readonly ToolPrecondition[];
}

/**
 * The capability matrix. One row per (specialist, tool) pair that has an execution path TODAY.
 *
 * Keep it in step with the code by deleting a row when its call site goes, not by remembering to:
 * `toolReachability.test.ts` reads the specialist sources and fails when a row has no
 * `registry.invoke` behind it, and fails again when an invoked tool has no row.
 */
export const TOOL_CAPABILITIES: readonly ToolCapability[] = [
  // ── ProductOps — what the seller sells, and what is happening to it.
  {
    specialist: "PRODUCT_OPS",
    tool: OPERATOR_TOOL.RESOLVE_PRODUCT,
    needKinds: ["PRODUCT_FACT", "PRODUCT_LISTING", "PRODUCT_VARIANT", "REVIEW_SIGNAL", "INQUIRY_VOLUME"],
    // The one tool that MAKES a product id, so it cannot require one.
    requires: ["PRODUCT_MENTION"],
  },
  {
    specialist: "PRODUCT_OPS",
    tool: OPERATOR_TOOL.GET_PRODUCT_KNOWLEDGE,
    needKinds: ["PRODUCT_LISTING", "PRODUCT_VARIANT", "PRODUCT_FACT", "REVIEW_SIGNAL", "INQUIRY_VOLUME"],
    requires: ["RESOLVED_PRODUCT"],
  },
  {
    specialist: "PRODUCT_OPS",
    tool: OPERATOR_TOOL.SEARCH_PRODUCT_FACTS,
    needKinds: ["PRODUCT_FACT"],
    requires: ["RESOLVED_PRODUCT"],
  },

  // ── ReviewOps — which repeated problems are live, and whose they are.
  {
    specialist: "REVIEW_OPS",
    tool: OPERATOR_TOOL.SEARCH_REVIEW_ISSUES,
    needKinds: ["REVIEW_SIGNAL"],
    requires: ["NONE"],
  },
  {
    // The A5 connection. Its two preconditions are both real: without the issue list there is no id to
    // ask about, and without a resolved product there is no product row to look for in the answer.
    specialist: "REVIEW_OPS",
    tool: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY,
    needKinds: ["REVIEW_SIGNAL"],
    requires: ["RESOLVED_PRODUCT", "ISSUE_ID"],
  },

  // ── InquiryOps — the queue, the repeats, and what was answered before.
  {
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.GET_TODAY_INBOX,
    needKinds: ["INQUIRY_VOLUME"],
    requires: ["NONE"],
  },
  {
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.LIST_REPEATED_INQUIRIES,
    needKinds: ["REPEAT_PATTERN"],
    requires: ["NONE"],
  },
  {
    // Anchored, and the anchor reachable today is a resolved product — `inquiryOps` skips the call and
    // says so rather than trawling the org (§10 A2).
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.SEARCH_CUSTOMER_MEMORY,
    needKinds: ["CUSTOMER_HISTORY"],
    requires: ["RESOLVED_PRODUCT"],
  },
];

/** Every tool with an execution path, deduped. This is what the planner is shown. */
export function reachableToolNames(): string[] {
  return [...new Set(TOOL_CAPABILITIES.map((c) => c.tool))].sort();
}

/**
 * The tools one specialist may use, whatever the plan named.
 *
 * <b>A specialist's tool needs are a property of the specialist, not of the plan.</b> The plan chooses
 * WHICH specialists run; it does not get to half-equip one. Found live 2026-08-21 the first time a real
 * model planned: it answered `tools: ["get_today_inbox"]` and both INQUIRY_OPS and REPORT_OPS then died
 * on `ToolNotInPlanError` reaching for the rest of their own work.
 *
 * REPORT_OPS has no row here and gets an empty list — it composes other specialists' findings and reads
 * nothing of its own, which an empty allow-list makes unbreakable rather than merely documented.
 */
export function toolsFor(specialist: SpecialistName): readonly string[] {
  return TOOL_CAPABILITIES.filter((c) => c.specialist === specialist).map((c) => c.tool);
}

/** Catalogue names with no execution path — what must NOT be advertised. */
export function unreachableToolNames(catalogue: readonly string[]): string[] {
  const reachable = new Set<string>(reachableToolNames());
  return catalogue.filter((name) => !reachable.has(name));
}
