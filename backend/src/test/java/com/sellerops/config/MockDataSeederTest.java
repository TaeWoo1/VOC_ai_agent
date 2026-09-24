package com.sellerops.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.common.DataOrigin;
import com.sellerops.common.SyntheticDataVisibility;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.user.UserRepository;
import java.util.stream.Collectors;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.security.crypto.bcrypt.BCryptPasswordEncoder;
import org.springframework.security.crypto.password.PasswordEncoder;
import org.springframework.test.context.ActiveProfiles;

@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class MockDataSeederTest {

    @Autowired OrganizationRepository organizations;
    @Autowired UserRepository users;
    @Autowired ChannelRepository channels;
    @Autowired SellerAccountRepository sellerAccounts;
    @Autowired ProductRepository products;
    @Autowired InquiryRepository inquiries;
    @Autowired ReviewRepository reviews;
    @Autowired OrderDailySummaryRepository orderSummaries;

    private final PasswordEncoder passwordEncoder = new BCryptPasswordEncoder();

    private MockDataSeeder seeder(boolean enabled, boolean seedDemoContent) {
        return seeder(enabled, true, seedDemoContent);
    }

    private MockDataSeeder seeder(boolean enabled, boolean catalogue, boolean seedDemoContent) {
        return new MockDataSeeder(enabled, catalogue, seedDemoContent, organizations, users,
                channels, sellerAccounts, products, inquiries, reviews,
                orderSummaries, passwordEncoder);
    }

    @Test
    void demoContentOff_seedsBaselineOnly() {
        seeder(true, false).run(null);

        // Baseline still seeds so the dev app is usable.
        assertThat(organizations.count()).isEqualTo(1);
        assertThat(users.count()).isGreaterThan(0);
        assertThat(channels.count()).isGreaterThan(0);
        assertThat(sellerAccounts.count()).isGreaterThan(0);

        // ...but no fake customer-facing content.
        assertThat(products.count()).isZero();
        assertThat(reviews.count()).isZero();
        assertThat(inquiries.count()).isZero();
        assertThat(orderSummaries.count()).isZero();
    }

    /**
     * A demo deployment both writes synthetic content and shows it — one flag decides both, because
     * a deployment that seeds demo data and then hides it is a configuration that means nothing.
     *
     * <p>The override is needed only here: this test builds the seeder by hand rather than from
     * configuration, so the two halves of that single flag have to be set separately. In a running
     * app both read {@code sellerops.seed.demo-content} and cannot disagree.
     */
    @Test
    void demoContentOn_seedsContentAndShowsIt() {
        SyntheticDataVisibility.overrideForTest(true);
        try {
            seeder(true, true).run(null);

            assertThat(organizations.count()).isEqualTo(1);
            assertThat(products.count()).isGreaterThan(0);
            assertThat(reviews.count()).isGreaterThan(0);
            assertThat(inquiries.count()).isGreaterThan(0);
            assertThat(orderSummaries.count()).isGreaterThan(0);
        } finally {
            SyntheticDataVisibility.overrideForTest(false);
        }
    }

    /**
     * The other half, and the one that matters for the canonical demo org: seeded rows are written
     * and then simply not part of what an ordinary read returns. They are still there — this is a
     * projection, not a delete — which {@code findById} and the audit surfaces rely on.
     */
    @Test
    void seededContentIsInvisibleToOrdinaryReadsWhenSyntheticIsHidden() {
        SyntheticDataVisibility.overrideForTest(true);
        try {
            seeder(true, true).run(null);
        } finally {
            SyntheticDataVisibility.overrideForTest(false);
        }

        assertThat(reviews.count()).isZero();
        assertThat(inquiries.count()).isZero();
        assertThat(orderSummaries.count()).isZero();
        // Still on disk, and still reachable when a deployment asks for them.
        SyntheticDataVisibility.overrideForTest(true);
        try {
            assertThat(reviews.count()).isGreaterThan(0);
        } finally {
            SyntheticDataVisibility.overrideForTest(false);
        }
    }

    /**
     * <b>A — the pilot default creates no account anybody can log into</b> (Pilot Runtime Foundation
     * v1 §15-A). The fixture user's password is written down in this repository, so a deployment
     * that did not ask for the fixture must not have it. The channel catalogue is the exception and
     * it is not a fixture: it is product reference data, and without it 채널 연결 has nothing to
     * offer.
     */
    @Test
    void fixtureDisabled_seedsTheChannelCatalogueAndNoAccount() {
        seeder(false, true).run(null);

        assertThat(organizations.count()).isZero();
        assertThat(users.count()).isZero();
        assertThat(sellerAccounts.count()).isZero();
        assertThat(reviews.count()).isZero();
        assertThat(inquiries.count()).isZero();

        // Product reference data, not a fixture.
        assertThat(channels.count()).isGreaterThan(0);
    }

    /** The catalogue has its own switch, so a deployment that owns the table can say so. */
    @Test
    void catalogueCanBeSuppressedIndependently() {
        seeder(false, false, false).run(null);
        assertThat(channels.count()).isZero();
    }

    /** The catalogue is written once: a second boot must not produce a second copy. */
    @Test
    void catalogueIsIdempotentAcrossBoots() {
        seeder(false, false).run(null);
        long first = channels.count();
        seeder(false, false).run(null);
        assertThat(channels.count()).isEqualTo(first);
    }

    /**
     * <b>B — the fixture still works, unchanged</b> (§15-B). The demo deployment attaches its
     * accounts to the catalogue rows that already exist rather than seeding a second catalogue.
     */
    @Test
    void fixtureEnabledAfterCatalogueExists_reusesTheCatalogue() {
        seeder(false, false).run(null);
        long catalogue = channels.count();

        seeder(true, false).run(null);

        assertThat(channels.count()).isEqualTo(catalogue);
        assertThat(organizations.count()).isEqualTo(1);
        assertThat(users.count()).isGreaterThan(0);
        assertThat(sellerAccounts.count()).isGreaterThan(0);
    }

    @Test
    void idempotent_doesNotReseed() {
        seeder(true, true).run(null);
        long reviewsAfterFirst = reviews.count();
        long inquiriesAfterFirst = inquiries.count();

        // Org now exists → the early-return blocks any re-seed.
        seeder(true, true).run(null);

        assertThat(organizations.count()).isEqualTo(1);
        assertThat(reviews.count()).isEqualTo(reviewsAfterFirst);
        assertThat(inquiries.count()).isEqualTo(inquiriesAfterFirst);
    }

    /**
     * <b>Every authored sentence reaches the screen.</b> The fixture's job is to make the product
     * legible, and a lane whose rows all read the same sentence does the opposite — a negative-review
     * list of eleven identical lines says «manufactured» louder than any label. The defect was an
     * index that shared its arithmetic with the lane selector, so this asserts the property the
     * arithmetic has to keep: <b>each array is covered</b>, on both lanes.
     *
     * <p>It is written as coverage of the seeded bodies rather than as an expected count per
     * sentence, because the distribution is a consequence of 44 rows and two array lengths and
     * would have to be rewritten every time a sentence is added. What may never regress is that an
     * authored sentence is unreachable.
     */
    @Test
    void demoReviews_useEveryAuthoredSentenceOnBothLanes() {
        SyntheticDataVisibility.overrideForTest(true);
        try {
            seeder(true, true).run(null);

            var all = reviews.findAll();
            assertThat(all).hasSize(44);
            assertThat(all).allMatch(r -> r.getDataOrigin() == DataOrigin.DEMO_SEED);

            var negativeBodies = all.stream().filter(Review::isNegative)
                    .map(Review::getBody).collect(Collectors.toSet());
            var positiveBodies = all.stream().filter(r -> !r.isNegative())
                    .map(Review::getBody).collect(Collectors.toSet());

            // Four authored sentences per lane; the seeder must reach all of them.
            assertThat(negativeBodies).hasSize(4);
            assertThat(positiveBodies).hasSize(4);
            // …and the two lanes never borrow each other's sentences.
            assertThat(negativeBodies).doesNotContainAnyElementsOf(positiveBodies);
        } finally {
            SyntheticDataVisibility.overrideForTest(false);
        }
    }

    /**
     * The shape of the fixture is what the demo walkthrough is built on, so the body fix must not
     * move it: same row count, same negative share, same ratings. Recorded as the exact distribution
     * because that is the thing a future edit could change without noticing.
     *
     * <p><b>Rating 2 is unreachable and stays that way here.</b> {@code neg} is true only when
     * {@code i % 4 == 0}, which is always even, so the {@code i % 2 == 0 ? 1 : 2} branch can only
     * ever yield 1. That is the same collision the bodies had — but changing it would move the
     * rating distribution this test exists to pin, so it is named rather than fixed.
     */
    @Test
    void demoReviews_keepTheirRowCountAndRatingDistribution() {
        SyntheticDataVisibility.overrideForTest(true);
        try {
            seeder(true, true).run(null);

            var byRating = reviews.findAll().stream()
                    .collect(Collectors.groupingBy(Review::getRating, Collectors.counting()));

            assertThat(byRating).containsOnlyKeys(1, 4, 5);
            assertThat(byRating.get(1)).isEqualTo(11);
            assertThat(byRating.get(4)).isEqualTo(22);
            assertThat(byRating.get(5)).isEqualTo(11);
            assertThat(reviews.findAll().stream().filter(Review::isNegative)).hasSize(11);
        } finally {
            SyntheticDataVisibility.overrideForTest(false);
        }
    }
}
