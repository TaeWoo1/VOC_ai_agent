package com.sellerops.review.media;

import java.util.List;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface ReviewMediaRepository extends JpaRepository<ReviewMedia, UUID> {

    List<ReviewMedia> findByOrgIdAndReviewIdOrderByOrdinalAsc(UUID orgId, UUID reviewId);
}
