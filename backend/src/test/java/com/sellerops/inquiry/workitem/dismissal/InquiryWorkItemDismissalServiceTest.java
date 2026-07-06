package com.sellerops.inquiry.workitem.dismissal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAudit;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemDisposition;
import com.sellerops.inquiry.workitem.InquiryWorkItemEvent;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.DismissalCommand;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.DismissalCounts;
import com.sellerops.inquiry.workitem.dismissal.InquiryWorkItemDismissalService.ExecuteResult;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.lang.reflect.Method;
import java.time.Instant;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.data.domain.Pageable;
import org.springframework.test.context.ActiveProfiles;
import org.springframework.transaction.PlatformTransactionManager;

/**
 * Audited bulk dismissal over the real (H2) DB. Proves the all-or-nothing OPEN →
 * DISMISSED(SPAM) transition persists a durable batch ledger with the item transitions
 * and batch-linked audits atomically, preserves the Inquiry, excludes dismissed items
 * from the OPEN queue, enforces tenant/account/channel isolation and the hard cap, and
 * that command idempotency is anchored on (org, commandId) + manifest hash. Only
 * {@code preview} and {@code executeAllOrNothing} are exposed — no partial path.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryWorkItemDismissalServiceTest {

    private static final String APPROVED_BY = "operator@sellerops.ai";
    private static final String APPROVED_AT = "2026-07-05T00:00:00Z"; // past, offset-bearing
    private static final String EXECUTED_BY = "OPERATOR:test-user";

    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryWorkItemAuditRepository audits;
    @Autowired InquiryWorkItemDismissalBatchRepository batches;
    @Autowired InquiryRepository inquiries;
    @Autowired SellerAccountRepository accounts;
    @Autowired ChannelRepository channels;
    @Autowired PlatformTransactionManager txManager;

    private InquiryWorkItemDismissalService service;

    private final UUID org = UUID.randomUUID();
    private UUID cafe24ChannelId;
    private UUID esmChannelId;
    private UUID cafe24Account;

    @BeforeEach
    void setUp() {
        service = new InquiryWorkItemDismissalService(
                workItems, audits, batches, accounts, channels, txManager);
        cafe24ChannelId = channel("CAFE24", "카페24").getId();
        esmChannelId = channel("GMARKET", "ESM").getId();
        cafe24Account = account(org, cafe24ChannelId).getId();
    }

    // ---- helpers ---------------------------------------------------------------

    private Channel channel(String code, String nameKo) {
        Channel c = new Channel();
        c.setCode(code);
        c.setNameKo(nameKo);
        c.setStatus(ChannelStatus.AVAILABLE);
        c.setSupportsInquiry(true);
        return channels.save(c);
    }

    private SellerAccount account(UUID orgId, UUID channelId) {
        SellerAccount a = new SellerAccount();
        a.setOrgId(orgId);
        a.setChannelId(channelId);
        a.setConnectionStatus(ChannelStatus.CONNECTED);
        a.setFileUpload(false);
        return accounts.save(a);
    }

    private UUID workItem(UUID orgId, UUID accountId, UUID channelId, InquiryWorkItemPhase phase) {
        Inquiry q = new Inquiry();
        q.setOrgId(orgId);
        q.setChannelId(channelId);
        q.setBody("본문");
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2025-05-01T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem w = new InquiryWorkItem();
        w.setOrgId(orgId);
        w.setInquiryId(inquiryId);
        w.setSellerAccountId(accountId);
        w.setChannelId(channelId);
        w.setPhase(phase);
        return workItems.save(w).getId();
    }

    private UUID openCafe24Item() {
        return workItem(org, cafe24Account, cafe24ChannelId, InquiryWorkItemPhase.OPEN);
    }

    private DismissalCommand cmd(String commandId, List<UUID> ids) {
        return new DismissalCommand(org, cafe24Account, InquiryWorkItemDisposition.SPAM,
                commandId, EXECUTED_BY, ids);
    }

    private ExecuteResult exec(String commandId, List<UUID> ids) {
        return service.executeAllOrNothing(cmd(commandId, ids), "CONFIRM_DISMISS", APPROVED_BY, APPROVED_AT);
    }

    private List<InquiryWorkItem> openQueue(UUID orgId) {
        return workItems.findByOrgIdAndPhase(orgId, InquiryWorkItemPhase.OPEN, Pageable.unpaged())
                .getContent();
    }

    private long dismissalAudits(UUID workItemId) {
        return audits.findByWorkItemIdOrderByCreatedAtAsc(workItemId).stream()
                .filter(a -> a.getEventType() == InquiryWorkItemEvent.WORK_ITEM_DISMISSED).count();
    }

    // ---- successful execute: batch + linked audits + atomicity -----------------

    @Test
    void executePersistsOneBatchAndLinksEveryDismissalAudit() {
        UUID a = openCafe24Item();
        UUID b = openCafe24Item();
        UUID c = openCafe24Item();

        ExecuteResult r = exec("chunk-1", List.of(a, b, c));

        assertThat(r.idempotentReplay()).isFalse();
        assertThat(r.counts().executed()).isTrue();
        assertThat(r.counts().dismissed()).isEqualTo(3);

        InquiryWorkItemDismissalBatch batch =
                batches.findByOrgIdAndCommandId(org, "chunk-1").orElseThrow();
        assertThat(batch.getId()).isEqualTo(r.batchId());
        assertThat(batch.getItemCount()).isEqualTo(3);
        assertThat(batch.getStatus()).isEqualTo(DismissalBatchStatus.EXECUTED);

        for (UUID id : List.of(a, b, c)) {
            InquiryWorkItem w = workItems.findById(id).orElseThrow();
            assertThat(w.getPhase()).isEqualTo(InquiryWorkItemPhase.DISMISSED);
            assertThat(w.getDisposition()).isEqualTo(InquiryWorkItemDisposition.SPAM);
            List<InquiryWorkItemAudit> dis = audits.findByWorkItemIdOrderByCreatedAtAsc(id).stream()
                    .filter(x -> x.getEventType() == InquiryWorkItemEvent.WORK_ITEM_DISMISSED).toList();
            assertThat(dis).hasSize(1);
            // Every dismissal audit is linked to the batch.
            assertThat(dis.get(0).getDismissalBatchId()).isEqualTo(batch.getId());
            assertThat(dis.get(0).getActor()).isEqualTo(EXECUTED_BY);
            assertThat(dis.get(0).getDisposition()).isEqualTo(InquiryWorkItemDisposition.SPAM);
        }
    }

    @Test
    void approvalMetadataAndAuthenticatedExecutorAreBothDurable() {
        UUID a = openCafe24Item();
        exec("chunk-1", List.of(a));

        InquiryWorkItemDismissalBatch batch =
                batches.findByOrgIdAndCommandId(org, "chunk-1").orElseThrow();
        // Approval metadata (sign-off).
        assertThat(batch.getApprovedBy()).isEqualTo(APPROVED_BY);
        assertThat(batch.getApprovedAt()).isEqualTo(Instant.parse(APPROVED_AT));
        // Authenticated executor + server time, kept distinct from approval.
        assertThat(batch.getExecutedBy()).isEqualTo(EXECUTED_BY);
        assertThat(batch.getExecutedAt()).isNotNull();
        assertThat(batch.getManifestHash()).isNotBlank();
    }

    @Test
    void inquiryRowIsUnchangedByDismissal() {
        UUID id = openCafe24Item();
        UUID inquiryId = workItems.findById(id).orElseThrow().getInquiryId();
        Inquiry before = inquiries.findById(inquiryId).orElseThrow();
        String status = before.getStatus();
        String body = before.getBody();

        exec("chunk-1", List.of(id));

        Inquiry after = inquiries.findById(inquiryId).orElseThrow();
        assertThat(after.getStatus()).isEqualTo(status); // still UNANSWERED — never "answered"
        assertThat(after.getBody()).isEqualTo(body);
    }

    @Test
    void openQueueExcludesTheDismissedItem() {
        UUID id = openCafe24Item();
        assertThat(openQueue(org)).extracting(InquiryWorkItem::getId).contains(id);

        exec("chunk-1", List.of(id));

        assertThat(openQueue(org)).extracting(InquiryWorkItem::getId).doesNotContain(id);
    }

    // ---- all-or-nothing gate ---------------------------------------------------

    @Test
    void oneWrongPhaseAbortsWholeChunkWithZeroMutationsAndNoBatch() {
        UUID good = openCafe24Item();
        UUID wrongPhase = workItem(org, cafe24Account, cafe24ChannelId, InquiryWorkItemPhase.PROPOSED);

        assertThatThrownBy(() -> exec("chunk-1", List.of(good, wrongPhase)))
                .isInstanceOf(ApiException.class);

        assertThat(workItems.findById(good).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(dismissalAudits(good)).isZero();
        assertThat(batches.findByOrgIdAndCommandId(org, "chunk-1")).isEmpty();
    }

    @Test
    void oneForeignIdAbortsWholeChunkWithZeroMutationsAndNoBatch() {
        UUID good = openCafe24Item();
        UUID otherAccount = account(org, cafe24ChannelId).getId();
        UUID foreign = workItem(org, otherAccount, cafe24ChannelId, InquiryWorkItemPhase.OPEN);

        assertThatThrownBy(() -> exec("chunk-1", List.of(good, foreign)))
                .isInstanceOf(ApiException.class);

        assertThat(workItems.findById(good).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(batches.findByOrgIdAndCommandId(org, "chunk-1")).isEmpty();
    }

    @Test
    void esmAndCompletedCafe24ItemsInAMixedChunkAbortTheWholeChunk() {
        UUID esmAccount = account(org, esmChannelId).getId();
        UUID esmItem = workItem(org, esmAccount, esmChannelId, InquiryWorkItemPhase.OPEN);
        UUID completed = workItem(org, cafe24Account, cafe24ChannelId, InquiryWorkItemPhase.COMPLETED);
        UUID spam = openCafe24Item();

        assertThatThrownBy(() -> exec("chunk-1", List.of(esmItem, completed, spam)))
                .isInstanceOf(ApiException.class);

        assertThat(workItems.findById(esmItem).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(workItems.findById(completed).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.COMPLETED);
        assertThat(workItems.findById(spam).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(batches.findByOrgIdAndCommandId(org, "chunk-1")).isEmpty();
    }

    // ---- ledger-anchored idempotency -------------------------------------------

    @Test
    void sameCommandSameManifestIsIdempotentReplay() {
        UUID a = openCafe24Item();
        UUID b = openCafe24Item();
        exec("chunk-1", List.of(a, b));

        ExecuteResult second = exec("chunk-1", List.of(a, b));

        assertThat(second.idempotentReplay()).isTrue();
        assertThat(second.counts().dismissed()).isZero();
        assertThat(second.counts().alreadyDismissed()).isEqualTo(2);
        // No new batch, no second audit.
        assertThat(batches.findAll()).hasSize(1);
        assertThat(dismissalAudits(a)).isEqualTo(1);
        assertThat(dismissalAudits(b)).isEqualTo(1);
    }

    @Test
    void sameCommandDifferentWorkItemSetIsRejected() {
        UUID a = openCafe24Item();
        UUID b = openCafe24Item();
        exec("chunk-1", List.of(a));

        // Same commandId, different ids → different manifest hash → conflict, zero mutations.
        assertThatThrownBy(() -> exec("chunk-1", List.of(a, b)))
                .isInstanceOf(ApiException.class);

        assertThat(workItems.findById(b).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(batches.findByOrgIdAndCommandId(org, "chunk-1").orElseThrow().getItemCount()).isEqualTo(1);
    }

    @Test
    void sameCommandDifferentAccountOrApprovalMetadataIsRejected() {
        UUID a = openCafe24Item();
        exec("chunk-1", List.of(a));

        // Different account value in the command → different hash → conflict.
        DismissalCommand otherAccount = new DismissalCommand(org, UUID.randomUUID(),
                InquiryWorkItemDisposition.SPAM, "chunk-1", EXECUTED_BY, List.of(a));
        assertThatThrownBy(() ->
                service.executeAllOrNothing(otherAccount, "CONFIRM_DISMISS", APPROVED_BY, APPROVED_AT))
                .isInstanceOf(ApiException.class);

        // Different approval metadata (approvedBy) → different hash → conflict.
        assertThatThrownBy(() ->
                service.executeAllOrNothing(cmd("chunk-1", List.of(a)), "CONFIRM_DISMISS",
                        "someone-else@example.com", APPROVED_AT))
                .isInstanceOf(ApiException.class);
    }

    @Test
    void commandIdCanBeReusedIndependentlyByAnotherOrg() {
        UUID a = openCafe24Item();
        exec("shared-command", List.of(a));

        // A second org with its own account + item, reusing the SAME commandId string.
        UUID org2 = UUID.randomUUID();
        UUID account2 = account(org2, cafe24ChannelId).getId();
        UUID a2 = workItem(org2, account2, cafe24ChannelId, InquiryWorkItemPhase.OPEN);
        DismissalCommand c2 = new DismissalCommand(org2, account2, InquiryWorkItemDisposition.SPAM,
                "shared-command", "OPERATOR:org2", List.of(a2));

        ExecuteResult r2 = service.executeAllOrNothing(c2, "CONFIRM_DISMISS", APPROVED_BY, APPROVED_AT);

        assertThat(r2.idempotentReplay()).isFalse();
        assertThat(workItems.findById(a2).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.DISMISSED);
        assertThat(batches.findByOrgIdAndCommandId(org, "shared-command")).isPresent();
        assertThat(batches.findByOrgIdAndCommandId(org2, "shared-command")).isPresent();
    }

    // ---- fail-closed guards ----------------------------------------------------

    @Test
    void failsClosedWithoutConfirmation() {
        UUID a = openCafe24Item();
        assertThatThrownBy(() ->
                service.executeAllOrNothing(cmd("chunk-1", List.of(a)), "nope", APPROVED_BY, APPROVED_AT))
                .isInstanceOf(ApiException.class);
        assertThat(workItems.findById(a).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(batches.findByOrgIdAndCommandId(org, "chunk-1")).isEmpty();
    }

    @Test
    void malformedApprovedAtFailsClosed() {
        UUID a = openCafe24Item();
        // No offset (timezone-less) → rejected.
        assertThatThrownBy(() ->
                service.executeAllOrNothing(cmd("chunk-1", List.of(a)), "CONFIRM_DISMISS",
                        APPROVED_BY, "2026-07-05T00:00:00"))
                .isInstanceOf(ApiException.class);
        // Not a timestamp at all → rejected.
        assertThatThrownBy(() ->
                service.executeAllOrNothing(cmd("chunk-2", List.of(a)), "CONFIRM_DISMISS",
                        APPROVED_BY, "yesterday"))
                .isInstanceOf(ApiException.class);
        assertThat(workItems.findById(a).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
    }

    @Test
    void unreasonablyFutureApprovedAtFailsClosed() {
        UUID a = openCafe24Item();
        assertThatThrownBy(() ->
                service.executeAllOrNothing(cmd("chunk-1", List.of(a)), "CONFIRM_DISMISS",
                        APPROVED_BY, "2999-01-01T00:00:00Z"))
                .isInstanceOf(ApiException.class);
        assertThat(workItems.findById(a).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
    }

    @Test
    void duplicateIdsFailClosed() {
        UUID id = openCafe24Item();
        assertThatThrownBy(() -> exec("chunk-1", List.of(id, id))).isInstanceOf(ApiException.class);
        assertThat(workItems.findById(id).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
    }

    @Test
    void enforcesTheHardChunkCap() {
        List<UUID> tooMany = new ArrayList<>();
        for (int i = 0; i < InquiryWorkItemDismissalService.MAX_CHUNK + 1; i++) {
            tooMany.add(UUID.randomUUID());
        }
        assertThatThrownBy(() -> exec("chunk-1", tooMany)).isInstanceOf(ApiException.class);
    }

    // ---- classification via preview (zero writes) ------------------------------

    @Test
    void previewClassifiesWithoutWriting() {
        UUID eligible = openCafe24Item();
        UUID wrongPhase = workItem(org, cafe24Account, cafe24ChannelId, InquiryWorkItemPhase.PROPOSED);
        UUID missing = UUID.randomUUID();

        DismissalCounts out = service.preview(cmd("preview-1", List.of(eligible, wrongPhase, missing)));

        assertThat(out.executed()).isFalse();
        assertThat(out.eligible()).isEqualTo(1);
        assertThat(out.wrongPhase()).isEqualTo(1);
        assertThat(out.missing()).isEqualTo(1);
        // Nothing written.
        assertThat(workItems.findById(eligible).orElseThrow().getPhase()).isEqualTo(InquiryWorkItemPhase.OPEN);
        assertThat(batches.findAll()).isEmpty();
    }

    @Test
    void previewCreatesNoBatch() {
        UUID a = openCafe24Item();
        service.preview(cmd("preview-1", List.of(a)));
        assertThat(batches.findAll()).isEmpty();
    }

    // ---- no partial-execution path is publicly callable ------------------------

    @Test
    void noPublicPartialExecutionMethodExists() {
        for (Method m : InquiryWorkItemDismissalService.class.getMethods()) {
            // The only public mutation entry point is executeAllOrNothing; there must be
            // no public "execute"/partial method that mutates only the eligible subset.
            assertThat(m.getName())
                    .withFailMessage("unexpected public method: %s", m.getName())
                    .isNotEqualTo("execute");
        }
    }
}
