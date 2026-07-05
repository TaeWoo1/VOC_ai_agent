package com.sellerops.inquiry.publish;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
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

        assertThat(registry.resolve(channelId)).containsSame(esm);
    }

    @Test
    void failsClosedForAChannelWithNoAdapter() {
        ChannelRepository channels = mock(ChannelRepository.class);
        UUID channelId = UUID.randomUUID();
        when(channels.findById(channelId)).thenReturn(Optional.of(channelWithCode("NAVER")));

        ChannelReplyAdapterRegistry registry =
                new ChannelReplyAdapterRegistry(channels, List.of(new FakeAdapter("GMARKET")));

        assertThat(registry.resolve(channelId)).isEmpty();
    }

    @Test
    void failsClosedForUnknownChannelId() {
        ChannelRepository channels = mock(ChannelRepository.class);
        UUID channelId = UUID.randomUUID();
        when(channels.findById(channelId)).thenReturn(Optional.empty());

        ChannelReplyAdapterRegistry registry =
                new ChannelReplyAdapterRegistry(channels, List.of(new FakeAdapter("GMARKET")));

        assertThat(registry.resolve(channelId)).isEmpty();
    }

    @Test
    void failsClosedForNullChannelId() {
        ChannelRepository channels = mock(ChannelRepository.class);
        ChannelReplyAdapterRegistry registry =
                new ChannelReplyAdapterRegistry(channels, List.of(new FakeAdapter("GMARKET")));

        assertThat(registry.resolve(null)).isEmpty();
    }

    @Test
    void withNoAdaptersEverythingFailsClosed() {
        ChannelRepository channels = mock(ChannelRepository.class);
        UUID channelId = UUID.randomUUID();
        when(channels.findById(channelId)).thenReturn(Optional.of(channelWithCode("GMARKET")));

        ChannelReplyAdapterRegistry registry = new ChannelReplyAdapterRegistry(channels, List.of());

        assertThat(registry.resolve(channelId)).isEmpty();
    }
}
