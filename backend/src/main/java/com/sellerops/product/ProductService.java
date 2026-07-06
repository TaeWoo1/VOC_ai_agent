package com.sellerops.product;

import java.time.Instant;
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

    /**
     * Resolve-or-create a product <b>safely inside an existing transaction</b>: identity
     * is the SKU (상품번호); a concurrent creation of the same SKU is handled by an
     * {@code ON CONFLICT DO NOTHING} insert (never a constraint violation), so the
     * enclosing import transaction is never left rollback-only, and both racers resolve
     * to the one product. The name (상품명) is only display metadata — products are never
     * merged by name, and the SKU string is stored verbatim so leading zeros survive.
     * Falls back to name resolution only when no SKU is present.
     */
    public Product resolveOrCreateWithinTransaction(UUID orgId, String name, String sku) {
        if (sku != null && !sku.isBlank()) {
            Product existing = products.findByOrgIdAndSku(orgId, sku).orElse(null);
            if (existing != null) {
                return existing;
            }
            String resolvedName = name != null && !name.isBlank() ? name : sku;
            products.insertIfAbsent(UUID.randomUUID(), orgId, resolvedName, sku, Instant.now());
            // Now present whether this call or a concurrent one inserted it.
            return products.findByOrgIdAndSku(orgId, sku)
                    .orElseThrow(() -> new IllegalStateException("상품 업서트 후 조회에 실패했습니다."));
        }
        String resolvedName = name == null || name.isBlank() ? "(미지정 상품)" : name;
        return products.findFirstByOrgIdAndName(orgId, resolvedName)
                .orElseGet(() -> create(orgId, resolvedName, null));
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
