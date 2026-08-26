package com.sellerops.inbox;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.MarkupText;
import com.sellerops.common.PiiMasker;
import com.sellerops.inbox.dto.FeedItem;
import com.sellerops.inbox.dto.InboxResponse;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.product.OperatorProductName;
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

    /**
     * What a row says when no canonical product is known.
     *
     * <p>It used to be "-", which reads as a missing value in a table of present ones. Most Cafe24
     * board inquiries genuinely carry no product number, so this is the ordinary case rather than an
     * error, and naming it plainly is what lets a seller skip past it instead of wondering.
     */
    static final String UNATTRIBUTED_LABEL = "상품 미지정";

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
        // Counted, not derived from the capped rows: the number is the same however few rows a page
        // asked for. Seller-dismissed inquiries are not counted — the repository carries that predicate
        // (see InquiryRepository.ACTIVE), so this is the same corpus 홈 and the report count.
        //
        // The operational count, which is REAL only: a number that says the seller owes work must not
        // include rows the product manufactured about itself. 홈 reads the same method, so the two
        // screens state one number (Agent Command Center v1 §1-A).
        long unanswered = inquiries.countUnansweredOperational(orgId);
        return new InboxResponse(items, items.size(), unanswered);
    }

    @Transactional(readOnly = true)
    public List<FeedItem> recentFeed(UUID orgId, int limit) {
        // The inbox work queue keeps secret (비밀글) inquiries — the seller still works them. It does
        // NOT keep dismissed ones: those are work the seller decided not to do, and the feed is a list
        // of work. The exclusion lives in the repository read, not here.
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
        // displayNameOrNull, not getName: ingest's shared "(미지정 상품)" bucket is not a product, and a
        // row that printed its name would tell the seller this inquiry is about a product by that name.
        // Nulls are dropped here and become UNATTRIBUTED_LABEL below.
        Map<UUID, String> productNames = new java.util.HashMap<>();
        for (Product p : products.findAllByOrgId(orgId)) {
            String display = OperatorProductName.displayNameOrNull(p);
            if (display != null) {
                productNames.putIfAbsent(p.getId(), display);
            }
        }

        List<FeedItem> items = new ArrayList<>();
        for (Inquiry q : wantInquiries ? inquiries.findByOrgIdOrderByReceivedAtDesc(orgId, window) : List.<Inquiry>of()) {
            if (!includeSecret && Boolean.TRUE.equals(q.getSecret())) {
                continue;
            }
            items.add(new FeedItem(q.getId().toString(), "INQUIRY",
                    q.getChannelId() == null ? null : q.getChannelId().toString(),
                    channelNames.getOrDefault(q.getChannelId(), "기타"),
                    productNames.getOrDefault(q.getProductId(), UNATTRIBUTED_LABEL),
                    snippet(q.getBody()), null, q.getStatus(), q.getReceivedAt()));
        }
        for (Review r : wantReviews ? reviews.findByOrgIdOrderByReceivedAtDesc(orgId, window) : List.<Review>of()) {
            items.add(new FeedItem(r.getId().toString(), "REVIEW",
                    r.getChannelId() == null ? null : r.getChannelId().toString(),
                    channelNames.getOrDefault(r.getChannelId(), "기타"),
                    productNames.getOrDefault(r.getProductId(), UNATTRIBUTED_LABEL),
                    snippet(r.getBody()), r.getRating(),
                    r.isNegative() ? "NEGATIVE" : "NORMAL", r.getReceivedAt()));
        }
        items.sort(Comparator.comparing(FeedItem::receivedAt).reversed());
        return items.size() > limit ? items.subList(0, limit) : items;
    }

    /** How much of a body the feed shows. */
    static final int SNIPPET_LENGTH = 60;

    /**
     * How much of a body is masked before it is cut. Wide enough that any phone/email token that
     * BEGINS inside the snippet is fully inside the window (an email or a spaced phone number is
     * well under 140 characters), so masking-then-cutting still never splits a token — while a
     * body that runs to thousands of characters (a board post, a spam article) no longer costs
     * three regex passes over all of it for a 60-character preview. Reading 500 rows used to take
     * seconds for exactly that reason (product assembly A7).
     */
    static final int MASK_WINDOW = 200;

    /**
     * Build the customer-facing snippet: reduce markup to the text a person wrote, then mask obvious
     * PII (phone/email) BEFORE truncating so a token is never split. The raw body stays untouched in
     * the DB.
     *
     * <p><b>Order matters, and it was wrong.</b> The window used to be taken off the raw body, so a
     * Cafe24 board post whose first 200 characters are {@code <table border="1" style='width:
     * 1240px…} produced a preview of exactly that — markup, cut mid-attribute. {@link
     * MarkupText#toSingleLine} now runs first, over its own bounded scan, so the 200-character mask
     * window and the 60-character preview are both spent on words.
     *
     * <p><b>Public because there is exactly one right answer here and it should not be written
     * twice.</b> The proactive surface shows the same kind of preview of the same rows; a second
     * implementation would be a second masking rule, and the one that drifted would be the one
     * nobody noticed until a phone number was on a screen.
     */
    public static String snippet(String body) {
        if (body == null) {
            return "";
        }
        String text = MarkupText.toSingleLine(body);
        boolean windowed = text.length() > MASK_WINDOW;
        String head = windowed ? text.substring(0, MASK_WINDOW) : text;
        String masked = PiiMasker.maskText(head).strip();
        if (!windowed && masked.length() <= SNIPPET_LENGTH) {
            return masked;
        }
        String cut = masked.length() <= SNIPPET_LENGTH ? masked : masked.substring(0, SNIPPET_LENGTH);
        return cut + "…";
    }
}
