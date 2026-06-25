package com.sellerops.community;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface Cafe24CommunityArticleRepository extends JpaRepository<Cafe24CommunityArticle, UUID> {

    /** Natural-key lookup driving the hash-guarded upsert. */
    Optional<Cafe24CommunityArticle> findByChannelIdAndSellerAccountIdAndBoardNoAndArticleNo(
            UUID channelId, UUID sellerAccountId, int boardNo, long articleNo);

    List<Cafe24CommunityArticle> findAllByOrgId(UUID orgId);

    List<Cafe24CommunityArticle> findAllByOrgIdAndSellerAccountIdAndBoardNo(
            UUID orgId, UUID sellerAccountId, int boardNo);

    /** Row count scoped to one connected mall — drives the verifier's count-delta report. */
    long countByOrgIdAndSellerAccountId(UUID orgId, UUID sellerAccountId);
}
