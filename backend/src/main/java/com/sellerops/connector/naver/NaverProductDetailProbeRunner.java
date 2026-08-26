package com.sellerops.connector.naver;

import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.product.detail.DetailContentShape;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;

/**
 * The bounded, approval-gated live read that answers one question: <b>does this seller's 상세페이지
 * carry its answers as text, or as pictures?</b>
 *
 * <p>Everything about whether SellerOps ever builds image understanding turns on that, and it has
 * been assumed rather than measured. On 2026-08-26 a NAVER draft answered 「전선이 몇 가닥까지
 * 들어가나요?」 from a product-level FAQ because the real answer was on the detail page; the working
 * theory was "the detail page is images", and an OCR pipeline built on a theory that turns out false
 * is a large amount of machinery answering a question nobody had.
 *
 * <p><b>Exactly one request.</b> {@link #MAX_REQUESTS} is 1 and is checked before the call. There is
 * no paging, no catalogue walk, and no second product — the client it uses
 * ({@link NaverChannelProductClient}) cannot express one.
 *
 * <p><b>Triple-gated and inert by default.</b> The bean exists only when the connector is enabled AND
 * {@code sellerops.connector.naver.diagnostic.product-detail.enabled=true}, and even then it does
 * nothing unless an account id and a channel product number are configured. It is not wired into the
 * scheduler or any collection path, and it writes nothing — not to the marketplace, not to the store.
 *
 * <p><b>Nothing the seller wrote leaves this class.</b> The page becomes a
 * {@link DetailContentShape.Measurement} — an enum and three integers — and the options become a
 * COUNT and a presence flag. Not one character of the detail page, not one image URL, and not one
 * option label is logged. That is enough to decide the acquisition path, and not enough to reproduce
 * the listing.
 */
public class NaverProductDetailProbeRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(NaverProductDetailProbeRunner.class);
    private static final String TAG = "[naver-product-detail]";

    /** The approved marketplace GET budget for this diagnostic. One. */
    static final int MAX_REQUESTS = 1;

    private final NaverTokenClient tokenClient;
    private final NaverChannelProductClient detailClient;
    private final SellerAccountRepository accounts;
    private final CredentialVault vault;
    private final String accountIdProperty;
    private final long channelProductNo;

    public NaverProductDetailProbeRunner(NaverTokenClient tokenClient,
                                         NaverChannelProductClient detailClient,
                                         SellerAccountRepository accounts, CredentialVault vault,
                                         String accountIdProperty, long channelProductNo) {
        this.tokenClient = tokenClient;
        this.detailClient = detailClient;
        this.accounts = accounts;
        this.vault = vault;
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
            // A diagnostic must never crash the backend it boots in, and never echo a body.
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
            // The vault half. Only the CLASS travels: an unsealing failure's message can name the key
            // material it was working on, and this is the one place a secret could reach a log.
            log.warn("{} VAULT_FAILED ({}); zero marketplace requests made.",
                    TAG, e.getClass().getSimpleName());
            return;
        }
        if (clientId == null || clientId.isBlank() || clientSecret == null || clientSecret.isBlank()) {
            log.warn("{} CREDENTIAL_INCOMPLETE; zero marketplace requests made.", TAG);
            return;
        }
        String accessToken;
        try {
            accessToken = tokenClient.accessToken(clientId, clientSecret);
        } catch (RuntimeException e) {
            // The token half, and here the MESSAGE is reported on purpose. Every throw site in
            // NaverTokenClient carries a hand-written, deliberately secret-free sentence — one of them
            // exists solely to tell the operator that NAVER refused this machine's calling IP and to
            // go check the registered 'API 호출 IP'. Swallowing that is swallowing the instruction.
            log.warn("{} TOKEN_FAILED ({}): {}; zero marketplace requests made.",
                    TAG, e.getClass().getSimpleName(), e.getMessage());
            return;
        }

        log.info("{} start channel_product_no={} budget={}", TAG, channelProductNo, MAX_REQUESTS);
        NaverProductDetail detail;
        try {
            detail = detailClient.fetch(accessToken, channelProductNo);
        } catch (RuntimeException e) {
            log.warn("{} outcome={} requests_used=1", TAG, e.getClass().getSimpleName());
            return;
        }
        if (detail == null) {
            log.info("{} outcome=NOT_FOUND requests_used=1 — absence, never a deletion.", TAG);
            return;
        }

        DetailContentShape.Measurement measurement =
                DetailContentShape.classify(detail.detailContent());
        int options = detail.options() == null ? 0 : detail.options().size();
        long optionsWithIdentity = detail.options() == null ? 0
                : detail.options().stream().filter(o -> o.externalId() != null).count();
        int images = detail.imageUrls() == null ? 0 : detail.imageUrls().size();

        log.info("{} {} listing_images={} options={} options_with_id={} name_present={}",
                TAG, DetailContentShape.describe(measurement), images, options, optionsWithIdentity,
                detail.name() != null && !detail.name().isBlank());
        log.info("{} VERDICT shape={} text_is_enough={} needs_image_understanding={} "
                        + "variant_named_reachable={} requests_used=1",
                TAG, measurement.shape(), measurement.textIsEnough(),
                measurement.needsImageUnderstanding(), optionsWithIdentity > 0);
    }
}
