package com.sellerops.operationscase;

import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.draft.InquiryKnowledgeAssessor;
import com.sellerops.inquiry.goal.CustomerGoalSet;
import com.sellerops.inquiry.resolve.CustomerGoalInterpretation;
import com.sellerops.inquiry.resolve.InquiryGoalResolutionService;
import com.sellerops.inquiry.resolve.InquiryResolutionContext;
import com.sellerops.inquiry.resolve.InquiryResolutionView;
import com.sellerops.order.fact.OrderFactLookup;
import java.time.Clock;
import java.util.Optional;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.stereotype.Component;

/**
 * <b>What this inquiry's customer actually asked for, resolved against this seller's own objects.</b>
 *
 * <p>This is the case runtime's door to the Customer Goal loop. It reads the goals, binds the referents to the
 * order and listing the channel named, asks the deterministic resolvers, and hands back a terminal reading that
 * {@link CaseFromResolution} turns into case fields.
 *
 * <h2>It is off, and that is the honest state</h2>
 *
 * <p>{@link CustomerGoalInterpretation} has <b>no production implementation</b> — reading a sentence into goals is
 * a model's job and that capability has no production caller yet. With no interpreter bean, or with one that says
 * nothing read this message, {@link #read} returns null before doing any work at all: <b>no retrieval, no reads,
 * nothing</b>. Every case behaves exactly as it did before this class existed.
 *
 * <h2>Stored only, and no model</h2>
 *
 * <p>The gather is {@link OrderFactLookup#STORED_ONLY} — the same posture the case investigation already uses,
 * because a background run does not reach a marketplace for an order. The resolvers themselves are pure. So the
 * whole of this path is database reads, and what it cannot establish from the store it reports as a gap rather
 * than going to find out.
 *
 * <p>It reaches the lanes through {@link InquiryKnowledgeAssessor}, never through the retriever directly. The
 * retrieval belongs to the assessment; a second caller of the lanes is a second answer that can disagree with the
 * one the draft cited.
 */
@Component
public class CaseResolutionReader {

    private static final Logger log = LoggerFactory.getLogger(CaseResolutionReader.class);

    private final java.util.function.Supplier<CustomerGoalInterpretation> interpretation;
    private final InquiryRepository inquiries;
    private final InquiryKnowledgeAssessor assessor;
    private final InquiryGoalResolutionService resolution;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public CaseResolutionReader(ObjectProvider<CustomerGoalInterpretation> interpretation, InquiryRepository inquiries,
                                InquiryKnowledgeAssessor assessor, InquiryGoalResolutionService resolution) {
        this(interpretation::getIfAvailable, inquiries, assessor, resolution, Clock.systemUTC());
    }

    /** The hand-wired shape: the interpretation supplied directly, and null when nothing reads messages. */
    public CaseResolutionReader(java.util.function.Supplier<CustomerGoalInterpretation> interpretation,
                                InquiryRepository inquiries, InquiryKnowledgeAssessor assessor,
                                InquiryGoalResolutionService resolution, Clock clock) {
        this.interpretation = interpretation;
        this.inquiries = inquiries;
        this.assessor = assessor;
        this.resolution = resolution;
        this.clock = clock;
    }

    /**
     * The terminal reading for one inquiry, or null when nothing read it.
     *
     * <p>Never throws. A case in the middle of a run cannot fail because a resolution was unavailable, and an
     * unavailable resolution is an absence like any other — the case stays exactly where the rules put it.
     */
    public InquiryResolutionView read(UUID orgId, UUID inquiryId) {
        CustomerGoalInterpretation reader = interpretation.get();
        if (reader == null || orgId == null || inquiryId == null) {
            return null;
        }
        try {
            Inquiry inquiry = inquiries.findById(inquiryId).filter(i -> orgId.equals(i.getOrgId())).orElse(null);
            if (inquiry == null) {
                return null;
            }
            Optional<CustomerGoalSet> goals = reader.interpret(orgId, inquiry);
            if (goals.isEmpty()) {
                return null;   // nobody read this message; that is not the same as it asking for nothing
            }
            // The case runtime's own assessment — the same call the investigation makes, stored order facts only.
            // Going through the assessor rather than the retriever is deliberate: the retrieval belongs to the
            // assessment, and a second caller of the lanes is a second answer (Retrieval Runtime Closure v1).
            InquiryKnowledgeAssessor.Assessment assessment =
                    assessor.assess(orgId, inquiry, OrderFactLookup.STORED_ONLY);
            InquiryResolutionContext context = resolution.contextFor(orgId, inquiry, assessment.retrieved(),
                    OrderFactLookup.STORED_ONLY, clock.instant());
            return InquiryResolutionView.of(InquiryGoalResolutionService.resolve(goals.get(), context));
        } catch (RuntimeException unreadable) {
            log.info("case: 목표 해석을 읽지 못해 규칙 판단을 유지합니다 org={} 사유={}", orgId,
                    unreadable.getClass().getSimpleName());
            return null;
        }
    }
}
