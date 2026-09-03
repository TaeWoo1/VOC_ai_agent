package com.sellerops.inquiry.reply;

import java.util.Collection;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.jpa.repository.JpaRepository;
import org.springframework.data.jpa.repository.Query;

public interface InquiryReplyDraftRepository extends JpaRepository<InquiryReplyDraft, UUID> {

    /** The current (highest-version) draft for a work item, if any. */
    Optional<InquiryReplyDraft> findTopByWorkItemIdOrderByVersionDesc(UUID workItemId);

    Optional<InquiryReplyDraft> findByWorkItemIdAndVersion(UUID workItemId, int version);

    long countByWorkItemId(UUID workItemId);

    /**
     * Which of these work items actually have a draft — one query for a whole page.
     *
     * <p><b>A phase is not a draft.</b> The queue row used to say 「초안 준비됨」 whenever the work item
     * sat in {@code PROPOSED}, but that phase is written by {@code InquiryProposalWriter}, and an
     * {@code InquiryProposal} records only what a reply <i>would</i> be about — its own class says it
     * persists no reply-draft text. On 2026-09-04 the demo org held ten {@code PROPOSED} items and
     * <b>eight had no draft at all</b>, so eight rows promised the seller something to read that was
     * never written. This is the fact that sentence needs.
     */
    @Query("select distinct d.workItemId from InquiryReplyDraft d where d.workItemId in :workItemIds")
    List<UUID> findWorkItemIdsWithDraft(Collection<UUID> workItemIds);
}
