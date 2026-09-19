package com.sellerops.inquiry.authority;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.inquiry.decision.DetailCapability;
import com.sellerops.inquiry.decision.EvidenceScope;
import com.sellerops.order.fact.OrderFactLookup;
import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The authority layer's own guarantees, independent of any scenario: what a {@link Resolution} may never say, what the
 * registry always says, and what the package may never reach.
 */
class AuthorityLayerInvariantTest {

    static final Path MAIN = Path.of("src", "main", "java", "com", "sellerops", "inquiry", "authority");

    @Test
    @DisplayName("a Resolution cannot ask for identity, close a procedure, close an entity on a stale row, or hide a gap")
    void resolutionInvariants() {
        assertThatThrownBy(() -> new Resolution(CapabilityId.KNOWLEDGE_PRODUCT, ResolutionState.NEEDS_CUSTOMER_INPUT, null,
                null, List.of(CustomerInput.ORDER_NUMBER), null, null)).hasMessageContaining("identity");
        assertThatThrownBy(() -> Resolution.of(CapabilityId.PROCEDURE_ORDER_ACTION, ResolutionState.RESOLVED))
                .hasMessageContaining("procedure");
        ObservedField stale = new ObservedField(EntityField.ORDER_PAYMENT, "PAID", new AuthorityProvenance(
                CapabilityId.ENTITY_ORDER, EvidenceScope.order("k"), AuthorityProvenance.Source.ORDER_STORED,
                Instant.EPOCH, AuthorityProvenance.Freshness.UNPROVEN));
        assertThatThrownBy(() -> new Resolution(CapabilityId.ENTITY_ORDER, ResolutionState.RESOLVED, null, null, null,
                List.of(stale), null)).hasMessageContaining("fresh");
        assertThatThrownBy(() -> Resolution.of(CapabilityId.ENTITY_ORDER, ResolutionState.RESOLVED))
                .hasMessageContaining("fresh");
        assertThatThrownBy(() -> Resolution.of(CapabilityId.ENTITY_ORDER, ResolutionState.CAPABILITY_GAP))
                .hasMessageContaining("gap reason");
        assertThatThrownBy(() -> new Resolution(CapabilityId.SELLER, ResolutionState.NEEDS_SELLER, GapReason.UNBOUND,
                null, null, null, null)).hasMessageContaining("gap reason");
        assertThatThrownBy(() -> Resolution.of(CapabilityId.KNOWLEDGE_PRODUCT, ResolutionState.RESOLVED_CONDITIONAL))
                .hasMessageContaining("names what to ask");
    }

    @Test
    @DisplayName("the registry: every procedure is declared without an executor, tracking is never observable, the "
            + "store never proves cancellation or fulfillment, and only NAVER's stored payment has a proven meaning")
    void registryPolicy() {
        for (String ch : new String[]{"NAVER", "CAFE24", "COUPANG", null}) {
            for (OrderFactLookup l : OrderFactLookup.values()) {
                CapabilitySnapshot s = CapabilityRegistry.derive(new CapabilityRegistry.Inputs(ch, null, true, l, null,
                        DetailCapability.NOT_APPLICABLE, false, 0));
                assertThat(s.status(CapabilityId.PROCEDURE_ORDER_ACTION)).isEqualTo(CapabilityStatus.DECLARED_NO_EXECUTOR);
                assertThat(s.status(CapabilityId.SELLER)).isEqualTo(CapabilityStatus.AVAILABLE);
                assertThat(s.status(EntityField.ORDER_TRACKING)).isEqualTo(CapabilityStatus.NOT_SUPPORTED);
                boolean exact = l == OrderFactLookup.EXACT_ALLOWED && "CAFE24".equals(ch);
                assertThat(s.status(EntityField.ORDER_FULFILLMENT) == CapabilityStatus.AVAILABLE).as(ch + " " + l)
                        .isEqualTo(exact);
                assertThat(s.status(EntityField.ORDER_PAYMENT) == CapabilityStatus.AVAILABLE).as(ch + " " + l)
                        .isEqualTo(exact || "NAVER".equals(ch));
                assertThat(s.status(CapabilityId.KNOWLEDGE_PRODUCT)).as("no listing, no listing knowledge")
                        .isEqualTo(CapabilityStatus.NOT_SUPPORTED);
            }
        }
        assertThat(InquirySurface.of("NAVER_PRODUCT_QNA")).isEqualTo(InquirySurface.PUBLIC_QNA);
        assertThat(InquirySurface.of(null)).as("unknown is public").isEqualTo(InquirySurface.PUBLIC_QNA);
        assertThat(InquirySurface.of("NAVER_CUSTOMER_INQUIRY")).isEqualTo(InquirySurface.ORDER_ATTACHED);
    }

    @Test
    @DisplayName("the snapshot fingerprint is stable and moves with any fact")
    void fingerprint() {
        CapabilityRegistry.Inputs in = new CapabilityRegistry.Inputs("NAVER", "NAVER_PRODUCT_QNA", false,
                OrderFactLookup.EXACT_ALLOWED, java.util.UUID.randomUUID(), DetailCapability.READABLE, true, 5);
        String a = CapabilityRegistry.derive(in).fingerprint();
        assertThat(CapabilityRegistry.derive(in).fingerprint()).isEqualTo(a);
        assertThat(CapabilityRegistry.derive(new CapabilityRegistry.Inputs("NAVER", "NAVER_PRODUCT_QNA", false,
                OrderFactLookup.EXACT_ALLOWED, in.productId(), DetailCapability.READABLE, true, 4)).fingerprint())
                .isNotEqualTo(a);
    }

    @Test
    @DisplayName("the authority layer reaches no model, no network, no channel reader, and writes nothing")
    void noModelNoNetworkNoWrite() throws IOException {
        List<String> forbidden = List.of("ExactOrderReader", "ExactOrderReaders", "RestClient", "WebClient", "HttpClient",
                "java.net.", "AgentLlm", "InquiryDecisionGenerator", "ChatModel", ".save(", ".delete(", "@Transactional",
                "InquiryPublish", "ChannelReplyAdapter");
        try (Stream<Path> files = Files.list(MAIN)) {
            for (Path p : files.filter(f -> f.toString().endsWith(".java")).toList()) {
                String src = Files.readString(p).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("//[^\\n]*", "");
                for (String f : forbidden) {
                    assertThat(src).as(p.getFileName() + " must not reference " + f).doesNotContain(f);
                }
                if (!p.getFileName().toString().equals("CapabilityRegistry.java")) {
                    assertThat(src).as(p.getFileName() + ": only the registry reads rows").doesNotContain("Repository");
                }
            }
        }
    }

    @Test
    @DisplayName("the fence is OFF by default in application.yml")
    void defaultOff() throws IOException {
        String yml = Files.readString(Path.of("src", "main", "resources", "application.yml"));
        assertThat(yml).contains("  inquiry-authority:\n    fence:\n      enabled: ${SELLEROPS_INQUIRY_AUTHORITY_FENCE_ENABLED:false}");
        assertThat(new AuthorityFenceProperties(false).enabled()).isFalse();
    }
}
