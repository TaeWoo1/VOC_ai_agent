package com.sellerops.attention.reply;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

/**
 * Overrides, read by organization. Every query is org-scoped — there is no route into this table
 * that does not name the org from the JWT, so one company's wording is not addressable by another.
 */
public interface ReviewReplyTemplateRepository extends JpaRepository<ReviewReplyTemplate, UUID> {

    List<ReviewReplyTemplate> findByOrgId(UUID orgId);

    Optional<ReviewReplyTemplate> findByOrgIdAndTemplateKey(UUID orgId, String templateKey);

    long deleteByOrgIdAndTemplateKey(UUID orgId, String templateKey);
}
