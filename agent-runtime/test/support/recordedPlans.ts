/**
 * Investigation plans, replayed at the TRANSPORT seam.
 *
 * <b>Why these exist at all.</b> Operator Graph v2 has exactly one planner and it reaches a model
 * (`plannerFence.test.ts` proves the count). A test double implementing `Planner` would defeat that
 * fence, and a keyword planner "for tests" is precisely what invariant I2 forbids. So the fake lives
 * one layer lower: `FakeOperatorSpringClient.planGoal` replays these wire responses, and everything
 * above it — the real planner, the real validator, the real graph — runs unmodified.
 *
 * <b>What they can and cannot prove.</b> They pin the CONTRACT (validation, refusal, divergence of
 * shape) and they make CI runnable with no vendor key. They do NOT prove generalization: a replayed
 * plan is what one model said about one sentence. Paraphrase generalization is provable only against a
 * live model, and `docs/sellerops_operator_graph_v2.md` §18.3 is where that happens.
 *
 * <b>Provenance.</b> Each entry records the goal it answers. Entries marked `AUTHORED` were written to
 * the wire schema by hand and are pending replacement with a live recording; entries marked with a
 * model id and date came back from that model. Both kinds exercise the same code path — the difference
 * matters for what a passing test is allowed to mean, so it is stated per entry rather than in a
 * blanket comment.
 */
import type { AgentPlanView } from "../../src/spring/types";

const AUTHORED = "AUTHORED (pending live recording)";

/**
 * The same spec question about a product SellerOps holds no catalogue for.
 *
 * Kept as its own entry rather than reusing {@link SPEC_QUESTION_PLAN} with a different mention,
 * because the mention is what decides which product resolves — and the whole point of this case is that
 * the plan is IDENTICAL in shape while the ANSWER has to say "we do not hold this".
 */
export const SPEC_QUESTION_UNKNOWN_PRODUCT_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "케이블타이 상품의 폭이 몇 mm인지 알고 싶다",
  unresolvedEntities: [{ kind: "PRODUCT", mention: "케이블타이" }],
  informationNeeds: [
    { id: "n1", question: "이 상품의 폭/규격이 기록돼 있는가", kind: "PRODUCT_FACT",
      why: "고객이 물은 것은 규격 자체다", required: true },
  ],
  specialists: ["PRODUCT_OPS"],
  tools: ["resolve_product", "search_product_facts"],
  retrievalOrder: ["n1"],
  retrievalParallel: [],
  retrievalStopWhen: "규격이 확인되면 끝",
  evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["PRODUCT_FACT"] }],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 4,
  stopWhenEnough: "규격 값 하나면 충분",
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "규격 질문은 상품 사실 조회로 답한다",
  providerVersion: AUTHORED,
};

/** A spec question: the seller wants a product FACT, and nothing else. */
export const SPEC_QUESTION_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "전선몰딩 상품의 폭이 몇 mm인지 알고 싶다",
  unresolvedEntities: [{ kind: "PRODUCT", mention: "전선몰딩" }],
  informationNeeds: [
    { id: "n1", question: "이 상품의 폭/규격이 기록돼 있는가", kind: "PRODUCT_FACT",
      why: "고객이 물은 것은 규격 자체다", required: true },
  ],
  specialists: ["PRODUCT_OPS"],
  tools: ["resolve_product", "search_product_facts"],
  retrievalOrder: ["n1"],
  retrievalParallel: [],
  retrievalStopWhen: "규격이 확인되면 끝",
  evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["PRODUCT_FACT"] }],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 4,
  stopWhenEnough: "규격 값 하나면 충분",
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "규격 질문은 상품 사실 조회로 답한다",
  providerVersion: AUTHORED,
};

/** An exchange-policy question: a POLICY need, which is a different need from a spec. */
export const POLICY_QUESTION_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "이 상품을 교환할 수 있는지 알고 싶다",
  unresolvedEntities: [{ kind: "PRODUCT", mention: "전선몰딩" }],
  informationNeeds: [
    { id: "n1", question: "판매자/채널의 교환 정책이 무엇인가", kind: "POLICY",
      why: "교환 가능 여부는 정책이 정한다", required: true },
    { id: "n2", question: "이 상품에 교환 관련 과거 대응이 있었는가", kind: "CUSTOMER_HISTORY",
      why: "같은 요청을 어떻게 처리했는지 참고한다", required: false },
  ],
  specialists: ["INQUIRY_OPS"],
  tools: ["get_inquiry_thread_context", "search_customer_memory"],
  retrievalOrder: ["n1", "n2"],
  retrievalParallel: [],
  retrievalStopWhen: "정책이 확인되면 과거 대응은 참고만",
  evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["POLICY"] }],
  riskClass: "SENSITIVE",
  maxIterations: 1,
  maxToolCalls: 4,
  stopWhenEnough: "정책 근거가 확인되면 충분",
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "정책 질문은 정책 근거 없이는 단정할 수 없다",
  providerVersion: AUTHORED,
};

/** "전에 산 것과 색이 달라요" — variant + history, a third distinct shape. */
export const DIFFERENCE_QUESTION_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "이전에 산 것과 색이 다르다는 고객 문의를 확인하고 싶다",
  unresolvedEntities: [{ kind: "PRODUCT", mention: "전선몰딩" }],
  informationNeeds: [
    { id: "n1", question: "이 상품에 어떤 옵션/색상이 있는가", kind: "PRODUCT_VARIANT",
      why: "다른 옵션을 받았을 가능성을 먼저 확인한다", required: true },
    { id: "n2", question: "같은 유형의 과거 대응이 있었는가", kind: "CUSTOMER_HISTORY",
      why: "반복이면 상품/출고 쪽 문제일 수 있다", required: true },
    { id: "n3", question: "색상 관련 리뷰 신호가 있는가", kind: "REVIEW_SIGNAL",
      why: "다른 고객도 같은 말을 하는지 본다", required: false },
  ],
  specialists: ["PRODUCT_OPS", "INQUIRY_OPS", "REVIEW_OPS"],
  tools: ["resolve_product", "get_product_knowledge", "search_customer_memory", "search_review_issues"],
  retrievalOrder: ["n1", "n2", "n3"],
  retrievalParallel: ["n2", "n3"],
  retrievalStopWhen: null,
  evidenceRequirements: [
    { needId: "n1", minEvidence: 1, acceptableKinds: ["PRODUCT_VARIANT"] },
    { needId: "n2", minEvidence: 1, acceptableKinds: ["CUSTOMER_MEMORY"] },
  ],
  riskClass: "ROUTINE",
  maxIterations: 2,
  maxToolCalls: 8,
  stopWhenEnough: "옵션 차이 또는 반복 사례 중 하나가 확인되면",
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "차이 주장은 옵션과 과거 사례를 함께 봐야 한다",
  providerVersion: AUTHORED,
};

/** The triage goal — volume and repeats, no product. */
export const TODAY_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "오늘 먼저 처리할 일을 알고 싶다",
  unresolvedEntities: [],
  informationNeeds: [
    { id: "n1", question: "답변이 필요한 문의가 몇 건인가", kind: "INQUIRY_VOLUME",
      why: "가장 시급한 대기열", required: true },
    { id: "n2", question: "반복되고 있는 고객 문제가 있는가", kind: "REPEAT_PATTERN",
      why: "반복은 개별 응대보다 우선한다", required: true },
    { id: "n3", question: "지금 심각한 리뷰 신호가 있는가", kind: "REVIEW_SIGNAL",
      why: "심각도 높은 문제를 놓치지 않기 위해", required: false },
  ],
  specialists: ["INQUIRY_OPS", "REVIEW_OPS"],
  tools: ["get_today_inbox", "list_repeated_inquiries", "search_review_issues"],
  retrievalOrder: ["n1", "n2", "n3"],
  retrievalParallel: ["n2", "n3"],
  retrievalStopWhen: null,
  evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["INBOX_COUNT"] }],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 6,
  stopWhenEnough: "대기열과 반복 문제를 모두 보면 충분",
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "우선순위 질문은 대기열과 반복 신호를 함께 본다",
  providerVersion: AUTHORED,
};

/** A product health question — the v1 demo 2 goal, now expressed as needs. */
export const PRODUCT_HEALTH_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "이 상품에 최근 문제가 있는지 알고 싶다",
  unresolvedEntities: [{ kind: "PRODUCT", mention: "전선몰딩" }],
  informationNeeds: [
    { id: "n1", question: "이 상품에 기록된 반복 문제가 있는가", kind: "REVIEW_SIGNAL",
      why: "문제 여부가 질문의 핵심", required: true },
    { id: "n2", question: "이 상품에 미답변 문의가 쌓여 있는가", kind: "INQUIRY_VOLUME",
      why: "응대 지연도 상품 문제로 나타난다", required: false },
  ],
  specialists: ["PRODUCT_OPS"],
  tools: ["resolve_product", "get_product_knowledge"],
  retrievalOrder: ["n1", "n2"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [{ needId: "n1", minEvidence: 1, acceptableKinds: ["REVIEW_ISSUE"] }],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 6,
  stopWhenEnough: "신호와 대기 문의를 보면 충분",
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "상품 상태 질문은 신호부터 본다",
  providerVersion: AUTHORED,
};

/** A weekly report — REPORT_OPS composes the others' findings. */
export const REPORT_PLAN: AgentPlanView = {
  ...TODAY_PLAN,
  userGoal: "이번 주 대표에게 보고할 내용을 정리하고 싶다",
  specialists: ["INQUIRY_OPS", "REVIEW_OPS", "REPORT_OPS"],
  rationale: "보고는 각 축의 확인된 사실을 모아 구성한다",
};

/** The model understood and refused. A real answer, honoured rather than second-guessed. */
export const REFUSED_PLAN: AgentPlanView = {
  available: true,
  supported: false,
  userGoal: "오늘 날씨를 알고 싶다",
  unresolvedEntities: [],
  informationNeeds: [],
  specialists: [],
  tools: [],
  retrievalOrder: [],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [],
  riskClass: "REFUSE",
  maxIterations: 0,
  maxToolCalls: 0,
  stopWhenEnough: null,
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "판매 운영과 관련이 없는 요청입니다.",
  providerVersion: AUTHORED,
};

/** The model needs the seller to say which product. Asking back is a legitimate answer. */
export const CLARIFY_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "상품에 문제가 있는지 알고 싶다",
  unresolvedEntities: [],
  informationNeeds: [
    { id: "n1", question: "어떤 상품에 대한 질문인가", kind: "PRODUCT_FACT", why: "대상이 특정되지 않음",
      required: true },
  ],
  specialists: ["PRODUCT_OPS"],
  tools: ["resolve_product"],
  retrievalOrder: ["n1"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 2,
  stopWhenEnough: null,
  clarificationNeeded: true,
  clarificationReason: "어떤 상품을 말씀하시는지 알려주세요.",
  rationale: "대상 상품이 특정되지 않았습니다.",
  providerVersion: AUTHORED,
};

/**
 * The plan that produced the wrong answer, recorded verbatim.
 *
 * <b>gpt-5-2025-08-07, 2026-08-23, live against the canonical Demo Org.</b> The seller named a product
 * and asked whether it had complaints. The model planned two product-scoped needs and then dispatched
 * REVIEW_OPS and INQUIRY_OPS — **not PRODUCT_OPS**, the only specialist that resolves a product. Both
 * specialists read org-wide, and the run reported three HIGH-severity issues belonging to other
 * products as this product's. Full record: `docs/agent_real_validation_v1.md` §3 Q4.
 *
 * It is kept exactly as the model produced it. The fix is not a better plan — a planner will make this
 * mistake again — it is that evidence about the whole org can no longer answer a need about one
 * product. `evidenceScopeIntegrity.test.ts` is that claim, run against this plan.
 */
export const PRODUCT_COMPLAINT_ORGWIDE_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "전선몰딩 상품의 리뷰와 문의를 같이 보고 고객 불만이나 반복 이슈가 있는지 알고 싶다",
  unresolvedEntities: [{ kind: "PRODUCT", mention: "전선몰딩" }],
  informationNeeds: [
    { id: "n1", question: "이 상품의 리뷰에서 반복 불만/이슈 신호와 추세가 있는가? 있다면 무엇인가?",
      kind: "REVIEW_SIGNAL", why: "불만 여부가 질문의 핵심", required: true },
    { id: "n2", question: "이 상품의 문의에서 반복 질문/불만 패턴과 최근 문의량이 증가하는지 여부는 무엇인가?",
      kind: "INQUIRY_VOLUME", why: "문의도 불만의 신호다", required: true },
  ],
  specialists: ["REVIEW_OPS", "INQUIRY_OPS"],
  tools: [],
  retrievalOrder: ["n1", "n2"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 6,
  stopWhenEnough: null,
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "리뷰 신호와 문의 패턴을 함께 본다",
  providerVersion: "openai:gpt-5-2025-08-07 · 2026-08-23 live",
};

/**
 * A count offered to a need that asked for a page of rows.
 *
 * The Q1 shape, with the planner's own `acceptableKinds` written down. Live on 2026-08-23 the second
 * need asked "가장 오래된 미답변 문의는 무엇인가? (첫 페이지 목록)" and was marked SATISFIED by an
 * `INBOX_COUNT` of 69 — a total, not a list, and the same total that answered the first need. The
 * declaration is what makes that checkable: `acceptableKinds: ["INQUIRY"]` says a row, and a count is
 * not a row. See `docs/agent_real_validation_v1.md` §3 Q1.
 */
export const INBOX_LIST_NEEDS_ROWS_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "오늘 뭐부터 봐야 하는지 알고 싶다",
  unresolvedEntities: [],
  informationNeeds: [
    { id: "n1", question: "오늘 미답변 문의가 얼마나 있는가? (총 건수)", kind: "INQUIRY_VOLUME",
      why: "규모를 먼저 안다", required: true },
    { id: "n2", question: "가장 오래된 미답변 문의는 무엇인가? (첫 페이지 목록)", kind: "INQUIRY_VOLUME",
      why: "무엇부터 손대야 하는지가 질문이다", required: true },
  ],
  specialists: ["INQUIRY_OPS"],
  tools: [],
  retrievalOrder: ["n1", "n2"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [
    { needId: "n1", minEvidence: 1, acceptableKinds: ["INBOX_COUNT"] },
    { needId: "n2", minEvidence: 1, acceptableKinds: ["INQUIRY"] },
  ],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 4,
  stopWhenEnough: null,
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "규모와 첫 페이지를 함께 본다",
  providerVersion: "openai:gpt-5-2025-08-07 · 2026-08-23 live (evidenceRequirements 명시)",
};

/**
 * The plan whose run returned `DONE` with nothing in it.
 *
 * <b>gpt-5-2025-08-07, 2026-08-23, live against the canonical Demo Org.</b> The seller asked for their
 * unanswered inquiries to be prioritised and drafted. The model planned eight needs across PRODUCT_OPS
 * and INQUIRY_OPS — a reasonable decomposition. INQUIRY_OPS read the inbox, read the repeats, and then
 * reached `search_customer_memory` with no anchor of any kind; the backend correctly answered `400
 * 조회 기준이 필요합니다`, and the exception discarded the two reads that had already worked. The run
 * ended `DONE`, findings 0. Record: `docs/agent_real_validation_v1.md` §3 Q5.
 *
 * Trimmed to the three needs that carry the mechanism (volume → repeats → history, in the live order);
 * the product and draft needs are represented by the PRODUCT_OPS target and the goal text. The plan is
 * otherwise the model's own: the fix must hold with a planner that still asks for customer history on a
 * goal that names no product, because that is a reasonable thing to ask for.
 */
export const PRIORITIZE_AND_DRAFT_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "답변이 필요한 문의를 우선순위대로 정리하고 답변 초안을 만들고 싶다",
  unresolvedEntities: [],
  informationNeeds: [
    { id: "n1", question: "오늘 기준 미답변 문의가 몇 건인지와 처리 범위를 파악한다.",
      kind: "INQUIRY_VOLUME", why: "규모를 먼저 안다", required: true },
    { id: "n2", question: "최근 기간에 반복되는 문의 주제가 무엇인지 확인한다.",
      kind: "REPEAT_PATTERN", why: "반복은 우선순위를 바꾼다", required: false },
    { id: "n3", question: "각 문의와 유사한 과거 사례 및 승인된 답변 문안을 조회한다.",
      kind: "CUSTOMER_HISTORY", why: "초안은 과거 대응을 따른다", required: true },
  ],
  specialists: ["PRODUCT_OPS", "INQUIRY_OPS"],
  tools: [],
  retrievalOrder: ["n1", "n2", "n3"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 8,
  stopWhenEnough: null,
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "대기열을 파악하고 과거 대응을 참고해 우선순위를 정한다",
  providerVersion: "openai:gpt-5-2025-08-07 · 2026-08-23 live",
};

/**
 * The same goal, planned with a period named — the live divergence, isolated.
 *
 * <b>Both live runs of Q5 on 2026-08-23 used the same sentence and got different plans</b>: one named
 * no entity, the other named "오늘" as a `PERIOD`. That single difference decided whether the seller was
 * told their unanswered total or told it could not be proven (`docs/agent_real_validation_v1.md`
 * §10.4). This entry is {@link PRIORITIZE_AND_DRAFT_PLAN} with exactly that one difference added, so a
 * test can run the pair and hold the answer steady across it. The needs are the recorded plan's; only
 * the mention is the variant.
 */
export const PRIORITIZE_WITH_PERIOD_PLAN: AgentPlanView = {
  ...PRIORITIZE_AND_DRAFT_PLAN,
  unresolvedEntities: [{ kind: "PERIOD", mention: "오늘" }],
};

/**
 * The same goal again, planned with a CATEGORY declared as an entity — the A9 live defect, isolated.
 *
 * <b>gpt-5-2025-08-07, 2026-08-24, live against the canonical Demo Org.</b> Sampled six times on one
 * sentence, the planner declared an `INQUIRY` entity in four: twice "오늘 처리해야 할 문의" and once
 * "답변이 필요한 문의" (the fourth run named a PERIOD only). Nothing else about those plans differed
 * from the runs that named nothing, and that one line decided the whole run: the entity axis is a
 * property of the PLAN (`scope/EvidenceScope.needScopeOf`), so every need became ITEM-scoped, the
 * org-wide inbox count the run had just read correctly was refused as org evidence for an item
 * question, and the seller was told nothing about 69 unanswered inquiries.
 *
 * <b>The mention is not wrong — the reading of it was.</b> "답변이 필요한 문의" is a category of
 * inquiries; there is no id it could ever resolve to. Kept exactly as the model wrote it, inflection
 * included, because the fix has to hold for a planner that will keep writing it this way — a table of
 * bare nouns would classify neither of the two phrases it actually produced.
 */
export const PRIORITIZE_WITH_CATEGORY_PLAN: AgentPlanView = {
  ...PRIORITIZE_AND_DRAFT_PLAN,
  unresolvedEntities: [{ kind: "INQUIRY", mention: "답변이 필요한 문의" }],
  providerVersion: "openai:gpt-5-2025-08-07 · 2026-08-24 live",
};

/**
 * The three plans that answered a question with a question.
 *
 * <b>Reconstructed from the recorded runs, not byte-for-byte.</b> `docs/agent_real_validation_v1.md` §3
 * records each run's needs and its clarification text; the specialist lists here are the ones those
 * needs imply. What matters for the regression is exact in all three: `clarificationNeeded: true`, the
 * need KINDS, and whether a period was named — those are what the capability audit reads.
 *
 * All three asked the seller for a period. All three had one available: `list_repeated_inquiries`
 * declares a 28-day window, and the issue list declares that it has no period at all. Zero tools ran.
 */
export const NEGATIVE_REVIEWS_CLARIFY_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "최근 부정적인 리뷰가 있는 상품을 알고 싶다",
  unresolvedEntities: [{ kind: "PERIOD", mention: "최근" }],
  informationNeeds: [
    { id: "n1", question: "현재 감지된 부정적 리뷰 관련 이슈와 그 심각도/추세", kind: "REVIEW_SIGNAL",
      why: "부정 신호를 먼저 본다", required: true },
    { id: "n2", question: "각 부정적 이슈의 근거가 어느 상품에 얼마나 귀속되며, 최근 기간의 증거가 있는가",
      kind: "REVIEW_SIGNAL", why: "상품을 지목하려면 귀속이 필요하다", required: true },
  ],
  specialists: ["REVIEW_OPS"],
  tools: [],
  retrievalOrder: ["n1", "n2"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 6,
  stopWhenEnough: null,
  clarificationNeeded: true,
  clarificationReason: "'최근'의 기간(예: 7/14/30일), '부정적 리뷰'의 기준, 출력 범위와 채널 범위가 정해지지 않았습니다.",
  rationale: "부정 리뷰 신호를 상품 단위로 본다",
  providerVersion: "openai:gpt-5-2025-08-07 · 2026-08-23 live (재구성)",
};

export const REPEATED_INQUIRIES_CLARIFY_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "반복해서 비슷한 문의가 들어오는 상품을 알고 싶다",
  unresolvedEntities: [],
  informationNeeds: [
    { id: "n1", question: "최근 지정 기간 내에 반복 문의 패턴이 감지된 상품", kind: "REPEAT_PATTERN",
      why: "반복은 개별 응대보다 우선한다", required: true },
  ],
  specialists: ["INQUIRY_OPS"],
  tools: [],
  retrievalOrder: ["n1"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 4,
  stopWhenEnough: null,
  clarificationNeeded: true,
  clarificationReason: "분석 기간이 지정되지 않았습니다. 어떤 기간(예: 지난 7일/30일/분기)을 기준으로 볼지 확인이 필요합니다.",
  rationale: "반복 문의 패턴을 본다",
  providerVersion: "openai:gpt-5-2025-08-07 · 2026-08-23 live (재구성)",
};

export const OPERATIONS_RISK_CLARIFY_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "최근 판매 운영에서 놓치고 있는 위험이나 개선 포인트를 알고 싶다",
  unresolvedEntities: [{ kind: "PERIOD", mention: "최근" }],
  informationNeeds: [
    { id: "n1", question: "미답변 백로그가 얼마나 쌓여 있는가", kind: "INQUIRY_VOLUME",
      why: "가장 먼저 새는 곳", required: true },
    { id: "n2", question: "리뷰 반복 신고의 심각도와 추세", kind: "REVIEW_SIGNAL",
      why: "심각한 문제를 놓치지 않기 위해", required: true },
    { id: "n3", question: "상품별 이슈 집중도", kind: "REPEAT_PATTERN",
      why: "어디에 몰려 있는지", required: false },
    { id: "n4", question: "반복 질문 후보", kind: "REPEAT_PATTERN", why: "FAQ 보완 후보", required: false },
    { id: "n5", question: "저장된 분석의 상세페이지/FAQ 보완 제안", kind: "REPEAT_PATTERN",
      why: "실행 가능한 개선", required: false },
  ],
  specialists: ["INQUIRY_OPS", "REVIEW_OPS", "REPORT_OPS"],
  tools: [],
  retrievalOrder: ["n1", "n2", "n3", "n4", "n5"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 8,
  stopWhenEnough: null,
  clarificationNeeded: true,
  clarificationReason: "'최근'의 기간 범위(예: 7일/14일/30일)와 점검 범위(모든 채널 vs 특정 채널)가 불명확합니다.",
  rationale: "운영 전반의 위험 신호를 모아 본다",
  providerVersion: "openai:gpt-5-2025-08-07 · 2026-08-23 live (재구성)",
};

/**
 * A clarification that must SURVIVE the audit — no capability reaches an order read.
 *
 * The negative control matters as much as the red test: an audit that cleared every clarification would
 * be a switch that turns the feature off, not a rule.
 */
export const ORDER_HISTORY_CLARIFY_PLAN: AgentPlanView = {
  ...REPEATED_INQUIRIES_CLARIFY_PLAN,
  userGoal: "지난 주문에서 무슨 일이 있었는지 알고 싶다",
  informationNeeds: [
    { id: "n1", question: "어느 기간의 주문 이력을 볼 것인가", kind: "ORDER_HISTORY",
      why: "대상 기간이 없다", required: true },
  ],
  clarificationReason: "어느 기간의 주문을 보시겠습니까?",
};

/**
 * The Q4 sentence again, planned the way the live model planned it AFTER A1 landed.
 *
 * <b>openai:gpt-5-2025-08-07, 2026-08-23 live, both re-runs identical</b>
 * (`docs/agent_real_validation_v1.md` §9.3). This time PRODUCT_OPS IS dispatched and
 * `resolve_product` runs first — and the run still ended "상품을 찾지 못했습니다", because the
 * seller had typed the title on their own Coupang listing and the resolver only read
 * `products.name`, which for that product is the number 15223228019 (defect C1).
 *
 * The plan is unchanged here for the same reason `PRODUCT_COMPLAINT_ORGWIDE_PLAN` is: the fix must
 * hold with the planner behaving exactly as it did. What changes is that the resolver can now reach
 * the product — and that the org-wide issue rows REVIEW_OPS reads still cannot answer for it.
 */
export const HUMAN_PRODUCT_NAME_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "판도리 일체형 종이컵 수거함 상품의 리뷰와 문의에서 불만이나 반복 이슈가 있는지 알고 싶다",
  unresolvedEntities: [{ kind: "PRODUCT", mention: "판도리 일체형 종이컵 수거함" }],
  informationNeeds: [
    { id: "n1", question: "이 상품의 리뷰에서 반복 불만/이슈 신호가 있는가?",
      kind: "REVIEW_SIGNAL", why: "불만 여부가 질문의 핵심", required: true },
    { id: "n2", question: "이 상품의 문의에서 반복 질문/불만 패턴과 문의량은 어떤가?",
      kind: "INQUIRY_VOLUME", why: "문의도 불만의 신호다", required: true },
  ],
  specialists: ["PRODUCT_OPS", "REVIEW_OPS", "INQUIRY_OPS"],
  tools: ["resolve_product", "get_product_knowledge", "search_review_issues", "get_today_inbox"],
  retrievalOrder: ["n1", "n2"],
  retrievalParallel: [],
  retrievalStopWhen: null,
  evidenceRequirements: [],
  riskClass: "ROUTINE",
  maxIterations: 1,
  maxToolCalls: 6,
  stopWhenEnough: null,
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "상품을 먼저 해결한 뒤 리뷰 신호와 문의 패턴을 함께 본다",
  providerVersion: "openai:gpt-5-2025-08-07 · 2026-08-23 live",
};

/** The goal → plan table the recorded-plan suites seed the transport fake with. */
export const RECORDED_PLANS: Record<string, AgentPlanView> = {
  "폭이 몇 mm인가요?": SPEC_QUESTION_PLAN,
  "케이블타이 폭이 몇 mm인가요?": SPEC_QUESTION_UNKNOWN_PRODUCT_PLAN,
  "전선몰딩 폭이 몇 mm예요?": SPEC_QUESTION_PLAN,
  "교환 가능한가요?": POLICY_QUESTION_PLAN,
  "이거 교환돼요?": POLICY_QUESTION_PLAN,
  "전에 산 것과 색이 달라요": DIFFERENCE_QUESTION_PLAN,
  "지난번에 산 거랑 색깔이 다른데요": DIFFERENCE_QUESTION_PLAN,
  "오늘 뭐부터 봐야 해?": TODAY_PLAN,
  "지금 제일 급한 게 뭐야?": TODAY_PLAN,
  "전선몰딩 상품 요즘 문제 있어?": PRODUCT_HEALTH_PLAN,
  "이번 주 대표에게 보고할 내용 정리해줘": REPORT_PLAN,
  "오늘 날씨 어때?": REFUSED_PLAN,
  "상품에 문제 있어?": CLARIFY_PLAN,
  "전선몰딩 상품의 리뷰와 문의를 같이 보고 불만이 있는지 알려줘": PRODUCT_COMPLAINT_ORGWIDE_PLAN,
  "오늘 뭐부터 봐야 해? 목록으로": INBOX_LIST_NEEDS_ROWS_PLAN,
  "답변이 필요한 문의를 우선순위대로 정리하고 답변 초안을 만들어줘": PRIORITIZE_AND_DRAFT_PLAN,
  "최근 부정적인 리뷰가 있는 상품을 알려줘.": NEGATIVE_REVIEWS_CLARIFY_PLAN,
  "반복해서 비슷한 문의가 들어오는 상품이 있어?": REPEATED_INQUIRIES_CLARIFY_PLAN,
  "최근 판매 운영에서 내가 놓치고 있는 위험이나 개선 포인트가 있어?": OPERATIONS_RISK_CLARIFY_PLAN,
  "지난 주문에서 무슨 일이 있었어?": ORDER_HISTORY_CLARIFY_PLAN,
  "판도리 일체형 종이컵 수거함 상품의 리뷰와 문의를 같이 보고 고객 불만이나 반복 이슈가 있는지 알려줘.":
    HUMAN_PRODUCT_NAME_PLAN,
};

/* ───────────────────── Repaired plans — the A8 second answer (2026-08-23) ───────────────────── */

/**
 * What the planner returns after being told the plan could not reach the product it named.
 *
 * <b>Same needs, same order, one specialist added — by the MODEL.</b> `PRODUCT_COMPLAINT_ORGWIDE_PLAN`
 * is a real plan that named 전선몰딩 and dispatched only the org-wide specialists; the validator refuses
 * it (V9) and the planner is asked again with the rule, not with a plan. This is the answer to that
 * second question. Nothing on the client side edits a plan — if the model returns the same one twice
 * the run FAILS, which is what `repairedPlansByGoal` being absent replays.
 */
export const PRODUCT_COMPLAINT_REPAIRED_PLAN: AgentPlanView = {
  available: true,
  supported: true,
  userGoal: "전선몰딩 상품의 리뷰와 문의를 함께 검토해 고객 불만이 있는지 판단하기",
  unresolvedEntities: [{ kind: "PRODUCT", mention: "전선몰딩 상품" }],
  informationNeeds: [
    { id: "n1", question: "‘전선몰딩 상품’이 정확히 어떤 상품(들)을 가리키는가?",
      kind: "PRODUCT_LISTING", why: "대상 상품을 특정해야 리뷰와 문의 데이터를 정확히 조회할 수 있다.", required: true },
    { id: "n2", question: "해당 상품의 최근 리뷰에서 반복되는 불만/이슈는 무엇이며 심각도는 어느 정도인가?",
      kind: "REVIEW_SIGNAL", why: "리뷰의 반복 이슈와 근거 규모를 통해 불만 존재 여부를 판단할 수 있다.", required: true },
    { id: "n3", question: "해당 상품에 대해 반복적으로 제기되는 고객 문의 주제는 무엇인가?",
      kind: "REPEAT_PATTERN", why: "반복되는 문의는 제품 이해나 품질 문제로 인한 불만 신호일 수 있다.", required: false },
  ],
  specialists: ["PRODUCT_OPS", "REVIEW_OPS", "INQUIRY_OPS"],
  tools: ["resolve_product", "search_review_issues", "get_review_issue_evidence_summary", "list_repeated_inquiries"],
  retrievalOrder: ["n1", "n2", "n3"],
  retrievalParallel: ["n2", "n3"],
  retrievalStopWhen: "리뷰 이슈와 반복 문의 모두에서 불만 신호가 없거나, 명확한 불만 신호가 한쪽에서라도 확인되면 중단",
  evidenceRequirements: [
    { needId: "n1", minEvidence: 1, acceptableKinds: ["PRODUCT_LISTING"] },
    { needId: "n2", minEvidence: 1, acceptableKinds: ["REVIEW_SIGNAL"] },
    { needId: "n3", minEvidence: 1, acceptableKinds: ["REPEAT_PATTERN"] },
  ],
  riskClass: "ROUTINE",
  maxIterations: 2,
  maxToolCalls: 8,
  stopWhenEnough: "반복 리뷰 이슈 또는 반복 문의 중 하나라도 불만 신호가 확인되면 충분하다.",
  clarificationNeeded: false,
  clarificationReason: null,
  rationale: "상품을 먼저 특정한 뒤 리뷰 반복 이슈와 문의 반복 패턴을 확인하면 불만 존재 여부를 빠르게 판단할 수 있다.",
  providerVersion: "openai:gpt-5-2025-08-07 · 2026-08-24 live repair",
};

/**
 * The policy question, repaired.
 *
 * The original names 전선몰딩 and dispatches only INQUIRY_OPS — and its own `CUSTOMER_HISTORY` need is
 * anchored on a resolved product, so under that plan the need could only ever be reported unanswerable.
 * A8 is not a purity rule here: the plan was already unable to do what it declared.
 */
export const POLICY_QUESTION_REPAIRED_PLAN: AgentPlanView = {
  ...POLICY_QUESTION_PLAN,
  specialists: ["PRODUCT_OPS", "INQUIRY_OPS"],
  tools: ["resolve_product", "search_customer_memory"],
  providerVersion: AUTHORED,
};

/** The repaired answers, keyed the same way. Seeded only by suites that exercise the repair. */
export const REPAIRED_PLANS: Record<string, AgentPlanView> = {
  "전선몰딩 상품의 리뷰와 문의를 같이 보고 불만이 있는지 알려줘": PRODUCT_COMPLAINT_REPAIRED_PLAN,
  "교환 가능한가요?": POLICY_QUESTION_REPAIRED_PLAN,
  "이거 교환돼요?": POLICY_QUESTION_REPAIRED_PLAN,
};
