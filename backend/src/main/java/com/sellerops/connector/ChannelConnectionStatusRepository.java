package com.sellerops.connector;

import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ChannelConnectionStatusRepository extends JpaRepository<ChannelConnectionStatus, UUID> {

    Optional<ChannelConnectionStatus> findBySellerAccountId(UUID sellerAccountId);
}
