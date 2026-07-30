package com.sellerops.inbox;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.PiiMasker;
import com.sellerops.inbox.dto.FeedItem;
import com.sellerops.inbox.dto.InboxResponse;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

@Service
public class InboxService {

    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final ChannelRepository channels;
    private final ProductRepository products;

    public InboxService(InquiryRepository inquiries, ReviewRepository reviews,
                        ChannelRepository channels, ProductRepository products) {
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.channels = channels;
        this.products = products;
    }

    @Transactional(readOnly = true)
    public InboxResponse inbox(UUID orgId) {
        List<FeedItem> items = recentFeed(orgId, 50);
        return new InboxResponse(items, items.size());
    }

    @Transactional(readOnly = true)
    public List<FeedItem> recentFeed(UUID orgId, int limit) {
        // The inbox work queue keeps secret (비밀글) inquiries — the seller still works them.
        return recentFeed(orgId, limit, true);
    }

    /**
     * @param includeSecret when false, secret (비밀글) inquiries are omitted — used by the
     *     dashboard preview. A null {@code is_secret} (non-Cafe24 / legacy) is never secret.
     */
    @Transactional(readOnly = true)
    public List<FeedItem> recentFeed(UUID orgId, int limit, boolean includeSecret) {
        Map<UUID, String> channelNames = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getNameKo, (a, b) -> a));
        Map<UUID, String> productNames = products.findAllByOrgId(orgId).stream()
                .collect(Collectors.toMap(Product::getId, Product::getName, (a, b) -> a));

        List<FeedItem> items = new ArrayList<>();
        for (Inquiry q : inquiries.findTop50ByOrgIdOrderByReceivedAtDesc(orgId)) {
            if (!includeSecret && Boolean.TRUE.equals(q.getSecret())) {
                continue;
            }
            items.add(new FeedItem(q.getId().toString(), "INQUIRY",
                    channelNames.getOrDefault(q.getChannelId(), "기타"),
                    productNames.getOrDefault(q.getProductId(), "-"),
                    snippet(q.getBody()), null, q.getStatus(), q.getReceivedAt()));
        }
        for (Review r : reviews.findTop50ByOrgIdOrderByReceivedAtDesc(orgId)) {
            items.add(new FeedItem(r.getId().toString(), "REVIEW",
                    channelNames.getOrDefault(r.getChannelId(), "기타"),
                    productNames.getOrDefault(r.getProductId(), "-"),
                    snippet(r.getBody()), r.getRating(),
                    r.isNegative() ? "NEGATIVE" : "NORMAL", r.getReceivedAt()));
        }
        items.sort(Comparator.comparing(FeedItem::receivedAt).reversed());
        return items.size() > limit ? items.subList(0, limit) : items;
    }

    /**
     * Build the customer-facing snippet: mask obvious PII (phone/email) BEFORE
     * truncating so a token is never split. The raw body stays untouched in the DB.
     */
    private String snippet(String body) {
        if (body == null) {
            return "";
        }
        String masked = PiiMasker.maskText(body).strip();
        return masked.length() <= 60 ? masked : masked.substring(0, 60) + "…";
    }
}
