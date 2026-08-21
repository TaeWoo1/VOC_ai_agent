package com.sellerops.ingest;

import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.product.Product;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Attach already-promoted Cafe24 reviews to the products their own articles name.
 *
 * <p><b>This is a consistency repair, not a new mapping policy.</b> Cafe24's board article carries
 * {@code product_no}; {@code Cafe24InquiryArticleMapper} has always used that value AS the SKU, so the
 * inquiry path creates products keyed by it. The review path discarded the same key
 * ({@code Cafe24ReviewPromoter} set {@code productId = null}), which meant that inside ONE org the
 * identical identifier became a product on one path and nothing on the other — and every Cafe24 review
 * counted as unattributable ({@code UNCERTAIN_PRODUCT_UNLINKED}) against products the inquiry path had
 * already created from the same number. The promoter now links at write time; this closes the rows
 * written before it did.
 *
 * <p><b>Why a backfill endpoint rather than a SQL migration.</b> The same reason the customer-memory
 * backfill is one: it must be re-runnable, its effect must be countable, and its execution must appear
 * in an audit rather than in a schema version. Re-collection cannot do it — ingest is idempotent, so a
 * re-read of an already-stored article promotes nothing.
 *
 * <p>Idempotent: a review that already carries a product is not in the work list, and a review whose
 * article carries no {@code product_no} is left null, which stays the honest answer for it.
 */
@Service
public class ReviewProductLinkBackfill {

    private static final Logger log = LoggerFactory.getLogger(ReviewProductLinkBackfill.class);

    /** {@code cafe24:b<board>:a<article>} — the promotion contract's own natural id. */
    private static final Pattern EXTERNAL_ID = Pattern.compile("^cafe24:b(\\d+):a(\\d+)$");

    static final int MAX_LIMIT = 1000;

    private final ReviewRepository reviews;
    private final Cafe24CommunityArticleRepository articles;
    private final ProductService products;

    public ReviewProductLinkBackfill(ReviewRepository reviews, Cafe24CommunityArticleRepository articles,
                                     ProductService products) {
        this.reviews = reviews;
        this.articles = articles;
        this.products = products;
    }

    /**
     * One bounded pass. Page from 0 until {@code scanned < limit}.
     *
     * <p>Paging is by page index over a stable id order, and because a linked review LEAVES the work
     * list, page 0 repeated would also converge — the page parameter is an optimisation, not a
     * correctness requirement.
     */
    @Transactional
    public LinkResult backfill(UUID orgId, int limit, int page) {
        int safeLimit = Math.min(Math.max(limit, 1), MAX_LIMIT);
        List<Review> batch = reviews.findUnlinkedCafe24Reviews(orgId,
                PageRequest.of(Math.max(page, 0), safeLimit));
        if (batch.isEmpty()) {
            return new LinkResult(0, 0, 0);
        }

        Map<Integer, List<Long>> byBoard = new HashMap<>();
        Map<UUID, long[]> address = new HashMap<>();
        for (Review review : batch) {
            Matcher m = EXTERNAL_ID.matcher(review.getExternalId() == null ? "" : review.getExternalId());
            if (!m.matches()) {
                continue;
            }
            int boardNo = Integer.parseInt(m.group(1));
            long articleNo = Long.parseLong(m.group(2));
            byBoard.computeIfAbsent(boardNo, k -> new ArrayList<>()).add(articleNo);
            address.put(review.getId(), new long[] {boardNo, articleNo});
        }

        Map<String, Long> productNoByAddress = new HashMap<>();
        for (Map.Entry<Integer, List<Long>> entry : byBoard.entrySet()) {
            for (Cafe24CommunityArticle article
                    : articles.findByOrgIdAndBoardNoAndArticleNoIn(orgId, entry.getKey(), entry.getValue())) {
                if (article.getProductNo() != null) {
                    productNoByAddress.put(entry.getKey() + ":" + article.getArticleNo(), article.getProductNo());
                }
            }
        }

        int linked = 0;
        int noProductNo = 0;
        for (Review review : batch) {
            long[] addr = address.get(review.getId());
            if (addr == null) {
                noProductNo++;
                continue;
            }
            Long productNo = productNoByAddress.get(addr[0] + ":" + addr[1]);
            if (productNo == null || productNo <= 0) {
                // The article itself names no product. Left null — that IS what is true of this review.
                noProductNo++;
                continue;
            }
            Product product = products.resolveOrCreateWithinTransaction(orgId, null, Long.toString(productNo));
            review.setProductId(product.getId());
            reviews.save(review);
            linked++;
        }
        log.info("cafe24 review-product link backfill org={} page={} scanned={} linked={} noProductNo={}",
                orgId, page, batch.size(), linked, noProductNo);
        return new LinkResult(batch.size(), linked, noProductNo);
    }

    /** {@code scanned < limit} means the work list is exhausted. */
    public record LinkResult(int scanned, int linked, int noProductNo) {
    }
}
