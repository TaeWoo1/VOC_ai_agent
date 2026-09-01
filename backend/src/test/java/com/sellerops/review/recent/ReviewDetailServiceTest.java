package com.sellerops.review.recent;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.common.DataOrigin;
import com.sellerops.identity.ExecutableIdentityResolver;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.recent.dto.ReviewDetailView;
import com.sellerops.reviewissue.IssueLifecycleState;
import com.sellerops.reviewissue.IssueSeverity;
import com.sellerops.reviewissue.MatchConfidence;
import com.sellerops.reviewissue.ReviewIssue;
import com.sellerops.reviewissue.ReviewIssueEvidence;
import com.sellerops.reviewissue.ReviewIssueEvidenceRepository;
import com.sellerops.reviewissue.ReviewIssueRepository;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * ONE review, read exactly — the seam the conversation's review anchor stands on (Agent Object v1).
 *
 * <p>What is asserted is mostly what the read refuses: another org's id is a 404 (indistinguishable
 * from a row that does not exist), and the issue list is THIS review's own evidence links rather than
 * the product's or the org's. The body is the redacted full text, because the question this read
 * answers is what the customer wrote.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ReviewDetailServiceTest {

    private static final LocalDate TODAY = LocalDate.of(2026, 9, 1);

    @Autowired ReviewRepository reviews;
    @Autowired ProductRepository products;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired ReviewIssueRepository issues;
    @Autowired ReviewIssueEvidenceRepository issueEvidence;

    private final UUID org = UUID.randomUUID();
    private final UUID otherOrg = UUID.randomUUID();
    private ReviewDetailService service;
    private Channel coupang;

    @BeforeEach
    void setUp() {
        service = new ReviewDetailService(reviews, products, channels, accounts, issueEvidence, issues,
                ExecutableIdentityResolver.unresolved());
        coupang = channel("COUPANG");
        account(coupang);
    }

    @Test
    @DisplayName("the review's own facts, the full redacted body, and the product it is about")
    void detail() {
        Product product = product("논슬립 주방 매트");
        Review review = review(coupang, "포장이 찢어진 채로 왔습니다. 연락처는 010-1234-5678 입니다.", 1, TODAY, product);

        ReviewDetailView view = service.detail(org, review.getId());

        assertThat(view.id()).isEqualTo(review.getId());
        assertThat(view.channelCode()).isEqualTo("COUPANG");
        assertThat(view.rating()).isEqualTo(1);
        assertThat(view.negative()).isTrue();
        assertThat(view.writtenOn()).isEqualTo(TODAY);
        assertThat(view.productName()).isEqualTo("논슬립 주방 매트");
        assertThat(view.triageTier()).isEqualTo("NEEDS_ATTENTION");
        // The whole sentence survives; only the volatile span is tokenized, and the flag says so.
        assertThat(view.body()).contains("포장이 찢어진 채로 왔습니다");
        assertThat(view.body()).doesNotContain("010-1234-5678");
        assertThat(view.bodyRedacted()).isTrue();
        assertThat(view.executableIdentity()).isEqualTo("NONE");
        assertThat(view.issues()).isEmpty();
    }

    @Test
    @DisplayName("the issues are THIS review's evidence links — never the product's or the org's")
    void issuesAreThisReviews() {
        Review mine = review(coupang, "포장이 찢어져 있었습니다", 1, TODAY, null);
        Review other = review(coupang, "배송이 느립니다", 2, TODAY, null);
        ReviewIssue packaging = issue("포장 파손", IssueSeverity.HIGH);
        ReviewIssue shipping = issue("배송 지연", IssueSeverity.NORMAL);
        evidence(packaging, mine, 0);
        // A second opinion unit on the same problem is that problem ONCE.
        evidence(packaging, mine, 1);
        evidence(shipping, other, 0);

        ReviewDetailView view = service.detail(org, mine.getId());

        assertThat(view.issues()).extracting(ReviewDetailView.ReviewIssueRefView::title).containsExactly("포장 파손");
        assertThat(view.issues().get(0).severity()).isEqualTo("HIGH");
        assertThat(view.issues().get(0).occurredOn()).isEqualTo(TODAY);
    }

    @Test
    @DisplayName("another org's review is a 404 — not a row with fields hidden")
    void crossOrgIsNotFound() {
        Review theirs = new Review();
        theirs.setOrgId(otherOrg);
        theirs.setChannelId(coupang.getId());
        theirs.setBody("남의 조직 리뷰");
        theirs.setRating(1);
        theirs.setNegative(true);
        theirs.setReceivedAt(TODAY.atStartOfDay(ZoneOffset.UTC).toInstant());
        theirs.setContentHash(UUID.randomUUID().toString());
        theirs.setDedupKeyVersion(2);
        theirs.setReplyState(ReviewReplyState.UNKNOWN);
        theirs.setCreatedAt(Instant.now());
        theirs.setDataOrigin(DataOrigin.REAL);
        Review saved = reviews.save(theirs);

        assertThatThrownBy(() -> service.detail(org, saved.getId())).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> service.detail(org, UUID.randomUUID())).isInstanceOf(ApiException.class);
    }

    // ---------------------------------------------------------------- fixtures

    private Channel channel(String code) {
        Channel ch = new Channel();
        ch.setCode(code);
        ch.setNameKo(code + "몰");
        ch.setStatus(ChannelStatus.AVAILABLE);
        ch.setSupportsInquiry(true);
        ch.setSupportsReview(true);
        ch.setSupportsOrder(true);
        ch.setSupportsSales(true);
        ch.setSupportsProduct(true);
        ch.setSortOrder(0);
        return channels.save(ch);
    }

    private void account(Channel ch) {
        SellerAccount acc = new SellerAccount();
        acc.setOrgId(org);
        acc.setChannelId(ch.getId());
        acc.setConnectionStatus(ChannelStatus.CONNECTED);
        acc.setFileUpload(false);
        accounts.save(acc);
    }

    private Product product(String name) {
        Product p = new Product();
        p.setOrgId(org);
        p.setName(name);
        p.setSku(UUID.randomUUID().toString().substring(0, 8));
        p.setStatus("ACTIVE");
        return products.save(p);
    }

    private Review review(Channel ch, String body, int rating, LocalDate on, Product product) {
        Review r = new Review();
        r.setOrgId(org);
        r.setChannelId(ch.getId());
        r.setProductId(product == null ? null : product.getId());
        r.setBody(body);
        r.setRating(rating);
        r.setNegative(rating <= 2);
        r.setReceivedAt(on.atStartOfDay(ZoneOffset.UTC).toInstant());
        r.setContentHash(UUID.randomUUID().toString());
        r.setDedupKeyVersion(2);
        r.setReplyState(ReviewReplyState.UNKNOWN);
        r.setMediaCount(0);
        r.setCreatedAt(Instant.now());
        r.setDataOrigin(DataOrigin.REAL);
        return reviews.save(r);
    }

    private ReviewIssue issue(String title, IssueSeverity severity) {
        ReviewIssue issue = new ReviewIssue();
        issue.setOrgId(org);
        issue.setSignatureKey(UUID.randomUUID().toString());
        issue.setTitle(title);
        issue.setAspect("PACKAGING");
        issue.setProblem(title);
        issue.setSeverity(severity);
        issue.setLifecycleState(IssueLifecycleState.OBSERVING);
        issue.setExtractorKind("RULE");
        issue.setExtractorVersion("v1");
        issue.setFirstEvidenceOn(TODAY);
        issue.setLastEvidenceOn(TODAY);
        return issues.save(issue);
    }

    private void evidence(ReviewIssue issue, Review review, int ordinal) {
        ReviewIssueEvidence row = new ReviewIssueEvidence();
        row.setOrgId(org);
        row.setIssueId(issue.getId());
        row.setReviewId(review.getId());
        row.setUnitOrdinal(ordinal);
        row.setProductId(review.getProductId());
        row.setOccurredOn(TODAY);
        row.setMatchConfidence(MatchConfidence.EXACT_SIGNATURE);
        issueEvidence.save(row);
    }
}
