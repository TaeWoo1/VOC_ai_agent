package com.sellerops.config;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.channel.ChannelRepository;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.order.OrderDailySummaryRepository;
import com.sellerops.organization.OrganizationRepository;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.ReviewRepository;
import com.sellerops.selleraccount.SellerAccountRepository;
import com.sellerops.user.UserRepository;
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
        return new MockDataSeeder(enabled, seedDemoContent, organizations, users,
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

    @Test
    void demoContentOn_seedsContent() {
        seeder(true, true).run(null);

        assertThat(organizations.count()).isEqualTo(1);
        assertThat(products.count()).isGreaterThan(0);
        assertThat(reviews.count()).isGreaterThan(0);
        assertThat(inquiries.count()).isGreaterThan(0);
        assertThat(orderSummaries.count()).isGreaterThan(0);
    }

    @Test
    void masterDisabled_seedsNothing() {
        seeder(false, true).run(null);

        assertThat(organizations.count()).isZero();
        assertThat(channels.count()).isZero();
        assertThat(reviews.count()).isZero();
        assertThat(inquiries.count()).isZero();
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
}
