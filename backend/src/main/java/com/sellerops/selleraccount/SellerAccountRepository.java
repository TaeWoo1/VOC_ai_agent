package com.sellerops.selleraccount;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SellerAccountRepository extends JpaRepository<SellerAccount, UUID> {
    List<SellerAccount> findAllByOrgId(UUID orgId);

    Optional<SellerAccount> findByOrgIdAndChannelId(UUID orgId, UUID channelId);
}
