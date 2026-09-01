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
  | "ISSUE_ID"
  /**
   * The run is answering on the product axis (`group/ProductGrouping.ts`).
   *
   * <b>Not a weaker form of `RESOLVED_PRODUCT` — a different question.</b> The attribution path asks
   * "how many of this issue's rows are THIS product's" and needs the product first. The grouped path
   * asks "whose rows are these" and needs no product at all: it learns every id from the answer. Both
   * are the same read; declaring them as one row with the weaker precondition would say a product-scoped
   * claim can be made without a product, which is A1.
   */
  | "PRODUCT_GROUPING"
  /**
   * The run names one channel, or asks to be split by channel.
   *
   * Parallel to {@link "PRODUCT_GROUPING"} on the other axis, and one row rather than two because the
   * read is the same read: a scoped run filters the coverage list to one channel, a grouped run keeps
   * all of them, and neither needs anything resolved first — the channel set comes from the answer.
   */
  | "CHANNEL_SCOPE_OR_GROUPING"
  /**
   * The conversation is standing on ONE review the seller selected (Agent Object v1).
   *
   * <b>Not a weaker `RESOLVED_PRODUCT`.</b> A review id cannot be searched for from a sentence — there
   * is no resolver that turns words into a review — so this precondition is satisfied only by an
   * anchor the seller created by clicking or naming a row this conversation drew. Without one the exact
   * read has no argument, and the honest behaviour is the org-wide review question, not a guess.
   */
  | "SELECTED_REVIEW";

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
    needKinds: ["PRODUCT_FACT", "PRODUCT_LISTING", "PRODUCT_VARIANT", "PRODUCT_KNOWLEDGE_DOC",
      "REVIEW_SIGNAL", "INQUIRY_VOLUME"],
    // The one tool that MAKES a product id, so it cannot require one.
    requires: ["PRODUCT_MENTION"],
  },
  {
    // The catalogue, for a question that named no product — so it requires no mention and no id.
    specialist: "PRODUCT_OPS",
    tool: OPERATOR_TOOL.LIST_PRODUCTS,
    needKinds: ["PRODUCT_CATALOG"],
    // NONE, and that is the point: the catalogue is the one product read that must NOT wait for a
    // product — a question that named one is a different need.
    requires: ["NONE"],
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
  {
    // The seller's OWN writing. Deliberately not folded into GET_PRODUCT_KNOWLEDGE's row: that tool
    // returns what channels stated, this one returns what a person wrote, and a plan that needs one
    // is not automatically entitled to the other.
    specialist: "PRODUCT_OPS",
    tool: OPERATOR_TOOL.SEARCH_PRODUCT_KNOWLEDGE,
    needKinds: ["PRODUCT_KNOWLEDGE_DOC"],
    requires: ["RESOLVED_PRODUCT"],
  },
  {
    // <b>The same tool as ReviewOps', reached from the other side.</b> ProductOps already holds the
    // definitive product-scoped issue LIST — the backend selects it from `review_issue_evidence` rows
    // belonging to this product — but every count on those rows is the issue's ORG total. Quoting one
    // in a sentence about the product is defect C4. This row is what lets the product's own number be
    // read instead, and it is the same read, so no new capability enters the system.
    specialist: "PRODUCT_OPS",
    tool: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY,
    needKinds: ["REVIEW_SIGNAL"],
    requires: ["RESOLVED_PRODUCT", "ISSUE_ID"],
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

  {
    // <b>The same read again, from the axis side.</b> With no product resolved this call cannot be
    // "which of these are mine" — it is "whose are these", and its answer names every product behind
    // the issue. That is what makes a product-axis answer possible without a resolver, which is the
    // property C5 requires: the word "상품" is never looked up.
    specialist: "REVIEW_OPS",
    tool: OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY,
    needKinds: ["REVIEW_SIGNAL"],
    requires: ["PRODUCT_GROUPING", "ISSUE_ID"],
  },

  {
    // <b>The other review evidence, on the same axis.</b> The dashboard roll-up groups the org's
    // NEGATIVE REVIEWS by canonical product — a different corpus from the issue evidence above, and
    // the only read that answers "어느 상품에 부정 리뷰가" without being told a product first. It sat
    // in the catalogue unreachable until 2026-08-24, and its DTO carried no product id until the same
    // day, so nothing could have used it honestly even if something had called it.
    specialist: "REVIEW_OPS",
    tool: OPERATOR_TOOL.GET_DASHBOARD_PRODUCT_ISSUES,
    needKinds: ["REVIEW_SIGNAL"],
    requires: ["PRODUCT_GROUPING"],
  },

  {
    // <b>The only read that can say what is NOT there.</b> Review issues are extracted org-wide and
    // carry no channel, so a channel question about reviews has no answer on that list — every
    // citation is refused as CHANNEL_UNPROVEN. Coverage rows carry a channel each, which is what makes
    // "쿠팡 리뷰는 API가 없습니다" and "네이버 리뷰 12건" different sentences instead of two silences.
    specialist: "REVIEW_OPS",
    tool: OPERATOR_TOOL.GET_CHANNEL_COVERAGE,
    needKinds: ["REVIEW_SIGNAL"],
    requires: ["CHANNEL_SCOPE_OR_GROUPING"],
  },

  {
    // Agentic Operating Workspace v2: review ROWS in a window, with the freshness of every channel
    // beside them. The only read that can answer 「오늘 새 리뷰」 — the issue list has no period.
    specialist: "REVIEW_OPS",
    tool: OPERATOR_TOOL.LIST_RECENT_REVIEWS,
    needKinds: ["REVIEW_SIGNAL"],
    requires: ["NONE"],
  },
  {
    // Agent Object v1: the exact single-review read. It answers about ONE review and cannot be reached
    // without one — which is what keeps 「이 리뷰」 from becoming a scope over that review's product.
    specialist: "REVIEW_OPS",
    tool: OPERATOR_TOOL.GET_REVIEW_DETAIL,
    needKinds: ["REVIEW_SIGNAL"],
    requires: ["SELECTED_REVIEW"],
  },
  {
    // Channel-capability completion: read ONLY for a channel whose rows are stale, to decide between
    // the product's own refresh and the seller's guided step. The registry decision table lives in
    // `graph/reviewRows.ts`; this row is what lets that read happen under the plan's authorization.
    specialist: "REVIEW_OPS",
    tool: OPERATOR_TOOL.GET_CHANNEL_EXECUTION_CAPABILITY,
    needKinds: ["REVIEW_SIGNAL"],
    requires: ["NONE"],
  },

  // ── OrderOps — the order/sales flow (Agentic Operating Workspace v2).
  {
    specialist: "ORDER_OPS",
    tool: OPERATOR_TOOL.GET_SALES_TREND,
    needKinds: ["ORDER_HISTORY"],
    requires: ["NONE"],
  },

  // ── InquiryOps — the queue, the repeats, and what was answered before.
  {
    // Knowledge Context v1-A: a POLICY need is met by reading the company's own rules — nothing to
    // resolve first, since the rules are the org's and the org is the bearer's.
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.SEARCH_ORG_KNOWLEDGE,
    needKinds: ["POLICY"],
    requires: ["NONE"],
  },
  {
    // Retrieval & Grounding Correctness v1: a PAST_ANSWER need is met by reading the answers this org
    // sent or approved — org-keyed like the rules; a resolved product only narrows, never gates.
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.SEARCH_ANSWER_MEMORY,
    needKinds: ["PAST_ANSWER"],
    requires: ["NONE"],
  },
  {
    // Seller Context v1-B: a COMPANY_PROFILE need is met by one org-keyed read of the seller's own
    // description — nothing to resolve first, and nothing a product could narrow.
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.GET_SELLER_PROFILE,
    needKinds: ["COMPANY_PROFILE"],
    requires: ["NONE"],
  },
  {
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.GET_TODAY_INBOX,
    needKinds: ["INQUIRY_VOLUME"],
    requires: ["NONE"],
  },
  {
    // <b>The list behind the count.</b> `get_today_inbox` answers "how many"; a seller who asked for a
    // priority order needs "which ones, and how long have they waited". The rows carry a work-item id
    // and a receipt time and no customer text — the queue endpoint is sanitized by construction — so
    // the order is the rows' own dates rather than a ranking this runtime invented.
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.SEARCH_UNANSWERED_INQUIRIES,
    needKinds: ["INQUIRY_VOLUME"],
    requires: ["NONE"],
  },
  {
    // The channel half of the inbox question. `get_today_inbox` returns one org-wide number and cannot
    // be split; this returns one row per channel WITH the reason each row is what it is.
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.GET_CHANNEL_COVERAGE,
    needKinds: ["INQUIRY_VOLUME"],
    requires: ["CHANNEL_SCOPE_OR_GROUPING"],
  },
  {
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.LIST_REPEATED_INQUIRIES,
    needKinds: ["REPEAT_PATTERN"],
    requires: ["NONE"],
  },
  {
    // Agentic Operating Workspace v2: the queue, classified. An org-wide list read; the working-set and
    // topic arguments narrow rows the planner already asked for, and need nothing resolved first.
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.LIST_INQUIRY_WORKLOAD,
    needKinds: ["INQUIRY_VOLUME"],
    requires: ["NONE"],
  },
  {
    // Query Accuracy v1: the customer's inquiries as rows. Org-wide, every axis a closed token, and
    // nothing to resolve first.
    specialist: "INQUIRY_OPS",
    tool: OPERATOR_TOOL.LIST_INQUIRY_ROWS,
    needKinds: ["INQUIRY_VOLUME"],
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
  // Deduped: one tool may have two rows because it has two execution PATHS with different
  // preconditions (`get_review_issue_evidence_summary`, attribution and grouping). Two paths are still
  // one authorization — the allow-list answers "may this name be called", not "why".
  return [...new Set(
    TOOL_CAPABILITIES.filter((c) => c.specialist === specialist).map((c) => c.tool),
  )];
}

/** Catalogue names with no execution path — what must NOT be advertised. */
export function unreachableToolNames(catalogue: readonly string[]): string[] {
  const reachable = new Set<string>(reachableToolNames());
  return catalogue.filter((name) => !reachable.has(name));
}

/**
 * The specialists that can turn a product MENTION into a resolved product.
 *
 * <b>Derived from the preconditions, never listed.</b> A tool that REQUIRES a mention is by definition
 * the one that consumes a name and produces an id; anything else requires the id it would have made.
 * So this set follows from the table, and a future specialist that owns such a tool joins it by being
 * added there rather than by anyone remembering to update a second list.
 *
 * Read by {@link validatePlan}: a plan that names a product and dispatches none of these has no path
 * to the id every product-scoped read needs (A8). The validator REFUSES such a plan — it does not add
 * the specialist, because a validator that completes a plan is the deterministic second planner
 * invariant I2 forbids.
 */
export function productResolvingSpecialists(): SpecialistName[] {
  return [...new Set(
    TOOL_CAPABILITIES.filter((c) => c.requires.includes("PRODUCT_MENTION")).map((c) => c.specialist),
  )];
}

/* ─────────────────────────── The grouping axis (Grouped Product Answers v1) ─────────────────────── */

/**
 * Whether a need can be answered along a grouping dimension, and when not, WHY not.
 *
 * <b>Closed vocabulary, because the two "no"s are different facts and the seller deserves the right
 * one.</b> "이 데이터에는 상품 연결이 없다" is a statement about the model; "상품 연결은 있지만 그것을
 * 묶어 주는 조회가 없다" is a statement about the reads. Collapsing them into "할 수 없습니다" would hide
 * which one a future package has to fix.
 */
export type GroupingSupport =
  /** A read exists that returns this need's evidence already attributed per product. */
  | "SUPPORTED"
  /** The rows behind this need carry no product link at all — nothing could group them. */
  | "NO_PRODUCT_ATTRIBUTION"
  /** The rows ARE attributed, but no read returns them grouped, and building one is new retrieval. */
  | "NO_GROUPED_READ"
  /**
   * The rows carry no CHANNEL, so they cannot be split along that axis.
   *
   * <b>Its own value, and not a synonym for the product one.</b> Cross-Channel Operational Reasoning
   * v1 gave the runtime a per-channel read — `get_channel_coverage` — so the channel axis is
   * answerable for whole data types. It is NOT answerable INSIDE a product grouping: the reads that
   * attribute evidence to a product (`evidence-summary:byProduct`, `dashboard:topProductIssues`)
   * return a product id and a count and no channel anywhere, and `channel_products` says which
   * channels a product is LISTED on, which is a different fact from where its reviews came from.
   * Crossing the two would attribute a count to a channel on the strength of a listing.
   */
  | "NO_CHANNEL_ATTRIBUTION";

export interface GroupingCapability {
  readonly needKind: NeedKind;
  readonly dimension: "PRODUCT" | "CHANNEL" | "PRODUCT_CHANNEL";
  readonly support: GroupingSupport;
  /** The reads that produce the grouped evidence. Empty when nothing does. */
  readonly via: readonly OperatorToolName[];
  /** Where the verdict comes from, precise enough to re-check. Never a summary of it. */
  readonly why: string;
}

/**
 * The grouping matrix — one row per (need kind × dimension) the runtime may be asked for.
 *
 * <b>Every row is an audit finding about code that exists, not a plan.</b> A need kind with no row is
 * not grouped, and {@link groupingSupportOf} says so rather than guessing; the runtime never invents a
 * dimension for a need the matrix does not name.
 */
export const GROUPING_CAPABILITIES: readonly GroupingCapability[] = [
  {
    needKind: "REVIEW_SIGNAL",
    dimension: "PRODUCT",
    support: "SUPPORTED",
    via: [
      OPERATOR_TOOL.SEARCH_REVIEW_ISSUES,
      OPERATOR_TOOL.GET_ISSUE_EVIDENCE_SUMMARY,
      OPERATOR_TOOL.GET_DASHBOARD_PRODUCT_ISSUES,
    ],
    // TWO grouped reads, and they answer two different questions — `group/ReviewEvidenceSense.ts`
    // holds the pair apart and `REVIEW_SENSES` is the machine-readable half of this sentence:
    //  · evidence-summary:byProduct[productId,evidenceCount,firstOccurredOn,lastOccurredOn] — the
    //    issue evidence a product owns, dated by its own rows;
    //  · dashboard:topProductIssues[productId,count,firstNegativeOn,lastNegativeOn] — that product's
    //    negative reviews, top 5, dated by their own receipt dates.
    why: "evidence-summary:byProduct (issue evidence) + dashboard:topProductIssues (negative reviews)",
  },
  {
    needKind: "INQUIRY_VOLUME",
    dimension: "PRODUCT",
    support: "NO_GROUPED_READ",
    via: [],
    // `Inquiry.productId` exists and the backend counts by it — but only for ONE product at a time
    // (`ProductSignalsView.volume.unansweredInquiries`), which needs the product named first. The queue
    // page (`InquiryQueueItem`) carries workItem / channel / phase / status / title / receivedAt and no
    // product at all, so the rows a grouped answer would have to group cannot be grouped.
    why: "inquiry/queue/dto/InquiryQueueItem: no productId; product counts are per-product only",
  },
  {
    needKind: "REPEAT_PATTERN",
    dimension: "PRODUCT",
    support: "NO_PRODUCT_ATTRIBUTION",
    via: [],
    // `RepeatedInquiryView` is an axis/key tally with no product field anywhere in it. A repeat is a
    // cluster of inquiries by signature, and the cluster never carried the product.
    why: "customer-memory/RepeatedInquiryView: axis,key,occurrences — no productId",
  },

  /* ── The channel axis (Cross-Channel Operational Reasoning v1, 2026-08-24) ── */
  {
    needKind: "INQUIRY_VOLUME",
    dimension: "CHANNEL",
    support: "SUPPORTED",
    via: [OPERATOR_TOOL.GET_CHANNEL_COVERAGE],
    // One row per (channel × data type) carrying the counts AND the reason each count is what it is.
    // Live 2026-08-24 on the canonical Demo Org the per-channel unanswered figures summed to exactly
    // the org total the home screen prints (0 + 69 + 0 = 69) — the parts and the whole are one corpus.
    why: "channel-coverage: rows/openRows per channel; sums to inbox unansweredInquiries",
  },
  {
    needKind: "REVIEW_SIGNAL",
    dimension: "CHANNEL",
    support: "SUPPORTED",
    via: [OPERATOR_TOOL.GET_CHANNEL_COVERAGE],
    why: "channel-coverage: rows/openRows per channel for REVIEW",
  },
  {
    needKind: "REPEAT_PATTERN",
    dimension: "CHANNEL",
    support: "NO_CHANNEL_ATTRIBUTION",
    via: [],
    // Same shape as its product row: a repeat is a signature cluster, and the cluster carries neither.
    why: "customer-memory/RepeatedInquiryView: axis,key,occurrences — no channelCode",
  },
  {
    needKind: "REVIEW_SIGNAL",
    dimension: "PRODUCT_CHANNEL",
    support: "NO_CHANNEL_ATTRIBUTION",
    via: [],
    // Both axes work; their CROSS does not. `evidence-summary:byProduct` and
    // `dashboard:topProductIssues` return productId + count and no channel, and a product's listings
    // (`channel_products`) say where it is SOLD, not where a given review arrived from. Answering
    // "네이버의 이 상품 리뷰 문제" from a listing would attribute rows to a channel on the strength of
    // a catalogue join — the C4 mistake with a channel wearing the product's clothes.
    why: "evidence-summary:byProduct / dashboard:topProductIssues: productId,count — no channelCode",
  },
  {
    needKind: "INQUIRY_VOLUME",
    dimension: "PRODUCT_CHANNEL",
    support: "NO_CHANNEL_ATTRIBUTION",
    via: [],
    // The queue row DOES carry a channel; what it does not carry is a product (see the PRODUCT row
    // above). So the cross fails on the product half, and the honest word is the one that names the
    // axis that is actually missing from the rows a cross would have to group.
    why: "inquiry/queue/dto/InquiryQueueItem: channel present, productId absent",
  },
];

/**
 * Can this need be answered along this dimension?
 *
 * An undeclared pair is `NO_GROUPED_READ`: nothing groups what nobody declared, and the honest failure
 * for a missing declaration is the same as for a missing read.
 */
export function groupingSupportOf(
  needKind: NeedKind, dimension: "PRODUCT" | "CHANNEL" | "PRODUCT_CHANNEL",
): GroupingSupport {
  return GROUPING_CAPABILITIES.find((c) => c.needKind === needKind && c.dimension === dimension)
    ?.support ?? "NO_GROUPED_READ";
}

/**
 * The seller-facing sentence for an unavailable axis. Closed vocabulary in, plain Korean out.
 *
 * `hasRows` exists because "아래 수치는 전체 기준입니다" is a promise about numbers that follow, and a
 * read that came back empty has none — live 2026-08-24, Q3 said exactly that with nothing below it.
 */
export function groupingLimitSentence(
  needKind: NeedKind, support: GroupingSupport, hasRows = true,
): string | null {
  if (support === "SUPPORTED") {
    return null;
  }
  const subject = needKind === "REPEAT_PATTERN" ? "반복 문의 기록"
    : needKind === "INQUIRY_VOLUME" ? "미답변 문의 목록"
      // Named, because "이 정보" is what a sentence says when it does not know what it is about, and
      // this one does. Live 2026-08-24 the cross-axis sentence read "이 정보에는 채널 정보가 없어".
      : needKind === "REVIEW_SIGNAL" ? "리뷰 문제 기록"
        : "이 정보";
  const cause = support === "NO_CHANNEL_ATTRIBUTION"
    ? `${subject}에는 채널 정보가 함께 있지 않아 상품과 채널을 교차해서 나눌 수 없습니다.`
    : support === "NO_PRODUCT_ATTRIBUTION"
      ? `${subject}에는 상품 정보가 없어 상품별로 나눌 수 없습니다.`
      : `${subject}은 상품별로 모아 볼 수 있는 조회가 아직 없어 상품별로 나누지 못했습니다.`;
  return `${cause} ${hasRows ? "아래 수치는 전체 기준입니다." : "상품별로는 지금 답할 수 없습니다."}`;
}
