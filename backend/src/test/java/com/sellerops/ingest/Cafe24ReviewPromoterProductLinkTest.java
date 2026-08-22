package com.sellerops.ingest;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.product.ProductService;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * What a promoted Cafe24 review is allowed to do with a {@code product_no} it does not recognise.
 *
 * <p>The answer used to be "create a product". Promoting the canonical demo org's 133 real board-4
 * articles manufactured 24 rows whose name and sku were both a bare Cafe24 number — "24", "181", "27".
 * Those are not catalogue entries; they are the absence of one wearing a product's shape, and they
 * propagate: Product Knowledge counts them as things the seller sells, and an Agent reports "상품
 * '181'에 부정 리뷰가 3건" while telling the seller nothing.
 *
 * <p>Declining costs nothing recoverable. The article keeps its own {@code product_no}, so an
 * unresolved review relinks for free the moment a real catalogue read lands — whereas an invented row
 * would have to be found and merged afterwards.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24ReviewPromoterProductLinkTest {

    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;

    /** {@code @DataJpaTest} loads repositories, not services — build the one collaborator by hand. */
    private ProductService productService() {
        return new ProductService(products);
    }

    private final UUID org = UUID.randomUUID();
    private final UUID channel = UUID.randomUUID();

    private Cafe24ReviewPromoter promoter() {
        return new Cafe24ReviewPromoter(reviews, productService());
    }

    private Cafe24ReviewPromoter.Outcome promote(long articleNo, Long productNo) {
        return promoter().promote(org, channel, "REVIEW", 4, articleNo, "본문", 5,
                Instant.parse("2026-08-01T00:00:00Z"), productNo);
    }

    private Review stored(long articleNo) {
        return reviews.findAll().stream()
                .filter(r -> Cafe24ReviewPromoter.externalId(4, articleNo).equals(r.getExternalId()))
                .findFirst()
                .orElseThrow();
    }

    @Test
    void anUnknownProductNumberLeavesTheReviewUnresolvedAndInventsNothing() {
        long before = products.count();

        assertThat(promote(1001L, 181L)).isEqualTo(Cafe24ReviewPromoter.Outcome.PROMOTED);

        assertThat(stored(1001L).getProductId()).isNull();
        assertThat(products.count()).as("no product manufactured from a bare number").isEqualTo(before);
    }

    @Test
    void aProductNumberTheCatalogueKnowsIsLinked() {
        Product known = new Product();
        known.setOrgId(org);
        known.setName("전선몰딩 1호");
        known.setSku("181");
        known.setStatus("ACTIVE");
        products.save(known);

        assertThat(promote(1002L, 181L)).isEqualTo(Cafe24ReviewPromoter.Outcome.PROMOTED);

        // Same key, and now it means something — the linkage was never the problem, inventing was.
        assertThat(stored(1002L).getProductId()).isEqualTo(known.getId());
    }

    @Test
    void anAbsentProductNumberIsUnresolvedRatherThanAnError() {
        assertThat(promote(1003L, null)).isEqualTo(Cafe24ReviewPromoter.Outcome.PROMOTED);

        assertThat(stored(1003L).getProductId()).isNull();
    }

    /** The review still lands. Being unable to attribute it is not a reason to lose it. */
    @Test
    void anUnresolvedReviewIsStillAFirstClassReview() {
        promote(1004L, 999_999L);

        Review r = stored(1004L);
        assertThat(r.getBody()).isEqualTo("본문");
        assertThat(r.getRating()).isEqualTo(5);
        assertThat(r.getDataOrigin()).isEqualTo(com.sellerops.common.DataOrigin.REAL);
    }
}
