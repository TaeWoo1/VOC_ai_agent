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
};
