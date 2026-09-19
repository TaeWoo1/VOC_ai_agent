package com.sellerops.inquiry.decision;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.draft.AnswerBasisState;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Inquiry Decision v2.2 — <b>evidence must be about the instance the need is about</b>. One generic check over
 * {@link EvidenceScope}; no product, shipping or size word anywhere in it. The shape that motivated it: in the A/B run
 * (apr-8ef649ab) judge v2 called an ORDER_STATE need FULL citing only the company's shipping policy (R 4181864b).
 */
class EvidenceScopeInvariantTest {

    static final UUID PRODUCT = UUID.randomUUID();
    static final String ORDER = "channel|ORD-1";
    static final EvidenceScope.CaseScope CASE = new EvidenceScope.CaseScope(PRODUCT, ORDER);

    static InquiryNeed need(NeedType type) {
        return new InquiryNeed("N1", "질문", type, "질문");
    }

    static NeedVerdict full(String... evidence) {
        return new NeedVerdict("N1", NeedStatus.FULL, List.of(evidence), List.of(), List.of(), List.of(), null, List.of());
    }

    static EvidenceCandidate policy(String id) {
        return new EvidenceCandidate(id, EvidenceCandidate.Kind.ORG_KNOWLEDGE, "배송 정책", "출고 후 2일", UUID.randomUUID(),
                null, null);
    }

    static EvidenceCandidate orderFact(String id, String orderKey) {
        return new EvidenceCandidate(id, EvidenceCandidate.Kind.ORDER_FACT, "주문 상태", "결제 완료 · 발송 전", null, null,
                null, EvidenceScope.order(orderKey));
    }

    static NeedResult enforce(NeedType type, NeedVerdict v, EvidenceScope.CaseScope scope, EvidenceCandidate... cs) {
        Map<String, EvidenceCandidate> pool = new LinkedHashMap<>();
        for (EvidenceCandidate c : cs) {
            pool.put(c.id(), c);
        }
        return NeedAggregation.enforce(List.of(need(type)), Map.of("N1", v), pool, Map.of(), DetailCapability.READABLE,
                scope).get(0);
    }

    @Test
    @DisplayName("an order need cannot be FULL on a company rule alone — PARTIAL, and the Case is the seller's (4181864b)")
    void orderNeedOnPolicyAlone() {
        for (NeedType type : List.of(NeedType.ORDER_STATE, NeedType.ORDER_ACTION)) {
            NeedResult r = enforce(type, full("E1"), CASE, policy("E1"));
            assertThat(r.status()).as(type.name()).isEqualTo(NeedStatus.PARTIAL);
            assertThat(r.judged()).isEqualTo(NeedStatus.FULL);
            assertThat(r.enforcement()).isEqualTo(NeedResult.Enforcement.SCOPE_UNATTRIBUTED);
            assertThat(NeedAggregation.basis(List.of(r))).isEqualTo(AnswerBasisState.NO_ANSWER_BASIS);
        }
    }

    @Test
    @DisplayName("with THIS order's own fact cited, an order need may be FULL")
    void orderNeedOnItsOwnFact() {
        NeedResult r = enforce(NeedType.ORDER_STATE, full("E1", "E2"), CASE, policy("E1"), orderFact("E2", ORDER));
        assertThat(r.status()).isEqualTo(NeedStatus.FULL);
        assertThat(r.enforcement()).isNull();
    }

    @Test
    @DisplayName("another order's fact is dropped like another listing's; an unattributed or case-less order fact proves nothing")
    void otherOrdersAndUnattributedFacts() {
        NeedResult other = enforce(NeedType.ORDER_STATE, full("E1"), CASE, orderFact("E1", "channel|ORD-2"));
        assertThat(other.status()).isEqualTo(NeedStatus.NONE);
        assertThat(other.enforcement()).isEqualTo(NeedResult.Enforcement.OTHER_INSTANCE_ONLY);

        NeedResult mixed = enforce(NeedType.ORDER_STATE, full("E1", "E2"), CASE, policy("E1"),
                orderFact("E2", "channel|ORD-2"));
        assertThat(mixed.status()).as("the policy survives, the other order does not — and a policy is not this order")
                .isEqualTo(NeedStatus.PARTIAL);
        assertThat(mixed.evidence()).extracting(EvidenceCandidate::id).containsExactly("E1");

        assertThat(enforce(NeedType.ORDER_STATE, full("E1"), CASE, orderFact("E1", null)).status())
                .as("a fact nobody attributed").isEqualTo(NeedStatus.PARTIAL);
        assertThat(enforce(NeedType.ORDER_STATE, full("E1"), new EvidenceScope.CaseScope(PRODUCT, null),
                orderFact("E1", ORDER)).status()).as("a Case with no order of its own").isEqualTo(NeedStatus.PARTIAL);
    }

    @Test
    @DisplayName("the rule is about FULL only: PARTIAL, NONE and CONDITIONAL on an order need are left as the judge said")
    void onlyFullIsHeldToAttribution() {
        NeedVerdict partial = new NeedVerdict("N1", NeedStatus.PARTIAL, List.of("E1"), List.of("주문 상태"), List.of(),
                List.of(), null, List.of());
        assertThat(enforce(NeedType.ORDER_STATE, partial, CASE, policy("E1")).status()).isEqualTo(NeedStatus.PARTIAL);
        NeedVerdict none = new NeedVerdict("N1", NeedStatus.NONE, List.of(), List.of("주문 상태"), List.of(), List.of(),
                null, List.of());
        assertThat(enforce(NeedType.ORDER_STATE, none, CASE, policy("E1")).status()).isEqualTo(NeedStatus.NONE);
    }

    @Test
    @DisplayName("listing needs keep v2.1's fence and nothing more: another listing is refused, a company rule is not")
    void listingNeedsUnchanged() {
        EvidenceCandidate otherListing = new EvidenceCandidate("E1", EvidenceCandidate.Kind.OPTIONS, "옵션", "사이즈: 1",
                null, UUID.randomUUID(), null);
        assertThat(enforce(NeedType.PRODUCT_SPEC, full("E1"), CASE, otherListing).enforcement())
                .isEqualTo(NeedResult.Enforcement.OTHER_INSTANCE_ONLY);
        assertThat(enforce(NeedType.PRODUCT_SPEC, full("E1"), CASE, policy("E1")).status())
                .as("a company-wide statement may answer a listing question").isEqualTo(NeedStatus.FULL);
        assertThat(enforce(NeedType.CATALOGUE_AVAILABILITY, full("E1"), CASE, otherListing).status())
                .as("availability names no instance").isEqualTo(NeedStatus.FULL);
        assertThat(enforce(NeedType.POLICY, full("E1"), CASE, policy("E1")).status()).isEqualTo(NeedStatus.FULL);
    }

    @Test
    @DisplayName("scope is recorded from provenance: listing kinds to their listing, rules to the company, an order to its key")
    void scopeFromProvenance() {
        assertThat(new EvidenceCandidate("E1", EvidenceCandidate.Kind.PRODUCT_FACTS, "t", "x", null, PRODUCT, "k").scope())
                .isEqualTo(EvidenceScope.product(PRODUCT));
        assertThat(policy("E1").scope()).isEqualTo(EvidenceScope.ORG);
        assertThat(new EvidenceCandidate("E1", EvidenceCandidate.Kind.ORDER_FACT, "t", "x", null, null, null).scope())
                .as("an order fact is attributed only when the collector says to which order").isEqualTo(EvidenceScope.order(null));
        Inquiry inquiry = new Inquiry();
        UUID channel = UUID.randomUUID();
        inquiry.setChannelId(channel);
        inquiry.setSourceOrderRef(" ORD-9 ");
        assertThat(EvidenceScope.orderKey(PrecedentReuse.OrderKey.of(inquiry))).isEqualTo(channel + "|ORD-9");
        assertThat(EvidenceScope.orderKey(PrecedentReuse.OrderKey.of(new Inquiry()))).isNull();
        assertThat(orderFact("E1", ORDER).withId("E7").scope()).as("renumbering keeps the scope")
                .isEqualTo(EvidenceScope.order(ORDER));
    }
}
