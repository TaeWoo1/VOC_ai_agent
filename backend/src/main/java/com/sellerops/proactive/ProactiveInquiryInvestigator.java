package com.sellerops.proactive;

import com.sellerops.inquiry.draft.DraftKnowledgeState;
import com.sellerops.inquiry.draft.InquiryDraftComposer;
import com.sellerops.inquiry.draft.dto.GeneratedDraftView;
import com.sellerops.inquiry.proposal.InquiryProposalService;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * What SellerOps finds out about an unanswered inquiry before the seller opens it.
 *
 * <p><b>It builds no second pipeline.</b> The investigation IS the production path: the same
 * proposal transition a seller triggers by pressing 제안 생성, then the same
 * {@link InquiryDraftComposer} that runs when they press 초안 쓰기 — which is where the retrieval
 * lives (product knowledge, the org's operating policy, the seller's own past answers, and a
 * deterministic order fact when the channel named an order). Reimplementing any of that here would
 * create a second answer to "what may this reply be grounded in", and the two would diverge the first
 * time either changed.
 *
 * <p><b>The boundary it must not cross is the approval.</b> The work item ends at PROPOSED with a
 * draft attached. Nothing here creates an approval, mints a command id, or touches the Action
 * Executor; the seller's explicit approval on the existing screen is still the only thing that can
 * put a sentence in front of a customer. {@code ProactiveSafetyFenceTest} asserts this by reading the
 * package's own source.
 *
 * <p><b>A failure is reported, not swallowed into a false state.</b> The candidate's reason — the
 * channel says a customer is waiting — is true whether or not a draft could be written, so a case is
 * still prepared with {@link ProactivePreparedAction#NONE} and the screen says what is missing. A
 * card that silently disappeared because a model was unavailable would hide work the seller has.
 */
@Component
public class ProactiveInquiryInvestigator {

    /** The audit actor and draft author for everything this package prepares. */
    public static final String ACTOR = "SYSTEM:PROACTIVE_AGENT";

    private static final Logger log = LoggerFactory.getLogger(ProactiveInquiryInvestigator.class);

    private final InquiryProposalService proposals;
    private final InquiryDraftComposer drafts;

    public ProactiveInquiryInvestigator(InquiryProposalService proposals, InquiryDraftComposer drafts) {
        this.proposals = proposals;
        this.drafts = drafts;
    }

    /**
     * What one investigation produced.
     *
     * @param action        how far it got
     * @param draftVersion  the append-only version written, or null
     * @param knowledgeState the four-value library state, or null when no draft was written
     * @param evidenceCount how many passages actually reached the drafter
     * @param knowledgeGap  the one thing the seller could add so the next draft is grounded, or null
     * @param note          why the preparation stopped short, or null when it did not
     */
    public record Investigation(ProactivePreparedAction action, Integer draftVersion,
                                String knowledgeState, int evidenceCount,
                                String knowledgeGap, String note) {

        static Investigation failed(String note) {
            return new Investigation(ProactivePreparedAction.NONE, null, null, 0, null, note);
        }
    }

    public Investigation investigate(UUID orgId, UUID workItemId) {
        try {
            // OPEN → PROPOSED. Idempotent: a work item already proposed replays without a second
            // proposal, which is what makes a re-run after a partial failure safe.
            proposals.proposeAs(orgId, workItemId, ACTOR);
        } catch (RuntimeException e) {
            // The item moved under us (a seller opened it first), or the provider is down. Neither is
            // this loop's business to force.
            log.info("proactive: 제안 생성 건너뜀 org={} workItem={} 사유={}", orgId, workItemId, e.toString());
            return Investigation.failed("제안을 생성하지 못했습니다.");
        }

        GeneratedDraftView written;
        try {
            written = drafts.generateAs(orgId, workItemId, ACTOR);
        } catch (RuntimeException e) {
            log.info("proactive: 초안 생성 실패 org={} workItem={} 사유={}", orgId, workItemId, e.toString());
            return Investigation.failed("답변 초안을 준비하지 못했습니다.");
        }

        DraftKnowledgeState state = parse(written.knowledgeState());
        return new Investigation(
                // A draft that was never written is not a prepared draft. Since 2026-08-26 the
                // composer declines to compose when no current evidence applies, and reporting
                // DRAFT_PREPARED for that would put a 「초안 준비됨」 card in front of a seller with
                // nothing behind it — the exact overstatement this lane exists to avoid.
                written.draft() == null ? ProactivePreparedAction.NONE
                        : ProactivePreparedAction.DRAFT_PREPARED,
                written.draft() == null ? null : written.draft().version(),
                written.knowledgeState(),
                written.evidence() == null ? 0 : written.evidence().size(),
                gapFor(state),
                written.unavailableMessage());
    }

    /**
     * What the seller could add so the next draft on this question is grounded — or null.
     *
     * <p>Each of the three ungrounded states is a DIFFERENT thing to do, which is exactly why
     * {@link DraftKnowledgeState} keeps them apart, and a single "지식이 부족합니다" would throw that
     * away. GROUNDED has no gap: a sentence telling a seller to add knowledge they already added is
     * how a prompt stops being read.
     */
    private static String gapFor(DraftKnowledgeState state) {
        if (state == null) {
            return null;
        }
        return switch (state) {
            case NO_PRODUCT -> "이 문의가 어떤 상품에 대한 것인지 연결해 두면, 다음 초안은 상품 지식을 근거로 씁니다.";
            case NO_LIBRARY -> "이 상품에 등록된 지식이 없습니다. 상품 정보를 한 번 적어 두면 이후 답변에 계속 쓰입니다.";
            case NO_MATCH -> "상품 지식·운영 정책·과거 답변 어디에도 이 질문에 해당하는 내용이 없습니다. 운영 기준을 추가해 주세요.";
            case GROUNDED -> null;
        };
    }

    private static DraftKnowledgeState parse(String raw) {
        if (raw == null) {
            return null;
        }
        try {
            return DraftKnowledgeState.valueOf(raw);
        } catch (IllegalArgumentException unknown) {
            return null;
        }
    }
}
