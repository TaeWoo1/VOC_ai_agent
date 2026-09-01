package com.sellerops.selleraccount;

import jakarta.persistence.LockModeType;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Lock;
import org.springframework.data.jpa.repository.Query;
import org.springframework.data.repository.query.Param;

public interface SellerAccountRepository extends JpaRepository<SellerAccount, UUID> {
    List<SellerAccount> findAllByOrgId(UUID orgId);

    /**
     * <b>Which organisations have asked us to collect for them</b> — Pilot Runtime Foundation v1 §6.
     *
     * <p>A seller account reaches {@code CONNECTED} only by the seller completing an OAuth consent or
     * entering a credential, so this list is not a guess about who wants routine collection: it is
     * the record of who asked. It is the source of truth the recurring-acquisition scope reads,
     * instead of an operator copying an org UUID into an environment file after every signup.
     *
     * <p>File-upload accounts are excluded here because they have no marketplace to poll — the same
     * exclusion the reconciler applies per account, applied once more at the org level so an org whose
     * only account is a file drop never becomes a target at all.
     */
    @Query("select distinct a.orgId from SellerAccount a "
            + "where a.connectionStatus = com.sellerops.channel.ChannelStatus.CONNECTED and a.fileUpload = false")
    List<UUID> findOrgIdsWithConnectedApiAccount();

    /**
     * The same question about ONE organisation — Pilot Readiness Closure v1 §2.
     *
     * <p>Asked per request by {@code AgentCapabilityAccess}, so it is an existence check rather than
     * the whole list: the answer is a single boolean about the caller's own org and never carries a
     * row, a credential or another organisation's id.
     */
    @Query("select count(a) > 0 from SellerAccount a where a.orgId = :orgId "
            + "and a.connectionStatus = com.sellerops.channel.ChannelStatus.CONNECTED and a.fileUpload = false")
    boolean hasConnectedApiAccount(@Param("orgId") UUID orgId);

    /**
     * Load a seller-account row under a {@code PESSIMISTIC_WRITE} lock (SELECT … FOR UPDATE) — the
     * serialization point for the NAVER connection lifecycle. Concurrent test / order-sync events for
     * one account take the lock one at a time, so the PENDING → PREPARING → CONNECTED transition is
     * evaluated on a consistent row and converges idempotently instead of racing into a lost update.
     */
    @Lock(LockModeType.PESSIMISTIC_WRITE)
    @Query("select a from SellerAccount a where a.id = :id")
    Optional<SellerAccount> findByIdForUpdate(@Param("id") UUID id);

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
