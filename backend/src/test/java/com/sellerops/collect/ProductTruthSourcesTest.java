package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.agent.llm.converse.AgentConversePrompt;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.dto.ChannelCapabilityOverview;
import com.sellerops.connector.ConnectorCapabilities;
import com.sellerops.connector.ConnectorCapability;
import com.sellerops.connector.ConnectorCapabilityRepository;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.connector.DataType;
import com.sellerops.connector.FetchPage;
import com.sellerops.connector.FetchRequest;
import com.sellerops.connector.PullConnector;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import org.junit.jupiter.api.Test;

/**
 * <b>The two backend sources Product Self-Knowledge Truth Closure v1 needed, and the prompt rule that
 * uses them.</b>
 *
 * <p>Manual owner QA (2026-09-07) produced seven product sentences that were each grounded in a line of
 * the Agent's fact sheet and wrong as stated. Two of the seven could not have been right, because the
 * facts they would have needed did not exist anywhere:
 *
 * <ul>
 *   <li><b>PRODUCT had no per-channel answer.</b> One of the four operating objects was absent from the
 *       coverage table, from this overview's data types, from {@code AcquisitionPathRegistry} and from
 *       {@code SelfPilotReconciler.ROUTINE_TYPES}. So 「상품」 was asserted at product level with nothing
 *       to check it against on any channel. It is answered here, from the SAME live connector, in its
 *       own list — the operator badge row is the seller-visible contract of {@code dataTypes} and
 *       widening it would change a screen nobody asked to change.</li>
 *   <li><b>The reference table and the live connector disagree, and nobody carried both.</b> Reading
 *       one alone is how a capability nobody proved gets stated: this deployment's table says Coupang
 *       PRODUCT is CONFIRMED while the connector says NEEDS_VERIFICATION, and says Coupang INQUIRY is
 *       NEEDS_VERIFICATION while the connector says CONFIRMED. Both words now ride together and the
 *       reader goes the conservative way.</li>
 * </ul>
 *
 * <p>Plain unit test over a real {@link ConnectorRegistry} with a stub connector — no Spring, no DB.
 */
class ProductTruthSourcesTest {

    private final ChannelRepository channels = mock(ChannelRepository.class);
    private final ConnectorCapabilityRepository capabilities = mock(ConnectorCapabilityRepository.class);

    private CollectControlService serviceWith(ConnectorRegistry registry) {
        return new CollectControlService(
                null, channels, null, null, null, capabilities, registry, null, null, null, null, null, null);
    }

    private static ConnectorCapability declared(String dataType, boolean supported) {
        ConnectorCapability row = new ConnectorCapability();
        row.setChannelCode("STUB");
        row.setDataType(dataType);
        row.setSupported(supported);
        row.setVerificationStatus(supported ? "CONFIRMED" : "UNSUPPORTED");
        return row;
    }

    private ChannelCapabilityOverview overview(Set<DataType> supported, Map<DataType, String> status,
                                               List<ConnectorCapability> declaredRows) {
        Channel stub = new Channel();
        stub.setCode("STUB");
        stub.setNameKo("스텁");
        when(channels.findByCode("STUB")).thenReturn(Optional.of(stub));
        when(capabilities.findByChannelCode("STUB")).thenReturn(declaredRows);
        return serviceWith(new ConnectorRegistry(List.of(new StubConnector(supported, status))))
                .channelCapabilityOverview("STUB");
    }

    @Test
    void productIsAnsweredPerChannelWithoutJoiningTheOperatorBadgeRow() {
        ChannelCapabilityOverview view = overview(
                Set.of(DataType.ORDER_SUMMARY, DataType.INQUIRY, DataType.PRODUCT),
                Map.of(DataType.ORDER_SUMMARY, "CONFIRMED", DataType.INQUIRY, "CONFIRMED",
                        DataType.PRODUCT, "CONFIRMED"),
                List.of());

        // The badge row is byte-identical to what it always was: three types, in display order.
        assertThat(view.dataTypes())
                .extracting(ChannelCapabilityOverview.DataTypeCapability::dataType)
                .containsExactly("ORDER_SUMMARY", "REVIEW", "INQUIRY");
        // And PRODUCT is answered beside it, from the same connector — so the Agent's fourth operating
        // object finally has a per-channel fact to be checked against.
        assertThat(view.backgroundDataTypes())
                .singleElement()
                .satisfies(product -> {
                    assertThat(product.dataType()).isEqualTo("PRODUCT");
                    assertThat(product.supported()).isTrue();
                    assertThat(product.verificationStatus()).isEqualTo("CONFIRMED");
                });
        // SALES is deliberately absent: a sales trend is a derived measure of ORDER, not an object.
        assertThat(view.backgroundDataTypes())
                .extracting(ChannelCapabilityOverview.DataTypeCapability::dataType)
                .doesNotContain("SALES");
    }

    @Test
    void bothSourcesTravelSoNeitherCanBeSilentlyPreferred() {
        ChannelCapabilityOverview view = overview(
                // The connector serves INQUIRY and not PRODUCT …
                Set.of(DataType.INQUIRY),
                Map.of(DataType.INQUIRY, "CONFIRMED"),
                // … while the reference table says exactly the opposite about both. This is the shape of
                // the two live divergences, and reading either source alone would state a capability
                // nobody proved.
                List.of(declared("INQUIRY", false), declared("PRODUCT", true)));

        ChannelCapabilityOverview.DataTypeCapability inquiry = view.dataTypes().stream()
                .filter(d -> "INQUIRY".equals(d.dataType())).findFirst().orElseThrow();
        assertThat(inquiry.supported()).isTrue();
        assertThat(inquiry.declaredSupport()).isEqualTo("UNSUPPORTED");

        ChannelCapabilityOverview.DataTypeCapability product = view.backgroundDataTypes().stream()
                .filter(d -> "PRODUCT".equals(d.dataType())).findFirst().orElseThrow();
        assertThat(product.supported()).isFalse();
        assertThat(product.declaredSupport()).isEqualTo("SUPPORTED");
    }

    @Test
    void theVerificationWordTravelsToo_soADivergenceOnItIsNotLost() {
        // Live today: Coupang INQUIRY is supported in BOTH sources and the table still says
        // NEEDS_VERIFICATION while the connector says CONFIRMED — a live proof promoted one and the
        // table never caught up. Carrying only the boolean would hide that entirely.
        ConnectorCapability lagging = declared("INQUIRY", true);
        lagging.setVerificationStatus("NEEDS_VERIFICATION");
        ChannelCapabilityOverview view = overview(
                Set.of(DataType.INQUIRY), Map.of(DataType.INQUIRY, "CONFIRMED"), List.of(lagging));

        ChannelCapabilityOverview.DataTypeCapability inquiry = view.dataTypes().stream()
                .filter(d -> "INQUIRY".equals(d.dataType())).findFirst().orElseThrow();
        assertThat(inquiry.declaredSupport()).isEqualTo("SUPPORTED");
        assertThat(inquiry.verificationStatus()).isEqualTo("CONFIRMED");
        assertThat(inquiry.declaredVerificationStatus()).isEqualTo("NEEDS_VERIFICATION");
    }

    @Test
    void aTypeTheTableNeverMentionedIsUndeclaredRatherThanUnsupported() {
        // A missing row means nobody wrote the capability down; collapsing that into "unsupported" is
        // the mistake `ChannelCoverageService.Support.UNDECLARED` already exists to refuse.
        ChannelCapabilityOverview view = overview(
                Set.of(DataType.REVIEW), Map.of(DataType.REVIEW, "CONFIRMED"), List.of());

        assertThat(view.dataTypes())
                .allSatisfy(d -> {
                    assertThat(d.declaredSupport()).isEqualTo("UNDECLARED");
                    assertThat(d.declaredVerificationStatus()).isNull();
                });
        assertThat(view.backgroundDataTypes())
                .allSatisfy(d -> assertThat(d.declaredSupport()).isEqualTo("UNDECLARED"));
    }

    /**
     * The prompt rules that make the sheet's per-channel shape enforceable at all.
     *
     * <p>Asserted on the SYSTEM string rather than described in prose, for the same reason every other
     * prompt in this repository pins its version: a rule that quietly disappears takes a whole class of
     * QA defect with it, and nothing else in the build would notice.
     */
    @Test
    void thePromptForbidsTheGeneralisationsQaMeasured() {
        String system = AgentConversePrompt.system();

        assertThat(AgentConversePrompt.PROMPT_VERSION).isEqualTo("agent-converse-prompt/v4");
        // v4 (2026-09-08): manual QA asked 「지금 자동으로 가져오고 있어?」 and got the answer plus a
        // walk through every channel and object that has an automatic path. The state was correct and
        // the list was not the question.
        assertThat(system).contains("상태를 먼저 답하세요");
        // 「자동으로 문의·리뷰·주문을 가져와 읽고」 — one channel's fact widened to every channel.
        assertThat(system).contains("제품 전체의 사실로 넓히지 마세요");
        // 「자동으로 …가져오고 있습니다」 — a capability read as a present-tense behaviour.
        assertThat(system).contains("「할 수 있다」와 「지금 하고 있다」를 구분하세요");
        // A PARTIAL or an UNKNOWN turned into 「된다」 / 「안 된다」.
        assertThat(system).contains("확인되지 않은 것은 확인되지 않았다고 말하세요");
        // 「다루는 영역은 …뿐」 — a derived list turned into an exclusion.
        assertThat(system).contains("「뿐」");
        assertThat(system).contains("그 목록이 전부라고 단정하지 마세요");
        // v3 — the three shapes the Canonical Product Source added, and the one that keeps evidence
        // honest without ever naming an evidence level.
        assertThat(system).contains("「제품 방향」으로 표시된 사실");
        assertThat(system).contains("「앞으로의 방향」을 언급할 때는 그 사실에 함께 적힌 한정어를 반드시 같이 말하세요");
        assertThat(system).contains("앞부분만 말하고 한계를 빼지 마세요");
        assertThat(system).contains("종류별로 나뉘어 적혀 있으면");
    }

    /** A connector that serves exactly what the test says and nothing else. */
    private record StubConnector(Set<DataType> supported, Map<DataType, String> status)
            implements PullConnector {

        @Override
        public String kind() {
            return "API";
        }

        @Override
        public Set<String> dedicatedChannels() {
            return Set.of("STUB");
        }

        @Override
        public ConnectorCapabilities capabilities(String channelCode) {
            return new ConnectorCapabilities("API", supported, status, "stub");
        }

        @Override
        public FetchPage fetch(FetchRequest request) {
            throw new UnsupportedOperationException("capability read only");
        }
    }
}
