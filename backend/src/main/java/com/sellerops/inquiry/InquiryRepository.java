package com.sellerops.inquiry;

import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface InquiryRepository extends JpaRepository<Inquiry, UUID> {
    List<Inquiry> findTop50ByOrgIdOrderByReceivedAtDesc(UUID orgId);

    long countByOrgIdAndReceivedAtAfter(UUID orgId, Instant after);

    long countByOrgIdAndStatus(UUID orgId, String status);

    boolean existsByOrgIdAndChannelIdAndExternalId(UUID orgId, UUID channelId, String externalId);

    boolean existsByOrgIdAndChannelIdAndContentHash(UUID orgId, UUID channelId, String contentHash);
}
