package com.sellerops.selleraccount;

import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;

public interface SellerAccountRepository extends JpaRepository<SellerAccount, UUID> {
    List<SellerAccount> findAllByOrgId(UUID orgId);

    Optional<SellerAccount> findByOrgIdAndChannelId(UUID orgId, UUID channelId);

    /**
     * The account for a (org, channel) in a given mode (API vs file-upload), if any. Scoped by the
     * {@code fileUpload} flag so an API connection and a file-upload row on the same channel never
     * collide — the guided-connection start and the file-channel start each find-or-create only their
     * own mode's row, so one flow can never clobber the other's account.
     *
     * <p>{@code findFirst … OrderByCreatedAtAsc} deliberately returns at most one row (oldest first)
     * rather than an {@code Optional} over all matches: there is no DB uniqueness backstop on
     * {@code (org_id, channel_id, is_file_upload)}, so a race (two concurrent starts) could leave a
     * duplicate row. This shape degrades that to a harmless redundant row — every read still returns one
     * deterministic account — instead of a query that throws {@code IncorrectResultSizeDataAccessException}
     * on every subsequent call and wedges the connect page. A unique partial index is the real hardening
     * but needs a migration (a product-owner decision, out of this slice's scope).
     */
    Optional<SellerAccount> findFirstByOrgIdAndChannelIdAndFileUploadOrderByCreatedAtAsc(
            UUID orgId, UUID channelId, boolean fileUpload);

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
