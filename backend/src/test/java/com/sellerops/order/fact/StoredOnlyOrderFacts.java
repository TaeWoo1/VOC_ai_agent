package com.sellerops.order.fact;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.draft.InquiryOrderFactReader;
import com.sellerops.order.ChannelOrderRepository;
import java.time.Clock;
import java.util.List;

/**
 * An {@link InquiryOrderFactReader} that can only read the store — the shape every test that is not
 * about exact lookup wants.
 *
 * <p><b>It is wired with NO exact readers on purpose.</b> A test that accidentally reached a channel
 * would be a test that makes network calls, and the way to make that impossible is to hand it a
 * registry that has nothing to reach with. The tests that DO exercise the exact path construct their
 * reader explicitly, with a stub, so the network is always something a test opted into by name.
 */
public final class StoredOnlyOrderFacts {

    private StoredOnlyOrderFacts() {
    }

    public static InquiryOrderFactReader reader(ChannelOrderRepository orders,
                                                ChannelRepository channels,
                                                OrderStoreFreshness freshness) {
        return new InquiryOrderFactReader(orders, channels, freshness,
                new ExactOrderReaders(List.of()), new OrderFactCache(Clock.systemUTC()),
                new ExactOrderReadAudit());
    }
}
