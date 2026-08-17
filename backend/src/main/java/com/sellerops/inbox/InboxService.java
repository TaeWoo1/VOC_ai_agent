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
import org.springframework.data.domain.PageRequest;
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

    /** The feed's default and ceiling. The ceiling keeps one read bounded; the count beside it is not capped. */
    public static final int DEFAULT_LIMIT = 50;
    public static final int MAX_LIMIT = 500;

    @Transactional(readOnly = true)
    public InboxResponse inbox(UUID orgId) {
        return inbox(orgId, null, DEFAULT_LIMIT);
    }

    /**
     * @param type {@code INQUIRY} or {@code REVIEW} to read one kind only; null for the mixed feed
     * @param limit rows to return, clamped to [1, {@link #MAX_LIMIT}]
     */
    @Transactional(readOnly = true)
    public InboxResponse inbox(UUID orgId, String type, int limit) {
        int size = Math.max(1, Math.min(MAX_LIMIT, limit));
        List<FeedItem> items = recentFeed(orgId, size, true, type);
        // Counted, not derived from the capped rows: the number is the same however few rows a page asked for.
        long unanswered = inquiries.countByOrgIdAndStatus(orgId, "UNANSWERED");
        return new InboxResponse(items, items.size(), unanswered);
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
        return recentFeed(orgId, limit, includeSecret, null);
    }

    /**
     * @param type {@code INQUIRY} / {@code REVIEW} to read one kind only; null for both. Each kind is
     *     read newest-first up to {@code limit}, then merged and cut to {@code limit}.
     */
    @Transactional(readOnly = true)
    public List<FeedItem> recentFeed(UUID orgId, int limit, boolean includeSecret, String type) {
        boolean wantInquiries = type == null || "INQUIRY".equals(type);
        boolean wantReviews = type == null || "REVIEW".equals(type);
        var window = PageRequest.of(0, Math.max(1, limit));
        Map<UUID, String> channelNames = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Channel::getNameKo, (a, b) -> a));
        Map<UUID, String> productNames = products.findAllByOrgId(orgId).stream()
                .collect(Collectors.toMap(Product::getId, Product::getName, (a, b) -> a));

        List<FeedItem> items = new ArrayList<>();
        for (Inquiry q : wantInquiries ? inquiries.findByOrgIdOrderByReceivedAtDesc(orgId, window) : List.<Inquiry>of()) {
            if (!includeSecret && Boolean.TRUE.equals(q.getSecret())) {
                continue;
            }
            items.add(new FeedItem(q.getId().toString(), "INQUIRY",
                    q.getChannelId() == null ? null : q.getChannelId().toString(),
                    channelNames.getOrDefault(q.getChannelId(), "기타"),
                    productNames.getOrDefault(q.getProductId(), "-"),
                    snippet(q.getBody()), null, q.getStatus(), q.getReceivedAt()));
        }
        for (Review r : wantReviews ? reviews.findByOrgIdOrderByReceivedAtDesc(orgId, window) : List.<Review>of()) {
            items.add(new FeedItem(r.getId().toString(), "REVIEW",
                    r.getChannelId() == null ? null : r.getChannelId().toString(),
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
