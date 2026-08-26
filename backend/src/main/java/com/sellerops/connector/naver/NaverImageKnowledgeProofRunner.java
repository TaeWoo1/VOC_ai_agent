package com.sellerops.connector.naver;

import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.product.ChannelProduct;
import com.sellerops.product.ChannelProductRepository;
import com.sellerops.product.detail.DetailContentShape;
import com.sellerops.product.detail.DetailImageReferences;
import com.sellerops.product.detail.ProductDetailEnrichment;
import com.sellerops.product.detail.image.ImageFactAuthority;
import com.sellerops.product.detail.image.ImageFetchPolicy;
import com.sellerops.product.detail.image.ProductDetailImageKnowledge;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * <b>Stage 1 of Image Product Knowledge v1 — the first run that calls a vision model.</b>
 *
 * <p>Stage 0 counted pictures. This one reads them, and the question it answers is not "can a model
 * do OCR" — it is whether a 규격-specific fact printed on the seller's own page can be tied to the
 * 규격 a customer actually chooses, <b>without anybody guessing</b>. A run that transcribes
 * beautifully and resolves nothing has failed.
 *
 * <p><b>The order inside one run is the whole design.</b> The listing is read once; its OPTIONS are
 * persisted first (a picture's label can only be matched against 규격 that already exist); only then
 * are the pictures read. Reversing those two would spend 26 model calls to produce 26 unresolved
 * triples.
 *
 * <p><b>What leaves this class.</b> Counts, verdict tallies, and — because a product owner cannot
 * check an extraction they cannot see — the accepted triples whose attribute is capacity-related,
 * rendered as 규격 → value. Nothing else of the seller's content: no raw transcription, no
 * unrelated triple, no image URL, no page text.
 *
 * <p><b>Triple-gated and inert by default</b>, like the two diagnostics beside it. It is also the
 * only one of the three whose flag turns on a paid vendor call, which is why the budgets below are
 * constants in the file rather than properties.
 */
public class NaverImageKnowledgeProofRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(NaverImageKnowledgeProofRunner.class);
    private static final String TAG = "[naver-image-knowledge]";

    /** The approved marketplace GET budget: one listing. */
    static final int MAX_MARKETPLACE_REQUESTS = 1;

    /** The approved CDN and model budgets: every distinct picture, no arbitrary truncation. */
    static final int MAX_IMAGES = ImageFetchPolicy.MAX_IMAGES_PER_PRODUCT;

    /**
     * Which attributes the proof prints, and it is a NARROW list on purpose.
     *
     * <p>The product owner has to be able to check that the extraction is correct, and cannot do that
     * from counts. So the accepted triples that bear on the target question are shown — and only
     * those. An unrelated 규격 fact is the seller's content and stays where it is.
     */
    private static final List<String> CAPACITY_WORDS = List.of("가닥", "심선", "코어", "수용", "선");

    private final NaverTokenClient tokenClient;
    private final NaverChannelProductClient detailClient;
    private final SellerAccountRepository accounts;
    private final ChannelProductRepository listings;
    private final CredentialVault vault;
    private final ProductDetailEnrichment enrichment;
    private final ProductDetailImageKnowledge images;
    private final String accountIdProperty;
    private final long channelProductNo;

    public NaverImageKnowledgeProofRunner(NaverTokenClient tokenClient,
                                          NaverChannelProductClient detailClient,
                                          SellerAccountRepository accounts,
                                          ChannelProductRepository listings, CredentialVault vault,
                                          ProductDetailEnrichment enrichment,
                                          ProductDetailImageKnowledge images,
                                          String accountIdProperty, long channelProductNo) {
        this.tokenClient = tokenClient;
        this.detailClient = detailClient;
        this.accounts = accounts;
        this.listings = listings;
        this.vault = vault;
        this.enrichment = enrichment;
        this.images = images;
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
        UUID orgId = account.get().getOrgId();
        String clientId;
        String clientSecret;
        try {
            DecryptedCredential credential = vault.open(orgId, accountId);
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

        Optional<ChannelProduct> listing = listings.findByChannelIdAndExternalProductId(
                account.get().getChannelId(), String.valueOf(channelProductNo))
                .filter(row -> orgId.equals(row.getOrgId()));
        if (listing.isEmpty() || listing.get().getProductId() == null) {
            log.warn("{} LISTING_NOT_MAPPED; zero requests made.", TAG);
            return;
        }
        UUID productId = listing.get().getProductId();

        // The model identity is logged BEFORE the run, not inferred from it afterwards: "which model
        // actually ran" is an approval condition, and a condition checked from memory is not checked.
        log.info("{} start channel_product_no={} marketplace_budget={} image_budget={} model_budget={} "
                        + "extractor={}",
                TAG, channelProductNo, MAX_MARKETPLACE_REQUESTS, MAX_IMAGES, MAX_IMAGES,
                images.extractorVersion());
        NaverProductDetail detail;
        try {
            detail = detailClient.fetch(accessToken, channelProductNo);
        } catch (RuntimeException e) {
            log.warn("{} outcome={} marketplace_requests=1 model_calls=0", TAG,
                    e.getClass().getSimpleName());
            return;
        }
        if (detail == null) {
            log.info("{} outcome=NOT_FOUND marketplace_requests=1 model_calls=0", TAG);
            return;
        }

        // 1. VARIANTS FIRST. An IMAGE_REFERENCES_ONLY page still persists its 규격 — writeOptions runs
        //    before the shape is judged — and without them nothing a picture says is associable.
        ProductDetailEnrichment.Result applied = enrichment.apply(orgId,
                account.get().getChannelId(), productId, String.valueOf(channelProductNo),
                "NAVER:PRODUCT_API:v1", detail, Instant.now());
        log.info("{} VARIANTS enrichment={} options_written={} images_on_page={}", TAG,
                applied.outcome(), applied.optionsWritten(), applied.imageCount());

        // 2. THEN the pictures.
        DetailImageReferences.References refs =
                DetailImageReferences.extract(detail.detailContent());
        log.info("{} {} {}", TAG, DetailContentShape.describe(
                DetailContentShape.classify(detail.detailContent())), refs.describe());

        ProductDetailImageKnowledge.Result result = images.read(orgId, productId,
                "NAVER:PRODUCT_API:v1|" + channelProductNo, refs.urls());
        report(result);
    }

    private void report(ProductDetailImageKnowledge.Result result) {
        log.info("{} RUN outcome={} marketplace_requests=1 images_considered={} images_fetched={} "
                        + "model_calls={} reused_receipts={} failed_images={}",
                TAG, result.outcome(), result.imagesConsidered(), result.imagesFetched(),
                result.modelCalls(), result.reusedReceipts(), result.failedImages());
        log.info("{} FACTS images_with_facts={} zero_fact_images={} accepted={} unresolved={} "
                        + "refused={} published_documents={}",
                TAG, result.imagesWithFacts(), result.zeroFactImages(), result.accepted(),
                result.unresolved(), result.refused(), result.publishedDocuments());
        log.info("{} USAGE prompt_tokens={} completion_tokens={}", TAG,
                result.usage().promptTokens(), result.usage().completionTokens());

        // The only seller content that leaves, and only the part that answers the target question.
        for (ImageFactAuthority.Judged judged : result.judged()) {
            if (judged.accepted() && capacityRelated(judged.fact().attribute())) {
                log.info("{} CAPACITY {} -> {}", TAG, judged.matchedOptionName(),
                        judged.fact().value());
            }
        }
    }

    /**
     * Whether an attribute bears on the target question.
     *
     * <p><b>A reporting filter, not a classifier.</b> It decides what this diagnostic prints and
     * nothing else — no fact is accepted, refused or weighted by it. The distinction matters: the
     * same word list promoted into the extraction path would be exactly the generic spec ontology
     * this lane is forbidden to build.
     */
    private static boolean capacityRelated(String attribute) {
        if (attribute == null) {
            return false;
        }
        return CAPACITY_WORDS.stream().anyMatch(attribute::contains);
    }
}
