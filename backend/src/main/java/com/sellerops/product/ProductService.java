package com.sellerops.product;

import java.util.UUID;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.stereotype.Service;

/** Resolve-or-create products idempotently during ingestion. */
@Service
public class ProductService {

    private final ProductRepository products;

    public ProductService(ProductRepository products) {
        this.products = products;
    }

    /** Find by SKU (preferred) or name within the org; create if absent.
     *  Race-safe: if a concurrent upload created the same SKU first, the
     *  uq_products_sku violation is caught and the existing row re-read, so a
     *  product race is never misattributed to the review/inquiry row. */
    public Product resolveOrCreate(UUID orgId, String name, String sku) {
        if (sku != null && !sku.isBlank()) {
            return products.findByOrgIdAndSku(orgId, sku)
                    .orElseGet(() -> createBySku(orgId, name != null && !name.isBlank() ? name : sku, sku));
        }
        String resolvedName = name == null || name.isBlank() ? "(미지정 상품)" : name;
        return products.findFirstByOrgIdAndName(orgId, resolvedName)
                .orElseGet(() -> create(orgId, resolvedName, null));
    }

    private Product createBySku(UUID orgId, String name, String sku) {
        try {
            return create(orgId, name, sku);
        } catch (DataIntegrityViolationException raced) {
            return products.findByOrgIdAndSku(orgId, sku)
                    .orElseThrow(() -> raced);
        }
    }

    private Product create(UUID orgId, String name, String sku) {
        Product p = new Product();
        p.setOrgId(orgId);
        p.setName(name);
        p.setSku(sku);
        p.setStatus("ACTIVE");
        return products.save(p);
    }
}
