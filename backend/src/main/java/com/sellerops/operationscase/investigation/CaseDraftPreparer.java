package com.sellerops.operationscase.investigation;

import com.sellerops.inquiry.draft.InquiryDraftComposer;
import com.sellerops.inquiry.draft.dto.GeneratedDraftView;
import com.sellerops.inquiry.proposal.InquiryProposalService;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * Prepares a reply draft for an inquiry case the investigator said the seller should answer — through <b>the
 * production draft path</b>, the same proposal transition and {@link InquiryDraftComposer} a seller's press runs.
 *
 * <p><b>Prepared is not executed.</b> The draft is one more append-only version; the work item stops at PROPOSED.
 * Nothing here creates an approval, mints a command, or reaches the Action Executor — the seller's approval on the
 * inquiry screen is still the only thing that can put a sentence in front of a customer. When the composer declines
 * (no answer basis, draft capability off for the organisation), nothing is written and that is reported as such.
 */
@Component
public class CaseDraftPreparer {

    /** The audit actor and draft author for everything the responsibility prepares. */
    public static final String ACTOR = "SYSTEM:RESPONSIBILITY";

    private static final Logger log = LoggerFactory.getLogger(CaseDraftPreparer.class);

    private final InquiryProposalService proposals;
    private final InquiryDraftComposer drafts;

    public CaseDraftPreparer(InquiryProposalService proposals, InquiryDraftComposer drafts) {
        this.proposals = proposals;
        this.drafts = drafts;
    }

    /**
     * @param written        a draft version exists now
     * @param reason         a closed token when nothing was written: PROPOSAL_REFUSED, COMPOSER_FAILED, NO_DRAFT
     */
    public record Prepared(boolean written, Integer version, String knowledgeState, int evidenceCount,
                           String reason) {
    }

    public Prepared prepare(UUID orgId, UUID workItemId) {
        try {
            proposals.proposeAs(orgId, workItemId, ACTOR);
        } catch (RuntimeException e) {
            log.info("responsibility: 제안 생성 건너뜀 org={} 사유={}", orgId, e.getClass().getSimpleName());
            return new Prepared(false, null, null, 0, "PROPOSAL_REFUSED");
        }
        GeneratedDraftView written;
        try {
            written = drafts.generateAs(orgId, workItemId, ACTOR);
        } catch (RuntimeException e) {
            log.info("responsibility: 초안 준비 실패 org={} 사유={}", orgId, e.getClass().getSimpleName());
            return new Prepared(false, null, null, 0, "COMPOSER_FAILED");
        }
        int evidence = written.evidence() == null ? 0 : written.evidence().size();
        if (written.draft() == null) {
            return new Prepared(false, null, written.knowledgeState(), evidence, "NO_DRAFT");
        }
        return new Prepared(true, written.draft().version(), written.knowledgeState(), evidence, null);
    }
}
