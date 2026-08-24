package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.inquiry.InquirySourceSubtype;
import com.sellerops.channel.ChannelRepository;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The registry resolves the adapter for a work item's exact channel by {@code
 * Channel.code}, and fails closed (empty) for a channel with no adapter, an unknown
 * channel id, or a null id.
 */
class ChannelReplyAdapterRegistryTest {

    private static final class FakeAdapter implements ChannelReplyAdapter {
        private final String code;

        FakeAdapter(String code) {
            this.code = code;
        }

        @Override
        public String channelCode() {
            return code;
        }

        @Override
        public ReplyPublishResult publish(ReplyPublishCommand command) {
            return ReplyPublishResult.confirmed("X");
        }

        @Override
        public ReplyVerificationResult verify(ReplyVerificationCommand command) {
            return ReplyVerificationResult.completed("X");
        }
    }

    private Channel channelWithCode(String code) {
        Channel c = new Channel();
        c.setCode(code);
        return c;
    }

    @Test
    void resolvesTheAdapterServingTheChannelCode() {
        ChannelRepository channels = mock(ChannelRepository.class);
        UUID channelId = UUID.randomUUID();
        when(channels.findById(channelId)).thenReturn(Optional.of(channelWithCode("GMARKET")));

        FakeAdapter esm = new FakeAdapter("GMARKET");
        ChannelReplyAdapterRegistry registry = new ChannelReplyAdapterRegistry(channels, List.of(esm));

        assertThat(registry.resolve(channelId, null)).containsSame(esm);
    }

    @Test
    void anAdapterServesOneResourceOfItsChannelNotTheChannel() {
        // A channel code is not specific enough to send with. NAVER carries two inquiry resources
        // whose identifiers do not overlap (questionId vs inquiryNo) and whose answer endpoints are
        // different calls; an adapter claiming "NAVER" would let an approval granted for one be spent
        // by an implementation written for the other. The default serves the null subtype only, so a
        // multi-resource channel cannot be served by accident — it has to be declared.
        ChannelRepository channels = mock(ChannelRepository.class);
        UUID channelId = UUID.randomUUID();
        when(channels.findById(channelId)).thenReturn(Optional.of(channelWithCode("GMARKET")));

        FakeAdapter single = new FakeAdapter("GMARKET");
        ChannelReplyAdapterRegistry registry = new ChannelReplyAdapterRegistry(channels, List.of(single));

        assertThat(registry.resolve(channelId, null)).containsSame(single);
        assertThat(registry.resolve(channelId, InquirySourceSubtype.NAVER_PRODUCT_QNA)).isEmpty();
        assertThat(registry.resolve(channelId, InquirySourceSubtype.NAVER_CUSTOMER_INQUIRY)).isEmpty();
    }

    @Test
    void everyRegisteredAdapterHasAnImplementedCapabilityRow() {
        // Two statements about the same fact — "an adapter exists" and "the capability audit says
        // DIRECT_API" — and the send path consults both. If they can disagree, the hand-maintained
        // list silently vetoes a working transport, or blesses one that does not exist. This is the
        // seam that keeps them one fact.
        InquiryReplyCapabilityRegistry capabilities = new InquiryReplyCapabilityRegistry();
        ChannelReplyAdapterRegistry adapters = new ChannelReplyAdapterRegistry(
                mock(ChannelRepository.class),
                List.of(new FakeAdapter("GMARKET"), new FakeAdapter("COUPANG")));

        assertThat(adapters.registeredChannelCodes())
                .allSatisfy(code -> assertThat(capabilities.isImplemented(code, null))
                        .as("adapter registered for %s but the capability audit does not say DIRECT_API", code)
                        .isTrue());
    }

    @Test
    void failsClosedForAChannelWithNoAdapter() {
        ChannelRepository channels = mock(ChannelRepository.class);
        UUID channelId = UUID.randomUUID();
        when(channels.findById(channelId)).thenReturn(Optional.of(channelWithCode("NAVER")));

        ChannelReplyAdapterRegistry registry =
                new ChannelReplyAdapterRegistry(channels, List.of(new FakeAdapter("GMARKET")));

        assertThat(registry.resolve(channelId, null)).isEmpty();
    }

    @Test
    void failsClosedForCafe24WhichHasNoReplyAdapter() {
        // Cafe24 can be collected (board-6 inquiries open work items) but has no reply
        // adapter — even with the ESM (GMARKET) adapter present, a Cafe24 work item
        // resolves to no adapter, so the common publish flow fails closed and never
        // dispatches or writes anything back to the mall.
        ChannelRepository channels = mock(ChannelRepository.class);
        UUID channelId = UUID.randomUUID();
        when(channels.findById(channelId)).thenReturn(Optional.of(channelWithCode("CAFE24")));

        ChannelReplyAdapterRegistry registry =
                new ChannelReplyAdapterRegistry(channels, List.of(new FakeAdapter("GMARKET")));

        assertThat(registry.resolve(channelId, null)).isEmpty();
    }

    @Test
    void failsClosedForUnknownChannelId() {
        ChannelRepository channels = mock(ChannelRepository.class);
        UUID channelId = UUID.randomUUID();
        when(channels.findById(channelId)).thenReturn(Optional.empty());

        ChannelReplyAdapterRegistry registry =
                new ChannelReplyAdapterRegistry(channels, List.of(new FakeAdapter("GMARKET")));

        assertThat(registry.resolve(channelId, null)).isEmpty();
    }

    @Test
    void failsClosedForNullChannelId() {
        ChannelRepository channels = mock(ChannelRepository.class);
        ChannelReplyAdapterRegistry registry =
                new ChannelReplyAdapterRegistry(channels, List.of(new FakeAdapter("GMARKET")));

        assertThat(registry.resolve(null, null)).isEmpty();
    }

    @Test
    void withNoAdaptersEverythingFailsClosed() {
        ChannelRepository channels = mock(ChannelRepository.class);
        UUID channelId = UUID.randomUUID();
        when(channels.findById(channelId)).thenReturn(Optional.of(channelWithCode("GMARKET")));

        ChannelReplyAdapterRegistry registry = new ChannelReplyAdapterRegistry(channels, List.of());

        assertThat(registry.resolve(channelId, null)).isEmpty();
    }
}
