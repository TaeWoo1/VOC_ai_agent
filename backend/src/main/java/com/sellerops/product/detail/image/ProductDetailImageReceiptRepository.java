package com.sellerops.product.detail.image;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductDetailImageReceiptRepository
        extends JpaRepository<ProductDetailImageReceipt, UUID> {

    /**
     * The full identity, and every component of it is load-bearing.
     *
     * <p>Product is in the key because {@code (org, sha256)} would be a cross-product cache, which is
     * deferred; extractor and model are in it because a new prompt or model is a different reading of
     * the same picture and must not inherit the old one's answer.
     */
    Optional<ProductDetailImageReceipt> findByOrgIdAndProductIdAndImageSha256AndExtractorVersionAndModelVersion(
            UUID orgId, UUID productId, String imageSha256, String extractorVersion, String modelVersion);

    List<ProductDetailImageReceipt> findAllByOrgIdAndProductId(UUID orgId, UUID productId);
}
