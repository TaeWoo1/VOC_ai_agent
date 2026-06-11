package com.sellerops.connector;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConnectorAlertRepository extends JpaRepository<ConnectorAlert, UUID> {

    List<ConnectorAlert> findBySellerAccountIdOrderByCreatedAtDesc(UUID sellerAccountId);

    /** Spam guard: at most one unacknowledged alert of a type per seller account. */
    boolean existsBySellerAccountIdAndTypeAndAcknowledgedAtIsNull(UUID sellerAccountId, String type);
}
