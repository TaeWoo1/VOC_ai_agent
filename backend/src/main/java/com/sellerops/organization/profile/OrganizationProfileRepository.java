package com.sellerops.organization.profile;

import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface OrganizationProfileRepository extends JpaRepository<OrganizationProfile, UUID> {
}
