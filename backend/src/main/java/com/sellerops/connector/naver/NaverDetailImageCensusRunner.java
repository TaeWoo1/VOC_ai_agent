package com.sellerops.connector.naver;

import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.product.detail.DetailContentShape;
import com.sellerops.product.detail.DetailImageReferences;
import com.sellerops.product.detail.image.DetailImageFetcher;
import com.sellerops.product.detail.image.FetchedImage;
import com.sellerops.product.detail.image.ImageFetchPolicy;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.EnumMap;
import java.util.HashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * <b>Stage 0 of Image Product Knowledge v1 — the census, and no model.</b>
 *
 * <p>The design that would send 상세페이지 pictures to a vision model rests on one unmeasured
 * premise: that a seller reuses the same banner across many listings, so the cost divisor is the
 * number of DISTINCT pictures rather than the number of products. That number has never been
 * observed, and the design document says plainly that if it collapses, the lane should not be
 * started. This runner is the measurement, priced at one marketplace request and some CDN traffic.
 *
 * <p><b>No model call exists in this file.</b> Not disabled, not flagged off — absent. The approval
 * that authorises this run authorises READ and nothing else, and the next stage needs its own.
 *
 * <p><b>What leaves: counts.</b> Not one image URL, not one byte of image content, not one character
 * of the seller's page. Identity is reported as the NUMBER of distinct SHA-256 hashes, because the
 * question is "how many different pictures are there", and the hashes themselves answer a question
 * nobody asked. Sizes and dimensions are aggregates.
 *
 * <p><b>Triple-gated and inert by default</b>, exactly like the shape probe beside it: the bean
 * exists only when the NAVER connector is on AND this diagnostic's own flag is set, and even then it
 * does nothing without an account id and a listing number.
 */
public class NaverDetailImageCensusRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(NaverDetailImageCensusRunner.class);
    private static final String TAG = "[naver-detail-image-census]";

    /** The approved marketplace GET budget. One listing. */
    static final int MAX_MARKETPLACE_REQUESTS = 1;

    /** The approved CDN budget for this run. */
    static final int MAX_IMAGE_FETCHES = ImageFetchPolicy.MAX_IMAGES_PER_PRODUCT;

    private final NaverTokenClient tokenClient;
    private final NaverChannelProductClient detailClient;
    private final SellerAccountRepository accounts;
    private final CredentialVault vault;
    private final DetailImageFetcher fetcher;
    private final String accountIdProperty;
    private final long channelProductNo;

    public NaverDetailImageCensusRunner(NaverTokenClient tokenClient,
                                        NaverChannelProductClient detailClient,
                                        SellerAccountRepository accounts, CredentialVault vault,
                                        DetailImageFetcher fetcher, String accountIdProperty,
                                        long channelProductNo) {
        this.tokenClient = tokenClient;
        this.detailClient = detailClient;
        this.accounts = accounts;
        this.vault = vault;
        this.fetcher = fetcher;
        this.accountIdProperty = accountIdProperty;
        this.channelProductNo = channelProductNo;
    }

    @Override
    public void run(ApplicationArguments args) {
        if (accountIdProperty == null || accountIdProperty.isBlank() || channelProductNo <= 0) {
            log.warn("{} enabled but not configured (account-id / channel-product-no); skipping.", TAG);
            return;
        }
        try {
            execute(UUID.fromString(accountIdProperty.trim()));
        } catch (RuntimeException e) {
            log.warn("{} aborted ({}); backend continues.", TAG, e.getClass().getSimpleName());
        }
    }

    private void execute(UUID accountId) {
        Optional<SellerAccount> account = accounts.findById(accountId);
        if (account.isEmpty()) {
            log.warn("{} ACCOUNT_NOT_FOUND; nothing called.", TAG);
            return;
        }
        String clientId;
        String clientSecret;
        try {
            DecryptedCredential credential = vault.open(account.get().getOrgId(), accountId);
            clientId = credential.secrets().get("client_id");
            clientSecret = credential.secrets().get("client_secret");
        } catch (RuntimeException e) {
            log.warn("{} VAULT_FAILED ({}); zero requests made.", TAG, e.getClass().getSimpleName());
            return;
        }
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank()) {
            log.warn("{} CREDENTIAL_INCOMPLETE; zero requests made.", TAG);
            return;
        }
        String accessToken;
        try {
            accessToken = tokenClient.accessToken(clientId, clientSecret);
        } catch (RuntimeException e) {
            log.warn("{} TOKEN_FAILED ({}): {}; zero requests made.", TAG,
                    e.getClass().getSimpleName(), e.getMessage());
            return;
        }

        log.info("{} start channel_product_no={} marketplace_budget={} image_budget={}",
                TAG, channelProductNo, MAX_MARKETPLACE_REQUESTS, MAX_IMAGE_FETCHES);
        NaverProductDetail detail;
        try {
            detail = detailClient.fetch(accessToken, channelProductNo);
        } catch (RuntimeException e) {
            log.warn("{} outcome={} marketplace_requests=1 image_requests=0",
                    TAG, e.getClass().getSimpleName());
            return;
        }
        if (detail == null) {
            log.info("{} outcome=NOT_FOUND marketplace_requests=1 image_requests=0", TAG);
            return;
        }

        DetailContentShape.Measurement measurement =
                DetailContentShape.classify(detail.detailContent());
        DetailImageReferences.References refs =
                DetailImageReferences.extract(detail.detailContent());
        // The listing gallery is counted so the two sets can be seen NOT to be the same set — it is
        // never fetched and never a grounding source.
        int gallery = detail.imageUrls() == null ? 0 : detail.imageUrls().size();
        log.info("{} {} listing_gallery={} {}", TAG, DetailContentShape.describe(measurement),
                gallery, refs.describe());

        List<FetchedImage> fetched = fetcher.fetchAll(refs.urls(), MAX_IMAGE_FETCHES);
        report(fetched, refs);
    }

    /** Counts, ratios and aggregates. Nothing here can reconstruct a picture or name one. */
    private void report(List<FetchedImage> fetched, DetailImageReferences.References refs) {
        Map<FetchedImage.Outcome, Integer> outcomes = new EnumMap<>(FetchedImage.Outcome.class);
        Set<String> unique = new LinkedHashSet<>();
        Map<String, Integer> perHash = new HashMap<>();
        Map<String, Integer> perSize = new HashMap<>();
        long totalBytes = 0;
        int okCount = 0;
        int withDimensions = 0;
        int minBytes = Integer.MAX_VALUE;
        int maxBytes = 0;

        for (FetchedImage image : fetched) {
            outcomes.merge(image.outcome(), 1, Integer::sum);
            if (!image.ok()) {
                continue;
            }
            okCount++;
            totalBytes += image.byteSize();
            minBytes = Math.min(minBytes, image.byteSize());
            maxBytes = Math.max(maxBytes, image.byteSize());
            unique.add(image.sha256());
            perHash.merge(image.sha256(), 1, Integer::sum);
            if (image.hasDimensions()) {
                withDimensions++;
                perSize.merge(image.width() + "x" + image.height(), 1, Integer::sum);
            }
        }
        int duplicates = okCount - unique.size();
        int mostRepeated = perHash.values().stream().mapToInt(Integer::intValue).max().orElse(0);

        log.info("{} CENSUS marketplace_requests=1 image_requests={} fetched_ok={} unique_sha256={} "
                        + "duplicate_fetches={} most_repeated_hash={} reuse_ratio={}",
                TAG, fetched.size(), okCount, unique.size(), duplicates, mostRepeated,
                okCount == 0 ? "n/a" : String.format(java.util.Locale.ROOT, "%.2f",
                        unique.size() / (double) okCount));
        log.info("{} BYTES total={} min={} max={} mean={}", TAG, totalBytes,
                okCount == 0 ? 0 : minBytes, maxBytes,
                okCount == 0 ? 0 : totalBytes / okCount);
        log.info("{} DIMENSIONS readable={} of {} distinct_sizes={} most_common={}", TAG,
                withDimensions, okCount, perSize.size(),
                perSize.entrySet().stream()
                        .max(Map.Entry.comparingByValue())
                        .map(e -> e.getKey() + "×" + e.getValue())
                        .orElse("n/a"));
        log.info("{} OUTCOMES {}", TAG, outcomes);
        log.info("{} VERDICT img_tags={} fetchable={} unfetched_over_budget={} model_calls=0 "
                        + "db_writes=0 marketplace_writes=0",
                TAG, refs.imgTags(), refs.fetchable(),
                outcomes.getOrDefault(FetchedImage.Outcome.BUDGET_EXHAUSTED, 0));
    }
}
