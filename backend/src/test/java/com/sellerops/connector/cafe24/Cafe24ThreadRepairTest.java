package com.sellerops.connector.cafe24;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.DataOrigin;
import com.sellerops.ingest.canonical.SourceThreadRole;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.lifecycle.InquiryOperationalStateProjector;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.dismissal.DismissalManifest;
import java.nio.file.Files;
import java.nio.file.Path;
import java.time.Instant;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;
import org.junit.jupiter.api.io.TempDir;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * The repair of rows a live READ already judged: what it writes, what it refuses to write, and what
 * makes it write nothing at all.
 *
 * <p>The distinction under test throughout is the one the ledger has to keep: the seller dismissing a
 * customer's question, and the source saying there was no customer question. Both leave the queue
 * through the same terminal phase; only the disposition tells them apart, and only one of them can
 * ever arrive with an approval attached.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class Cafe24ThreadRepairTest {

    private static final int BOARD = 6;
    private static final String COMMAND = "thread-repair:test";

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;

    private final UUID org = UUID.randomUUID();
    private final UUID account = UUID.randomUUID();

    private UUID channelId;
    private Cafe24ThreadRepair repair;

    @BeforeEach
    void setUp() {
        Channel channel = new Channel();
        channel.setCode("CAFE24");
        channel.setNameKo("카페24");
        channel.setStatus(ChannelStatus.CONNECTED);
        channelId = channels.findByCode("CAFE24").map(Channel::getId)
                .orElseGet(() -> channels.save(channel).getId());
        repair = new Cafe24ThreadRepair(inquiries, workItems, audits, channels,
                new InquiryOperationalStateProjector(), txManager);
    }

    @Test
    @DisplayName("the reply leaves current truth, keeps its body, and names the parent it hangs off")
    void aProvenReplyIsRecordedAndExcluded() {
        Inquiry row = storeUnanswered(500L);
        openWorkItem(row);

        Cafe24ThreadRepair.Result result = repair.repair(org, account, BOARD,
                List.of(new Cafe24ThreadRepair.Observation(500L, 499L)), COMMAND, false);

        assertThat(result.aborted()).isFalse();
        assertThat(result.drifted()).isZero();
        assertThat(result.rolesWritten()).isEqualTo(1);
        Inquiry after = inquiries.findById(row.getId()).orElseThrow();
        assertThat(after.threadRole()).isEqualTo(SourceThreadRole.REPLY);
        assertThat(after.getThreadParentExternalId()).isEqualTo("cafe24:b6:a499");
        assertThat(after.getOperationalState()).isEqualTo(InquiryOperationalState.EXCLUDED_THREAD_REPLY);
        // Excluded is not deleted: the row, its text and its status are all still there.
        assertThat(after.getBody()).isEqualTo("본문");
        assertThat(after.getStatus()).isEqualTo("UNANSWERED");
        assertThat(inquiries.findById(row.getId())).isPresent();
    }

    @Test
    @DisplayName("the work item ends in DISMISSED — never COMPLETED, because nothing was answered")
    void theWorkItemIsDismissedNotCompleted() {
        Inquiry row = storeUnanswered(501L);
        openWorkItem(row);

        repair.repair(org, account, BOARD,
                List.of(new Cafe24ThreadRepair.Observation(501L, 499L)), COMMAND, false);

        InquiryWorkItem item = workItems.findByInquiryId(row.getId()).orElseThrow();
        assertThat(item.getPhase()).isEqualTo(InquiryWorkItemPhase.DISMISSED);
        assertThat(item.getPhase()).isNotEqualTo(InquiryWorkItemPhase.COMPLETED);
        assertThat(item.getDisposition())
                .as("a data correction is not the seller calling something spam")
                .isEqualTo(InquiryWorkItemDisposition.SOURCE_THREAD_REPLY)
                .isNotEqualTo(InquiryWorkItemDisposition.SPAM);
    }

    @Test
    @DisplayName("the audit records the phase the item was really in, and points at no approval")
    void theAuditIsHonestAboutWhereItCameFrom() {
        Inquiry row = storeUnanswered(502L);
        InquiryWorkItem item = openWorkItem(row);
        item.setPhase(InquiryWorkItemPhase.PROPOSED);
        workItems.save(item);

        repair.repair(org, account, BOARD,
                List.of(new Cafe24ThreadRepair.Observation(502L, 499L)), COMMAND, false);

        InquiryWorkItemAudit audit = audits.findAll().stream()
                .filter(a -> a.getWorkItemId().equals(item.getId()))
                .filter(a -> a.getEventType() == InquiryWorkItemEvent.WORK_ITEM_DISMISSED)
                .findFirst().orElseThrow();
        assertThat(audit.getPhaseFrom())
                .as("this set is not all OPEN; rounding that off would record something that did not happen")
                .isEqualTo(InquiryWorkItemPhase.PROPOSED);
        assertThat(audit.getPhaseTo()).isEqualTo(InquiryWorkItemPhase.DISMISSED);
        assertThat(audit.getDismissalBatchId())
                .as("there is no approved batch behind a data correction")
                .isNull();
        assertThat(audit.getActor())
                .isEqualTo("SYSTEM:THREAD_RECLASSIFICATION")
                .doesNotContain("OPERATOR");
    }

    @Test
    @DisplayName("a dismissed reply can no longer be proposed, drafted, or published")
    void theContaminatedProposalBecomesUnexecutableWithoutBeingDeleted() {
        Inquiry row = storeUnanswered(503L);
        InquiryWorkItem item = openWorkItem(row);
        item.setPhase(InquiryWorkItemPhase.PROPOSED);
        workItems.save(item);

        repair.repair(org, account, BOARD,
                List.of(new Cafe24ThreadRepair.Observation(503L, 499L)), COMMAND, false);

        InquiryWorkItem after = workItems.findByInquiryId(row.getId()).orElseThrow();
        // The three seams that carry an inquiry towards a sent reply each gate on a phase this item
        // no longer has: proposal generation on OPEN, draft edit and publish on PROPOSED.
        assertThat(after.getPhase()).isNotIn(InquiryWorkItemPhase.OPEN, InquiryWorkItemPhase.PROPOSED);
        // And the work item itself is still there — invalidation, not deletion.
        assertThat(workItems.findById(item.getId())).isPresent();
    }

    @Test
    @DisplayName("one row that is no longer what the READ saw stops the whole repair")
    void driftAbortsEverythingAndWritesNothing() {
        Inquiry keep = storeUnanswered(504L);
        openWorkItem(keep);
        Inquiry answeredSince = storeUnanswered(505L);
        answeredSince.setStatus("ANSWERED");
        inquiries.save(answeredSince);

        Cafe24ThreadRepair.Result result = repair.repair(org, account, BOARD,
                List.of(new Cafe24ThreadRepair.Observation(504L, 499L),
                        new Cafe24ThreadRepair.Observation(505L, 499L)), COMMAND, false);

        assertThat(result.aborted()).isTrue();
        assertThat(result.drifted()).isEqualTo(1);
        assertThat(result.rolesWritten()).isZero();
        assertThat(inquiries.findById(keep.getId()).orElseThrow().threadRole())
                .as("a partial repair would leave the seller's numbers in a state no record describes")
                .isNull();
        assertThat(workItems.findByInquiryId(keep.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.OPEN);
    }

    @Test
    @DisplayName("a row the seller dismissed as spam is drift, not something to quietly overwrite")
    void aSellerDecisionIsNeverOverwritten() {
        Inquiry spam = storeUnanswered(506L);
        spam.setOperationalState(InquiryOperationalState.EXCLUDED_SPAM);
        inquiries.save(spam);

        Cafe24ThreadRepair.Result result = repair.repair(org, account, BOARD,
                List.of(new Cafe24ThreadRepair.Observation(506L, 499L)), COMMAND, false);

        assertThat(result.aborted()).isTrue();
        assertThat(inquiries.findById(spam.getId()).orElseThrow().getOperationalState())
                .isEqualTo(InquiryOperationalState.EXCLUDED_SPAM);
    }

    @Test
    @DisplayName("a dry run reports what would change and changes nothing")
    void aDryRunWritesNothing() {
        Inquiry row = storeUnanswered(507L);
        openWorkItem(row);

        Cafe24ThreadRepair.Result result = repair.repair(org, account, BOARD,
                List.of(new Cafe24ThreadRepair.Observation(507L, 499L)), COMMAND, true);

        assertThat(result.rolesWritten()).isEqualTo(1);
        assertThat(result.itemsDismissed()).isEqualTo(1);
        assertThat(inquiries.findById(row.getId()).orElseThrow().threadRole()).isNull();
        assertThat(workItems.findByInquiryId(row.getId()).orElseThrow().getPhase())
                .isEqualTo(InquiryWorkItemPhase.OPEN);
    }

    @Test
    @DisplayName("running it twice writes nothing the second time")
    void theRepairIsIdempotent() {
        Inquiry row = storeUnanswered(508L);
        openWorkItem(row);
        List<Cafe24ThreadRepair.Observation> manifest =
                List.of(new Cafe24ThreadRepair.Observation(508L, 499L));

        repair.repair(org, account, BOARD, manifest, COMMAND, false);
        Cafe24ThreadRepair.Result second = repair.repair(org, account, BOARD, manifest, COMMAND, false);

        assertThat(second.aborted()).isFalse();
        assertThat(second.alreadyRepaired()).isEqualTo(1);
        assertThat(second.rolesWritten()).isZero();
        assertThat(second.auditsWritten()).isZero();
    }

    @Test
    @DisplayName("a row on another org's connection is never touched by this org's repair")
    void anotherAccountIsOutOfReach() {
        Inquiry foreign = storeUnanswered(509L);
        foreign.setSellerAccountId(UUID.randomUUID());
        inquiries.save(foreign);

        Cafe24ThreadRepair.Result result = repair.repair(org, account, BOARD,
                List.of(new Cafe24ThreadRepair.Observation(509L, 499L)), COMMAND, false);

        assertThat(result.aborted()).isTrue();
        assertThat(inquiries.findById(foreign.getId()).orElseThrow().threadRole()).isNull();
    }

    @Test
    @DisplayName("the correction disposition can never arrive wearing an operator's approval")
    void aDataCorrectionCannotBeSignedOffAsADecision(@TempDir Path dir) {
        String json = """
                {"approved":true,"approved_by":"op","approved_at":"2026-08-25T00:00:00+09:00",
                 "sellerAccountId":"%s","disposition":"SOURCE_THREAD_REPLY",
                 "commandId":"c1","workItemIds":["%s"]}
                """.formatted(UUID.randomUUID(), UUID.randomUUID());

        assertThatThrownBy(() -> DismissalManifest.parse(json, 500))
                .hasMessageContaining("SPAM");
        assertThat(InquiryWorkItemDisposition.SOURCE_THREAD_REPLY.sellerDecision())
                .isFalse();
        assertThat(InquiryWorkItemDisposition.SPAM.sellerDecision()).isTrue();
    }

    @Test
    @DisplayName("a manifest that is not exactly readable is not a manifest")
    void theManifestFailsClosed(@TempDir Path dir) throws Exception {
        assertThatThrownBy(() -> Cafe24ThreadRepair.readManifest(write(dir, "bad.tsv", "500\t499\t3")))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> Cafe24ThreadRepair.readManifest(write(dir, "dup.tsv", "500\t499\n500\t498")))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> Cafe24ThreadRepair.readManifest(write(dir, "self.tsv", "500\t500")))
                .isInstanceOf(IllegalStateException.class);
        assertThatThrownBy(() -> Cafe24ThreadRepair.readManifest(write(dir, "empty.tsv", "# 주석뿐\n")))
                .isInstanceOf(IllegalStateException.class);
        assertThat(Cafe24ThreadRepair.readManifest(write(dir, "ok.tsv", "# 관측\n500\t499\n")))
                .containsExactly(new Cafe24ThreadRepair.Observation(500L, 499L));
        // The hash is of the file's exact bytes, so an edited manifest is a different manifest.
        assertThat(Cafe24ThreadRepair.hash(write(dir, "a.tsv", "500\t499\n")))
                .isNotEqualTo(Cafe24ThreadRepair.hash(write(dir, "b.tsv", "500\t498\n")));
    }

    @Test
    @DisplayName("nothing this repair logs or returns can carry a body, a title or a writer")
    void theOutcomeIsCountsOnly() {
        for (var component : Cafe24ThreadRepair.Result.class.getRecordComponents()) {
            assertThat(component.getType())
                    .as("%s", component.getName())
                    .isIn(int.class, boolean.class);
        }
    }

    @Test
    @DisplayName("the queue the Agent reads never hands back a repaired reply — even before the phase moved")
    void theAgentQueueStopsSeeingIt() {
        Inquiry row = storeUnanswered(510L);
        InquiryWorkItem item = openWorkItem(row);
        assertThat(workItems.findOperationalByOrgIdAndPhase(org, InquiryWorkItemPhase.OPEN,
                Pageable.unpaged()).getContent())
                .as("before the repair it is exactly the row the seller is told to answer")
                .extracting(InquiryWorkItem::getId).contains(item.getId());

        repair.repair(org, account, BOARD,
                List.of(new Cafe24ThreadRepair.Observation(510L, 499L)), COMMAND, false);

        // Two independent reasons it is gone, and either alone would be enough: the phase is no
        // longer OPEN, and the queue's own gate refuses a row outside current truth. The Agent, the
        // Inbox, the Dashboard and the coverage audit all read through that same gate.
        assertThat(workItems.findOperationalByOrgIdAndPhase(org, InquiryWorkItemPhase.OPEN,
                Pageable.unpaged()).getContent())
                .extracting(InquiryWorkItem::getId).doesNotContain(item.getId());
        assertThat(inquiries.findActiveUnansweredForAccount(org, account))
                .extracting(Inquiry::getId).doesNotContain(row.getId());
        assertThat(inquiries.findRecentActive(org, Pageable.unpaged()))
                .extracting(Inquiry::getId).doesNotContain(row.getId());
        assertThat(inquiries.findForMemoryIndexing(org, Pageable.unpaged()))
                .as("customer memory indexes current truth, so it stops indexing this too")
                .extracting(Inquiry::getId).doesNotContain(row.getId());
    }

    @Test
    @DisplayName("a reply is never a source for Answer Memory, however it was excluded")
    void answerMemoryNeverSeesIt() {
        Inquiry row = storeUnanswered(511L);
        openWorkItem(row);

        repair.repair(org, account, BOARD,
                List.of(new Cafe24ThreadRepair.Observation(511L, 499L)), COMMAND, false);

        Inquiry after = inquiries.findById(row.getId()).orElseThrow();
        assertThat(after.getAnswerBody())
                .as("the reply's own text is an answer only if the SHOP wrote it, and that is unproven")
                .isNull();
        assertThat(after.getAnsweredAt()).isNull();
        assertThat(after.getStatus()).isEqualTo("UNANSWERED");
        assertThat(inquiries.findAnsweredWithAnswerBody(org))
                .extracting(Inquiry::getId).doesNotContain(row.getId());
    }

    private static Path write(Path dir, String name, String content) throws Exception {
        Path path = dir.resolve(name);
        Files.writeString(path, content);
        return path;
    }

    private Inquiry storeUnanswered(long articleNo) {
        Inquiry row = new Inquiry();
        row.setOrgId(org);
        row.setChannelId(channelId);
        row.setSellerAccountId(account);
        row.setDataOrigin(DataOrigin.REAL);
        row.setExternalId("cafe24:b" + BOARD + ":a" + articleNo);
        row.setTitle("제목");
        row.setBody("본문");
        row.setStatus("UNANSWERED");
        row.setReceivedAt(Instant.parse("2026-06-20T01:00:00Z"));
        row.setOperationalState(InquiryOperationalState.ACTIVE);
        return inquiries.save(row);
    }

    private InquiryWorkItem openWorkItem(Inquiry row) {
        InquiryWorkItem item = new InquiryWorkItem();
        item.setOrgId(org);
        item.setInquiryId(row.getId());
        item.setSellerAccountId(account);
        item.setChannelId(channelId);
        item.setPhase(InquiryWorkItemPhase.OPEN);
        return workItems.save(item);
    }
}
