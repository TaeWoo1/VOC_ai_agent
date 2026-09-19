package com.sellerops.inquiry.authority;

import static org.assertj.core.api.Assertions.assertThat;

import com.fasterxml.jackson.databind.JsonNode;
import com.sellerops.inquiry.decision.DetailCapability;
import com.sellerops.inquiry.decision.EvidenceCandidate;
import com.sellerops.inquiry.decision.EvidenceScope;
import com.sellerops.inquiry.decision.InquiryDecisionEngine;
import com.sellerops.inquiry.decision.InquiryDecisionModel;
import com.sellerops.inquiry.decision.InquiryNeed;
import com.sellerops.inquiry.decision.NeedAggregation;
import com.sellerops.inquiry.decision.NeedDecision;
import com.sellerops.inquiry.decision.NeedResult;
import com.sellerops.inquiry.decision.NeedStatus;
import com.sellerops.inquiry.decision.NeedType;
import com.sellerops.inquiry.decision.NeedVerdict;
import com.sellerops.inquiry.decision.PrecedentCandidate;
import com.sellerops.inquiry.draft.AnswerBasisState;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The v2 authority fence on every synthetic scenario ({@code fence-scenarios.jsonl}), each run twice — without the fence
 * (v2.2 exactly) and with it. A scenario that expects the fence to change the outcome is therefore also its own mutation
 * test: with the fence removed, the {@code off} expectation is what happens.
 */
class AuthorityFenceScenarioTest {

    static final UUID ORG = UUID.randomUUID();

    @Test
    @DisplayName("every fence scenario: v2.2 alone ends at `off`, the fence at `on` — status, enforcement, resolution, basis")
    void scenarios() throws Exception {
        List<JsonNode> all = AuthorityScenarios.read("fence-scenarios.jsonl");
        assertThat(all).hasSizeGreaterThanOrEqualTo(17);
        int changed = 0;
        for (JsonNode s : all) {
            String id = s.get("id").asText() + " — " + s.get("shape").asText();
            DetailCapability detail = s.has("detail") ? DetailCapability.valueOf(s.get("detail").asText())
                    : DetailCapability.READABLE;
            CapabilitySnapshot snap = AuthorityScenarios.snapshot(s, detail);
            NeedResult off = v22(s, detail, snap.orderBound());
            AuthorityFence.Context ctx = new AuthorityFence.Context(snap, AuthorityScenarios.order(s),
                    snap.orderBound() ? AuthorityScenarios.ORDER_KEY : null);
            NeedResult on = AuthorityFence.apply(List.of(off), ctx).get(0);

            JsonNode eo = s.get("expect").get("off");
            assertThat(off.status().name()).as(id + " off status").isEqualTo(eo.get("status").asText());
            assertThat(NeedAggregation.basis(List.of(off)).name()).as(id + " off basis").isEqualTo(eo.get("basis").asText());
            assertThat(off.resolution()).as(id + " no resolution without the fence").isNull();

            JsonNode e = s.get("expect").get("on");
            assertThat(on.status().name()).as(id + " on status").isEqualTo(e.get("status").asText());
            assertThat(NeedAggregation.basis(List.of(on)).name()).as(id + " on basis").isEqualTo(e.get("basis").asText());
            if (e.has("enforcement")) {
                assertThat(on.enforcement().name()).as(id + " enforcement").isEqualTo(e.get("enforcement").asText());
            }
            Resolution r = on.resolution();
            assertThat(r).as(id).isNotNull();
            assertThat(r.state().name()).as(id + " state").isEqualTo(e.get("state").asText());
            assertThat(r.gap() == null ? null : r.gap().name()).as(id + " gap").isEqualTo(AuthorityScenarios.text(e, "gap"));
            if (e.has("precondition")) {
                Resolution p = r.preconditions().get(0);
                assertThat(List.of(p.state().name(), p.gap() == null ? "" : p.gap().name())).as(id + " precondition")
                        .contains(e.get("precondition").asText());
                assertThat(p.capability()).as(id + " the precondition is this order").isEqualTo(CapabilityId.ENTITY_ORDER);
            }
            // the fence never widens: whatever it returns is at most as covered as what it was given
            if (!off.status().covered()) {
                assertThat(on.status().covered()).as(id + " never widens").isFalse();
            }
            // the authority it was held to is the bridge's, and never another one substituted
            assertThat(r.authority()).as(id + " no substitution")
                    .isEqualTo(AuthorityFence.planned(off.need().type()).authority());
            if (!eo.get("status").asText().equals(e.get("status").asText())) {
                changed++;
            }
        }
        // F02 F03 F05 F09 F10: what v2.2 let through. Each is also a mutation test — remove the fence and `off` happens.
        assertThat(changed).as("scenarios whose status only the fence changes").isEqualTo(5);
    }

    /** v2.2 exactly: the judge's verdict through NeedAggregation.enforce (or, for a `raw` scenario, bypassing it). */
    static NeedResult v22(JsonNode s, DetailCapability detail, boolean bound) {
        NeedType type = NeedType.valueOf(s.get("needType").asText());
        InquiryNeed need = new InquiryNeed("N1", "질문", type, "질문");
        Map<String, EvidenceCandidate> pool = new LinkedHashMap<>();
        List<String> cited = new ArrayList<>();
        for (JsonNode c : s.get("cites")) {
            String id = "E" + (pool.size() + 1);
            pool.put(id, candidate(id, c.asText()));
            cited.add(id);
        }
        NeedStatus status = NeedStatus.valueOf(s.get("verdict").asText());
        if (s.path("raw").asBoolean(false)) {
            return new NeedResult(status, need, status, List.copyOf(pool.values()), List.of(), null, null, false, null);
        }
        NeedVerdict v = new NeedVerdict("N1", status, cited, List.of(), List.of(), List.of(),
                status == NeedStatus.CONDITIONAL_ON_CUSTOMER ? "규격" : null, List.of());
        return NeedAggregation.enforce(List.of(need), Map.of("N1", v), pool, Map.<String, PrecedentCandidate>of(), detail,
                new EvidenceScope.CaseScope(AuthorityScenarios.PRODUCT, bound ? AuthorityScenarios.ORDER_KEY : null)).get(0);
    }

    static EvidenceCandidate candidate(String id, String what) {
        return switch (what) {
            case "POLICY" -> new EvidenceCandidate(id, EvidenceCandidate.Kind.ORG_KNOWLEDGE, "배송 정책", "출고 2일",
                    UUID.randomUUID(), null, null);
            case "THIS_PRODUCT" -> new EvidenceCandidate(id, EvidenceCandidate.Kind.PRODUCT_KNOWLEDGE, "상품 정보",
                    "안쪽 폭 12mm", UUID.randomUUID(), AuthorityScenarios.PRODUCT, null);
            case "THIS_ORDER" -> new EvidenceCandidate(id, EvidenceCandidate.Kind.ORDER_FACT, "주문 상태", "결제 완료",
                    null, null, null, EvidenceScope.order(AuthorityScenarios.ORDER_KEY));
            case "OTHER_ORDER" -> new EvidenceCandidate(id, EvidenceCandidate.Kind.ORDER_FACT, "주문 상태", "결제 완료",
                    null, null, null, EvidenceScope.order("channel|ORD-OTHER"));
            default -> throw new IllegalArgumentException(what);
        };
    }

    @Test
    @DisplayName("4181864b end to end through the engine: v2.2 ends where it did, the fence also closes the CONDITIONAL shape")
    void engineEndToEnd() {
        InquiryNeed need = new InquiryNeed("N1", "언제 받을 수 있나요", NeedType.ORDER_STATE, "발송");
        EvidenceCandidate policy = candidate(null, "POLICY");
        CapabilitySnapshot snap = CapabilityRegistry.derive(new CapabilityRegistry.Inputs("NAVER", "NAVER_PRODUCT_QNA",
                false, com.sellerops.order.fact.OrderFactLookup.EXACT_ALLOWED, AuthorityScenarios.PRODUCT,
                DetailCapability.READABLE, true, 5));
        AuthorityFence.Context ctx = new AuthorityFence.Context(snap, null, null);
        for (NeedStatus judged : List.of(NeedStatus.FULL, NeedStatus.CONDITIONAL_ON_CUSTOMER)) {
            InquiryDecisionModel model = model(need, new NeedVerdict("N1", judged, List.of("E1"), List.of(), List.of(),
                    List.of(), judged == NeedStatus.CONDITIONAL_ON_CUSTOMER ? "주문 번호" : null, List.of()));
            NeedDecision without = InquiryDecisionEngine.decide(ORG, "q", model,
                    needs -> new InquiryDecisionEngine.Pool(List.of(policy), List.of()), DetailCapability.READABLE,
                    new EvidenceScope.CaseScope(AuthorityScenarios.PRODUCT, null));
            NeedDecision with = InquiryDecisionEngine.decide(ORG, "q", model,
                    needs -> new InquiryDecisionEngine.Pool(List.of(policy), List.of()), DetailCapability.READABLE,
                    new EvidenceScope.CaseScope(AuthorityScenarios.PRODUCT, null), ctx);
            assertThat(with.basis()).as(judged + " with the fence").isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
            assertThat(with.needs().get(0).resolution().gap()).isEqualTo(GapReason.UNBOUND);
            assertThat(without.basis()).as(judged + " v2.2").isEqualTo(judged == NeedStatus.FULL
                    ? AnswerBasisState.NO_ANSWER_BASIS : AnswerBasisState.NEEDS_CLARIFICATION);
            assertThat(without.needs().get(0).resolution()).isNull();
        }
    }

    @Test
    @DisplayName("fence OFF is v2.2 byte for byte: the engine without a context returns exactly what enforce returns")
    void offIsV22() {
        InquiryNeed need = new InquiryNeed("N1", "폭", NeedType.PRODUCT_SPEC, "폭");
        EvidenceCandidate k = candidate(null, "THIS_PRODUCT");
        NeedVerdict v = new NeedVerdict("N1", NeedStatus.FULL, List.of("E1"), List.of(), List.of(), List.of(), null,
                List.of());
        NeedDecision d = InquiryDecisionEngine.decide(ORG, "q", model(need, v),
                needs -> new InquiryDecisionEngine.Pool(List.of(k), List.of()), DetailCapability.READABLE,
                new EvidenceScope.CaseScope(AuthorityScenarios.PRODUCT, null));
        List<NeedResult> direct = NeedAggregation.enforce(List.of(need), Map.of("N1", v), Map.of("E1", k.withId("E1")),
                Map.of(), DetailCapability.READABLE, new EvidenceScope.CaseScope(AuthorityScenarios.PRODUCT, null));
        assertThat(d.needs()).isEqualTo(direct);
    }

    static InquiryDecisionModel model(InquiryNeed need, NeedVerdict verdict) {
        return new InquiryDecisionModel() {
            public boolean enabledFor(UUID orgId) {
                return true;
            }

            public Answer<List<InquiryNeed>> plan(UUID orgId, String question) {
                return new Answer<>(List.of(need), CallCost.NONE);
            }

            public Answer<Map<String, NeedVerdict>> judge(UUID orgId, String question, List<InquiryNeed> needs,
                                                          List<EvidenceCandidate> evidence,
                                                          List<PrecedentCandidate> precedents) {
                return new Answer<>(Map.of("N1", verdict), CallCost.NONE);
            }
        };
    }
}
