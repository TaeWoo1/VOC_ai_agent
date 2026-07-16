package com.sellerops.selleraccount;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SellerAccountRepository extends JpaRepository<SellerAccount, UUID> {
    List<SellerAccount> findAllByOrgId(UUID orgId);

    Optional<SellerAccount> findByOrgIdAndChannelId(UUID orgId, UUID channelId);

    /**
     * How many accounts this org holds on one channel. Used by the ingested-review
     * attention source to detect the case it cannot answer: {@code reviews} is scoped
     * org+channel with no seller account, so with two accounts on one channel a
     * per-account read cannot attribute a review to either. Counting — rather than
     * {@link #findByOrgIdAndChannelId}, which throws on a non-unique result — lets that
     * caller fail closed instead of erroring.
     */
    long countByOrgIdAndChannelId(UUID orgId, UUID channelId);

    /** Org-scoped lookup — a cross-org id reads as absent. */
    Optional<SellerAccount> findByIdAndOrgId(UUID id, UUID orgId);
}
