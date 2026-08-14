package com.sellerops.review.channel;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.ReviewBodyFingerprint;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import com.sellerops.review.channel.dto.AgentReviewLocateTargetView;
import com.sellerops.review.channel.dto.ChannelReviewLocateRunResponse;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.security.SecureRandom;
import java.time.Duration;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.HexFormat;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * {@code [쿠팡에서 보기]} — the two halves of showing a seller one of their own stored reviews on Coupang's
 * screen, with nothing that identifies it passing through the browser.
 *
 * <p><b>Mint</b> ({@link #mint}) runs for the seller: it re-derives the locate target from the stored
 * review, refuses if that target could not find anything, and returns an opaque single-use token.
 * <b>Resolve</b> ({@link #resolve}) runs for the Local Agent under its own JWT: it spends the token once
 * and hands back the target.
 *
 * <p><b>Why the refusal at mint matters.</b> A review with no 노출상품ID, no 별점, or no 등록일 produces a
 * target that matches nothing on any page. Minting it anyway would give the seller a run that opens their
 * browser, reads their screen, and reports "이 페이지에는 없습니다" — a message that says the review is
 * elsewhere when the truth is that SellerOps never had enough to look with. The check is here, before a
 * window opens, so the honest answer arrives on the button press.
 *
 * <p><b>COUPANG only, and stated rather than assumed.</b> The run drives a WING 상품평 list; the reader,
 * the header roles and the pager all belong to that screen. Another channel's review would mint a token
 * for a run that has no screen to read, so it is refused by code — not left to the frontend to remember
 * which button to render.
 */
@Service
public class ChannelReviewLocateService {

    /** The only channel with a locate surface. See the class note. */
    static final String COUPANG = "COUPANG";

    /**
     * How long a press stays good for. The agent resolves within seconds of {@code START_RUN}; the window
     * is minutes only so that a seller who pairs the agent AFTER pressing is not told to press again.
     */
    static final Duration REF_TTL = Duration.ofMinutes(10);

    private static final SecureRandom RANDOM = new SecureRandom();

    private final ReviewRepository reviews;
    private final ProductRepository products;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;
    private final ChannelReviewLocateRefRepository refs;

    public ChannelReviewLocateService(ReviewRepository reviews, ProductRepository products,
                                      SellerAccountRepository accounts, ChannelRepository channels,
                                      ChannelReviewLocateRefRepository refs) {
        this.reviews = reviews;
        this.products = products;
        this.accounts = accounts;
        this.channels = channels;
        this.refs = refs;
    }

    /**
     * Mint a fresh, single-use {@code locateRef} for one stored review.
     *
     * <p>Each press mints a new one; nothing is reused. A ref is cheap and a stale ref that could be
     * replayed is not — see {@link ChannelReviewLocateRef}.
     */
    @Transactional
    public ChannelReviewLocateRunResponse mint(UUID orgId, UUID accountId, UUID reviewId, UUID userId) {
        SellerAccount account = accounts.findById(accountId)
                .filter(a -> orgId.equals(a.getOrgId()))
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
        Channel channel = channels.findById(account.getChannelId())
                .orElseThrow(() -> ApiException.notFound("채널을 찾을 수 없습니다."));
        if (!COUPANG.equals(channel.getCode())) {
            throw ApiException.badRequest("이 채널에는 상품평을 화면에서 찾아주는 기능이 아직 없습니다.");
        }
        Review review = reviews.findByIdAndOrgId(reviewId, orgId)
                .filter(r -> account.getChannelId().equals(r.getChannelId()))
                .orElseThrow(() -> ApiException.notFound("상품평을 찾을 수 없습니다."));

        // Derived here so the refusal below is about THIS review's target, not about a run that will fail
        // ten seconds later in the seller's own browser.
        AgentReviewLocateTargetView target = targetOf(review);
        if (target.productId() == null || target.rating() == null || target.writtenOn() == null) {
            throw ApiException.conflict(
                    "이 상품평에는 쿠팡 화면에서 찾는 데 필요한 정보(상품·별점·등록일)가 부족해 찾아드릴 수 없습니다.");
        }

        ChannelReviewLocateRef row = new ChannelReviewLocateRef();
        row.setOrgId(orgId);
        row.setReviewId(reviewId);
        row.setLocateRef(newLocateRef());
        row.setCreatedBy("SELLER:" + userId);
        Instant now = Instant.now();
        row.setCreatedAt(now);
        row.setExpiresAt(now.plus(REF_TTL));
        return new ChannelReviewLocateRunResponse(refs.save(row).getLocateRef(), COUPANG);
    }

    /**
     * Spend a {@code locateRef} and return what the agent has to match on.
     *
     * <p>Every refusal is a 404 with one message, deliberately. "Unknown token", "another tenant's token",
     * "already used" and "expired" are four different facts, and a caller holding a guessed token learns
     * which one it is from four different answers. The agent has one repair for all of them — the seller
     * presses the button again — so one answer is also the useful one.
     */
    @Transactional
    public AgentReviewLocateTargetView resolve(UUID orgId, String locateRef) {
        String ref = locateRef == null ? "" : locateRef.strip();
        if (!ref.matches("[0-9a-f]{16}")) {
            throw ApiException.badRequest("locateRef 형식이 올바르지 않습니다.");
        }
        Instant now = Instant.now();
        ChannelReviewLocateRef row = refs.findByLocateRef(ref)
                .filter(r -> orgId.equals(r.getOrgId()))
                .filter(r -> r.getConsumedAt() == null)
                .filter(r -> r.getExpiresAt().isAfter(now))
                .orElseThrow(() -> ApiException.notFound("만료되었거나 이미 사용된 요청입니다."));
        row.setConsumedAt(now);
        refs.save(row);

        Review review = reviews.findByIdAndOrgId(row.getReviewId(), orgId)
                .orElseThrow(() -> ApiException.notFound("상품평을 찾을 수 없습니다."));
        return targetOf(review);
    }

    /**
     * Exactly the fields {@code review-locate.ts} compares — and the buyer is not among them, because no
     * column holds one. The fingerprint is computed from the STORED body so both sides apply one rule.
     */
    private AgentReviewLocateTargetView targetOf(Review review) {
        Product product = review.getProductId() == null ? null
                : products.findAllByOrgIdAndIdIn(review.getOrgId(), List.of(review.getProductId()))
                        .stream().findFirst().orElse(null);
        return new AgentReviewLocateTargetView(
                COUPANG,
                product == null ? null : product.getSku(),
                review.getSourceOptionId(),
                writtenOn(review),
                review.getRating(),
                ReviewBodyFingerprint.of(review.getBody()));
    }

    /** Stored as UTC start-of-day for the calendar date the channel printed, so this reads it back unshifted. */
    private LocalDate writtenOn(Review review) {
        return review.getReceivedAt() == null ? null : review.getReceivedAt().atZone(ZoneOffset.UTC).toLocalDate();
    }

    private String newLocateRef() {
        byte[] bytes = new byte[8];
        RANDOM.nextBytes(bytes);
        return HexFormat.of().formatHex(bytes);
    }
}
