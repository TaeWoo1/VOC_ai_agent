package com.sellerops.credential;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ConnectorCredentialRepository extends JpaRepository<ConnectorCredential, UUID> {

    Optional<ConnectorCredential> findBySellerAccountId(UUID sellerAccountId);
}
