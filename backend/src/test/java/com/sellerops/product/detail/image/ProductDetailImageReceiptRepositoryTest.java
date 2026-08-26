package com.sellerops.product.detail.image;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import java.time.Instant;
import java.util.UUID;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * The receipt's identity, against the real schema.
 *
 * <p>The unique key is the whole design decision made executable: <b>(org, product, sha, extractor,
 * model)</b> and not {@code (org, sha)}. The shorter key would have been a cross-product cache — the
 * same delivery banner under a second product would count as already handled — and cross-product
 * reuse is deferred, unmeasured, and a different question, because the 규격 a picture is associated
 * against belong to the product it is under.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class ProductDetailImageReceiptRepositoryTest {

    @Autowired
    ProductDetailImageReceiptRepository receipts;

    private final UUID org = UUID.randomUUID();

    private ProductDetailImageReceipt receipt(UUID productId, String sha, String extractor,
                                             String model) {
        ProductDetailImageReceipt row = new ProductDetailImageReceipt();
        row.setOrgId(org);
        row.setProductId(productId);
        row.setImageSha256(sha);
        row.setExtractorVersion(extractor);
        row.setModelVersion(model);
        row.setStatus(ProductDetailImageReceipt.Status.COMPLETED);
        row.setOutcome(ProductDetailImageReceipt.Outcome.NO_FACTS);
        row.setQueuedAt(Instant.now());
        row.setExtraction("{\"facts\":[]}");
        return row;
    }

    @Test
    @DisplayName("the same picture under a DIFFERENT product is a different reading")
    void productIsPartOfTheIdentity() {
        UUID first = UUID.randomUUID();
        UUID second = UUID.randomUUID();
        receipts.saveAndFlush(receipt(first, "sha-shared", "x/v1", "openai:gpt-5.6-terra"));
        receipts.saveAndFlush(receipt(second, "sha-shared", "x/v1", "openai:gpt-5.6-terra"));

        assertThat(receipts.findAllByOrgIdAndProductId(org, first)).hasSize(1);
        assertThat(receipts.findAllByOrgIdAndProductId(org, second)).hasSize(1);
    }

    @Test
    @DisplayName("a new extractor or a new model re-reads rather than inheriting an old answer")
    void extractorAndModelArePartOfTheIdentity() {
        UUID productId = UUID.randomUUID();
        receipts.saveAndFlush(receipt(productId, "sha-a", "x/v1", "openai:gpt-5.6-terra"));
        receipts.saveAndFlush(receipt(productId, "sha-a", "x/v2", "openai:gpt-5.6-terra"));
        receipts.saveAndFlush(receipt(productId, "sha-a", "x/v1", "openai:other"));

        assertThat(receipts.findAllByOrgIdAndProductId(org, productId)).hasSize(3);
        assertThat(receipts.findByOrgIdAndProductIdAndImageSha256AndExtractorVersionAndModelVersion(
                org, productId, "sha-a", "x/v1", "openai:gpt-5.6-terra")).isPresent();
    }

    @Test
    @DisplayName("the same picture, product, extractor and model cannot be recorded twice")
    void theIdentityIsUnique() {
        UUID productId = UUID.randomUUID();
        receipts.saveAndFlush(receipt(productId, "sha-a", "x/v1", "openai:gpt-5.6-terra"));

        assertThatThrownBy(() ->
                receipts.saveAndFlush(receipt(productId, "sha-a", "x/v1", "openai:gpt-5.6-terra")))
                .isInstanceOf(Exception.class);
    }

    @Test
    @DisplayName("a zero-result reading survives a restart — it is a result, not an absence")
    void zeroResultIsDurable() {
        UUID productId = UUID.randomUUID();
        receipts.saveAndFlush(receipt(productId, "sha-a", "x/v1", "openai:gpt-5.6-terra"));

        ProductDetailImageReceipt reloaded = receipts
                .findByOrgIdAndProductIdAndImageSha256AndExtractorVersionAndModelVersion(
                        org, productId, "sha-a", "x/v1", "openai:gpt-5.6-terra").orElseThrow();

        assertThat(reloaded.reusable()).isTrue();
        assertThat(reloaded.getOutcome()).isEqualTo(ProductDetailImageReceipt.Outcome.NO_FACTS);
        assertThat(reloaded.getExtraction()).isEqualTo("{\"facts\":[]}");
    }
}
