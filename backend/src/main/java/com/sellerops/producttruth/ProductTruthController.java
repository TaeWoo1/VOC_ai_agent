package com.sellerops.producttruth;

import com.sellerops.producttruth.dto.ProductTruthView;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The Canonical Product Source, read-only.
 *
 * <p>Deployment-scoped like {@code /api/collect/posture} and for the same reason: what this product
 * does is not a fact about an organization. The Agent runtime reads it once per capability turn and
 * decides there which of the reviewed items a given question may stand on.
 *
 * <p>Auth-gated like every non-auth endpoint. It carries no seller data, no credential and no
 * configuration key — the ledger refuses to load with a configuration key in a seller sentence.
 */
@RestController
@RequestMapping("/api/product-truth")
public class ProductTruthController {

    private final ProductTruthCatalog catalog;

    public ProductTruthController(ProductTruthCatalog catalog) {
        this.catalog = catalog;
    }

    @GetMapping
    public ProductTruthView truth() {
        return catalog.view();
    }
}
