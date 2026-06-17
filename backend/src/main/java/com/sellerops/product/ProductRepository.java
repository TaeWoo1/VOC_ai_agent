package com.sellerops.product;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ProductRepository extends JpaRepository<Product, UUID> {
    List<Product> findAllByOrgId(UUID orgId);

    Optional<Product> findByOrgIdAndSku(UUID orgId, String sku);

    Optional<Product> findFirstByOrgIdAndName(UUID orgId, String name);
}
