package com.sellerops.agent.llm.operator;

/**
 * The prompt behind {@code POST /api/agent/judge} — the Evidence Judge.
 *
 * <p><b>What leaves, and why it is not customer content.</b> Two things: a FINDING, which is a
 * sentence SellerOps itself composed, and an EVIDENCE DIGEST, which is closed-vocabulary labels,
 * counts, coverage verdicts and ISO dates. No review body, no inquiry body, no masked quote, no buyer
 * field, no id that means anything outside this run. The judge's whole job is to check a claim
 * against metadata, and metadata is all it is given — which is also why it gets its own flag: an
 * operator may want claim-checking without wanting drafting, or the reverse.
 *
 * <p><b>It is asked to refute, not to agree.</b> The instruction leans the model toward
 * {@code hasEvidence=false} and {@code unsafeAssertion=true} under uncertainty, because the cost is
 * asymmetric: a finding wrongly withheld shows up as "확인이 필요합니다", and a finding wrongly
 * asserted shows up as a seller acting on something that is not true.
 *
 * <p><b>The unsafe-assertion vocabulary is closed and stated.</b> Six named ways a sentence can
 * overreach, each one a mistake this repository has already had to guard somewhere else (causal
 * claims — {@code ReviewIssueView}; performance claims — {@code pages-copy.test.ts}; period claims —
 * the weekly report's "이번 기간" wording). A prose instruction to "be careful" would be unauditable.
 */
public final class AgentJudgePrompt {

    /** Bump on every wording change. Stamped into the provenance a run records. */
    public static final String PROMPT_VERSION = "agent-judge-prompt/v1";

    private AgentJudgePrompt() {
    }

    public static String system() {
        return """
               당신은 한국 이커머스 운영 보조 시스템의 근거 심사관입니다. 시스템이 판매자에게 말하려는 문장 하나와 \
               그 문장이 근거로 삼은 메타데이터를 받고, 그 문장을 말해도 되는지 판정합니다.

               판정 항목:
               1. hasEvidence — 제시된 근거가 그 문장을 실제로 뒷받침하는가.
               2. supportingEvidenceIds — 그중 실제로 뒷받침하는 근거의 id 만 고르세요. 없으면 빈 배열.
               3. unsafeAssertion — 문장이 아래 중 하나에 해당하면 true:
                  (a) 원인 단정 — "…때문이다"
                  (b) 고객 책임 단정
                  (c) 성과·개선 주장 — "좋아졌다", "매출이 늘었다"
                  (d) 근거 수 대비 과일반화 — 근거 1~2건으로 "늘고 있다", "반복된다"
                  (e) 범위 확장 — 한 채널·한 계정에서 본 것을 전체로 말함
                  (f) 기간 오표기 — 기간이 명시되지 않은 총계를 "이번 주"라고 말함
               4. needsMore — 이 문장을 확정하려면 추가 조회가 필요한가. 필요하면 tool 이름과 이유를 쓰세요.

               중요: 근거의 coverage 가 COVERED 가 아니면, 비어 있음은 "문제 없음"이 아니라 "판단 불가"입니다. \
               그 경우 hasEvidence 는 false 여야 합니다.

               확신이 없으면 hasEvidence=false, unsafeAssertion=true 로 기울이세요. \
               말하지 않아 놓치는 것보다, 틀린 것을 확신하며 말하는 쪽이 훨씬 나쁩니다.

               반드시 아래 형태의 JSON 객체 하나만 출력하세요. 다른 텍스트, 설명, 코드펜스는 금지입니다.
               {"hasEvidence":true,"supportingEvidenceIds":["e1"],"unsafeAssertion":false,\
               "unsafeReason":"","needsMore":false,"needsMoreTool":"","needsMoreReason":""}
               """;
    }

    /**
     * The user turn — <b>the payload floor</b>.
     *
     * <p>The finding sentence and the evidence digest, and nothing else. The digest is built by
     * {@code AgentJudgeService}'s caller from allow-listed fields; {@code AgentJudgePayloadFloorTest}
     * asserts on the serialized bytes that no customer body reaches here even if a caller passes one.
     */
    public static String user(String finding, String evidenceDigest) {
        return "문장: " + (finding == null ? "" : finding)
                + "\n근거:\n" + (evidenceDigest == null ? "" : evidenceDigest);
    }
}
