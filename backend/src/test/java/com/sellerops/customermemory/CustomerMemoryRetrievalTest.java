package com.sellerops.customermemory;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.attention.AttentionCoverage;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.customermemory.dto.CustomerMemoryHitView;
import com.sellerops.customermemory.dto.CustomerMemorySearchView;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.reply.InquiryReplyDraft;
import com.sellerops.inquiry.reply.InquiryReplyDraftRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.itemanalysis.ItemAnalysisRepository;
import com.sellerops.itemanalysis.ItemAnalysisService;
import com.sellerops.itemanalysis.RuleBasedInboxItemAnalyzer;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.ReviewRepository;
import com.sellerops.reviewissue.RuleBasedIssueSignatureExtractor;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.test.context.ActiveProfiles;

/**
 * Recall: "이 문의, 전에 본 적 있나. 그때 뭐라고 답했나."
 *
 * <p>The properties that carry weight here are not "it returns rows". They are:
 * <b>the ranking is a product decision</b> (a signature match is a better precedent than a topic
 * match, and an answered precedent beats an unanswered one, because the point is to reuse an answer);
 * <b>no customer text crosses the boundary</b>; and <b>an empty answer is not automatically a
 * finding</b> — an org whose index is empty must say "판단 불가", not "처음 있는 일".
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class CustomerMemoryRetrievalTest {

    @Autowired CustomerMemoryEntryRepository entries;
    @Autowired ReviewRepository reviews;
    @Autowired InquiryRepository inquiries;
    @Autowired ItemAnalysisRepository analyses;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryReplyDraftRepository drafts;
    @Autowired ProductRepository products;
    @Autowired ChannelRepository channels;
    @Autowired com.sellerops.inquirysignal.InquirySignatureCacheRepository signatureCache;

    private final UUID org = UUID.randomUUID();
    private UUID channelId;
    private CustomerMemoryIndexer indexer;
    private CustomerMemoryQueryService query;

    // Single-clause bodies on purpose. OpinionUnitSplitter splits on a Korean contrastive ending, so
    // "붙였는데 … 떨어졌어요" becomes TWO units — aspect in one, problem in the other — and with
    // `inherit-aspect` off (the shipped default, because inheriting fabricates attribution) neither
    // unit yields a signature. That is correct extractor behaviour, not a bug to work around, so the
    // fixtures say the thing in one clause the way a signature-bearing review actually does.
    private static final String ADHESION = "양면테이프 부분이 떨어졌어요";
    private static final String DELIVERY = "택배가 너무 늦게 왔어요";

    @BeforeEach
    void setUp() {
        channelId = seedChannel();
        indexer = new CustomerMemoryIndexer(entries, reviews, inquiries, analyses,
                new RuleBasedIssueSignatureExtractor(false),
                // The inquiry axis is semantic since Operator Graph v2 — the rule extractor produced a
                // signature for 0 of 3,220 real inquiries, so wiring it here would only re-pin a
                // measured failure. The stub stands at the CLASSIFIER port (not at a planner), and
                // `InquirySignatureClassifierFenceTest` proves no sibling exists in main.
                new com.sellerops.inquirysignal.InquirySignatureService(
                        new com.sellerops.inquirysignal.StubInquirySignatureClassifier()
                                .answeringContains("떨어졌", "품질",
                                        com.sellerops.reviewissue.InquiryAskKind.DEFECT),
                        signatureCache));
        query = new CustomerMemoryQueryService(entries, new LexicalCustomerMemoryRetriever(entries),
                workItems, drafts, products, channels);
    }

    @Test
    @DisplayName("the same problem is recalled, and the inquiry is never its own precedent")
    void theSameProblemIsRecalled() {
        Inquiry sameProblem = indexedInquiry("접착 문의", ADHESION, "ANSWERED", "2026-07-01");
        Inquiry unrelated = indexedInquiry("배송 문의", DELIVERY, "ANSWERED", "2026-08-01");
        Inquiry asking = indexedInquiry("또 떨어져요", ADHESION, "UNANSWERED", "2026-08-20");

        CustomerMemorySearchView view = query.recallForInquiry(org, asking.getId(), 5);

        assertThat(view.hits()).isNotEmpty();
        assertThat(view.hits().get(0).sourceId())
                .as("the same aspect:problem is the precedent worth reading, even though it is older")
                .isEqualTo(sameProblem.getId());
        assertThat(view.hits()).extracting(CustomerMemoryHitView::sourceId)
                .as("the inquiry never returns itself as its own precedent")
                .doesNotContain(asking.getId())
                .as("and an unrelated problem is not a precedent")
                .doesNotContain(unrelated.getId());
    }

    /**
     * Ranking, asserted on the retriever directly.
     *
     * <p>Through the whole pipeline the ranking tiers are hard to separate — a body that yields a
     * signature usually also yields the topic that goes with it — so the ORDER, which is a product
     * decision rather than an implementation detail, is asserted where the tiers can actually be held
     * apart. A signature precedent beats a topic-only one because it is the same problem; an answered
     * precedent beats an unanswered one because the point of recall is to reuse an answer.
     */
    @Test
    @DisplayName("ranking: signature over topic, answered over unanswered, newer over older")
    void rankingIsSignatureThenAnsweredThenRecent() {
        UUID topicOnly = savedEntry(null, "품질", false, "2026-08-19");
        UUID signatureUnanswered = savedEntry("접착:탈락", "품질", false, "2026-08-18");
        UUID signatureAnsweredOld = savedEntry("접착:탈락", "품질", true, "2026-01-05");
        UUID signatureAnsweredNew = savedEntry("접착:탈락", "품질", true, "2026-08-01");

        List<CustomerMemoryEntry> ranked = new LexicalCustomerMemoryRetriever(entries)
                .retrieve(org, new CustomerMemoryRetriever.RetrievalCue("접착:탈락", "품질", null), null, 10);

        assertThat(ranked).extracting(CustomerMemoryEntry::getSourceId)
                .containsExactly(signatureAnsweredNew, signatureAnsweredOld, signatureUnanswered, topicOnly);
    }

    @Test
    @DisplayName("a hit carries the approved past answer, and never the customer's own words")
    void hitsCarryTheAnswerNotTheQuestion() {
        Inquiry past = indexedInquiry("접착 문의", ADHESION, "ANSWERED", "2026-07-01");
        answer(past, "안녕하세요. 접착 관련 안내드립니다. 시공 면을 먼저 닦아 주세요.");
        Inquiry asking = indexedInquiry("또 떨어져요", ADHESION, "UNANSWERED", "2026-08-20");

        CustomerMemorySearchView view = query.recallForInquiry(org, asking.getId(), 5);
        CustomerMemoryHitView hit = view.hits().get(0);

        assertThat(hit.answer())
                .as("the operator's own approved reply is the context worth reusing")
                .contains("시공 면을 먼저 닦아 주세요");
        assertThat(view.toString())
                .as("the customer's question is read on the authorized detail screen, never here")
                .doesNotContain(ADHESION);
        assertThat(hit.signatureKey()).as("closed vocabulary is what identifies the precedent")
                .isNotNull();
    }

    @Test
    @DisplayName("an empty index says 'cannot tell', not 'never happened'")
    void anEmptyIndexIsUncertainNotCalm() {
        CustomerMemorySearchView view = query.search(org, "접착:탈락", null, null, null, 5);

        assertThat(view.hits()).isEmpty();
        assertThat(view.coverage().coverage())
                .as("an org whose history was never indexed makes every inquiry look brand new — "
                        + "which is the retrieval-shaped version of the false calm the attention "
                        + "surface already guards")
                .isEqualTo(AttentionCoverage.UNCERTAIN_UNSUPPORTED_CHANNEL);
    }

    @Test
    @DisplayName("an inquiry that was never indexed is uncertain, not empty-and-fine")
    void anUnindexedInquiryIsUncertain() {
        indexedInquiry("접착 문의", ADHESION, "ANSWERED", "2026-07-01");
        Inquiry never = rawInquiry("색상 문의", "색이 사진과 다릅니다", "UNANSWERED", "2026-08-20");

        CustomerMemorySearchView view = query.recallForInquiry(org, never.getId(), 5);

        assertThat(view.hits()).isEmpty();
        assertThat(view.coverage().isUncertain())
                .as("we did not look and find nothing; we could not look")
                .isTrue();
    }

    @Test
    @DisplayName("a cue with neither signature nor topic returns nothing, never the whole index")
    void anEmptyCueReturnsNothing() {
        indexedInquiry("접착 문의", ADHESION, "ANSWERED", "2026-07-01");

        assertThat(query.search(org, null, null, null, null, 5).hits())
                .as("'find things like this' with nothing to be like must be empty, not everything")
                .isEmpty();
    }

    @Test
    @DisplayName("recall never crosses an org boundary")
    void recallIsOrgScoped() {
        UUID otherOrg = UUID.randomUUID();
        Inquiry theirs = rawInquiry("접착 문의", ADHESION, "ANSWERED", "2026-07-01");
        theirs.setOrgId(otherOrg);
        inquiries.save(theirs);
        indexer.indexInquiries(otherOrg, List.of(theirs.getId()));

        assertThat(query.search(org, "접착:탈락", null, null, null, 5).hits())
                .as("another tenant's precedents are not precedents")
                .isEmpty();
    }

    /* ───────────────────────────── fixtures ───────────────────────────── */

    private Inquiry indexedInquiry(String title, String body, String status, String day) {
        Inquiry inquiry = rawInquiry(title, body, status, day);
        // Analysis first, then index — the same order IngestFollowUp uses, because the index copies
        // the topic off the analysis row.
        new ItemAnalysisService(inquiries, reviews, analyses, new RuleBasedInboxItemAnalyzer())
                .analyzeForSources(org, "INQUIRY", List.of(inquiry.getId()));
        indexer.indexInquiries(org, List.of(inquiry.getId()));
        return inquiry;
    }

    private Inquiry rawInquiry(String title, String body, String status, String day) {
        Inquiry inquiry = new Inquiry();
        inquiry.setOrgId(org);
        inquiry.setChannelId(channelId);
        inquiry.setTitle(title);
        inquiry.setBody(body);
        inquiry.setStatus(status);
        inquiry.setReceivedAt(Instant.parse(day + "T00:00:00Z"));
        return inquiries.save(inquiry);
    }

    private void answer(Inquiry inquiry, String comments) {
        InquiryWorkItem item = new InquiryWorkItem();
        item.setOrgId(org);
        item.setInquiryId(inquiry.getId());
        item.setSellerAccountId(UUID.randomUUID());
        item.setChannelId(channelId);
        item.setPhase(InquiryWorkItemPhase.OPEN);
        InquiryWorkItem saved = workItems.save(item);

        InquiryReplyDraft draft = new InquiryReplyDraft();
        draft.setId(UUID.randomUUID());
        draft.setOrgId(org);
        draft.setWorkItemId(saved.getId());
        draft.setVersion(1);
        draft.setAnswerStatus(1);
        draft.setTitle("[답변] " + inquiry.getTitle());
        draft.setComments(comments);
        draft.setContentFingerprint("fp-" + saved.getId());
        draft.setFingerprintAlgorithm("sha256");
        draft.setCreatedBy("operator");
        drafts.save(draft);
    }

    /** An index row written directly — the only way to hold the ranking tiers apart. */
    private UUID savedEntry(String signatureKey, String topic, boolean answered, String day) {
        CustomerMemoryEntry entry = new CustomerMemoryEntry();
        entry.setOrgId(org);
        entry.setEntryKind(CustomerMemoryKind.INQUIRY);
        entry.setSourceId(UUID.randomUUID());
        entry.setChannelId(channelId);
        entry.setTopic(topic);
        entry.setSignatureKey(signatureKey);
        entry.setOccurredOn(java.time.LocalDate.parse(day));
        entry.setAnswered(answered);
        return entries.save(entry).getSourceId();
    }

    private UUID seedChannel() {
        Channel channel = new Channel();
        channel.setCode("CAFE24");
        channel.setNameKo("카페24");
        channel.setStatus(ChannelStatus.CONNECTED);
        channel.setSupportsInquiry(true);
        channel.setSupportsReview(true);
        channel.setSupportsOrder(true);
        return channels.save(channel).getId();
    }
}
