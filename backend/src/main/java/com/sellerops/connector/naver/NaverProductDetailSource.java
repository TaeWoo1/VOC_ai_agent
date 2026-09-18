package com.sellerops.connector.naver;

import com.sellerops.credential.CredentialVault;
import com.sellerops.credential.DecryptedCredential;
import com.sellerops.product.detail.ChannelAccessRefused;
import com.sellerops.product.detail.ProductDetailSource;
import java.util.UUID;

/**
 * NAVER's 상세페이지 read, in the shape the enrichment trigger can hold.
 *
 * <p>Thin on purpose: it opens the credential and mints a token exactly the way
 * {@code NaverProductQnaReplyAdapter} does, then delegates to {@link NaverChannelProductClient},
 * which is the class that cannot express a catalogue walk. Nothing about staleness, triggers or
 * budgets lives here — those belong to the caller, so that "how many reads happened" stays
 * answerable at the call site.
 */
public class NaverProductDetailSource implements ProductDetailSource {

    private final NaverTokenClient tokens;
    private final NaverChannelProductClient detail;
    private final CredentialVault vault;
    private final NaverProductAttributeClient attributes;

    public NaverProductDetailSource(NaverTokenClient tokens, NaverChannelProductClient detail,
                                    CredentialVault vault) {
        this(tokens, detail, vault, null);
    }

    /**
     * @param attributes names the listing's category attributes; null reads the listing only and its attributes stay
     *                   unnamed (and so unstated)
     */
    public NaverProductDetailSource(NaverTokenClient tokens, NaverChannelProductClient detail,
                                    CredentialVault vault, NaverProductAttributeClient attributes) {
        this.tokens = tokens;
        this.detail = detail;
        this.vault = vault;
        this.attributes = attributes;
    }

    @Override
    public String channelCode() {
        return "NAVER";
    }

    @Override
    public String sourceKind() {
        return NaverProductsClient.SOURCE;
    }

    @Override
    public NaverProductDetail read(UUID orgId, UUID sellerAccountId, String externalProductId) {
        long channelProductNo;
        try {
            channelProductNo = Long.parseLong(externalProductId.strip());
        } catch (RuntimeException e) {
            // channel_products.external_product_id IS the channelProductNo for NAVER. A row that is
            // not a number is a row from somewhere else, and guessing an id is how a bounded read
            // becomes a read of someone else's listing.
            throw new IllegalStateException("네이버 상품 번호 형식이 올바르지 않습니다.");
        }
        DecryptedCredential credential = vault.open(orgId, sellerAccountId);
        String token;
        NaverProductDetail read;
        try {
            token = tokens.accessToken(credential.secrets().get("client_id"),
                    credential.secrets().get("client_secret"));
            read = detail.fetch(token, channelProductNo);
        } catch (NaverEnvironmentRefusedException e) {
            throw new ChannelAccessRefused(ChannelAccessRefused.Reason.ENVIRONMENT_NOT_ALLOWED, e);
        } catch (NaverProductPermissionException e) {
            throw new ChannelAccessRefused(ChannelAccessRefused.Reason.PERMISSION, e);
        } catch (com.sellerops.connector.ConnectorAuthException e) {
            throw new ChannelAccessRefused(ChannelAccessRefused.Reason.CREDENTIAL, e);
        }
        if (read == null || attributes == null || read.attributes().isEmpty()) {
            return read;
        }
        // Catalogue metadata, cached per category — a failed read here leaves the attributes unnamed and the rest of
        // the listing intact.
        return read.withFacts(attributes.name(token, read.leafCategoryId(), read.attributes()));
    }

    @Override
    public String detailSourceKind() {
        return NaverChannelProductClient.SOURCE;
    }
}
