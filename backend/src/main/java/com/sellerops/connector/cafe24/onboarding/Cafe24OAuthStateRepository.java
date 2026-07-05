package com.sellerops.connector.cafe24.onboarding;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface Cafe24OAuthStateRepository extends JpaRepository<Cafe24OAuthState, UUID> {

    /** Look up a pending attempt by the SHA-256 hash of the callback's state token. */
    Optional<Cafe24OAuthState> findByStateHash(String stateHash);

    /** Prior in-flight attempts for an account — superseded when a new one starts. */
    List<Cafe24OAuthState> findBySellerAccountIdAndConsumedAtIsNull(UUID sellerAccountId);
}
