package com.sellerops.knowledge.guidance;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SellerGuidanceRepository extends JpaRepository<SellerGuidance, UUID> {

    List<SellerGuidance> findAllByOrgIdAndActiveTrueOrderByCreatedAtDesc(UUID orgId);
}
