package com.sellerops.inquiry.reply;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.reply.dto.ReplyDraftView;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemAuditRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import java.nio.charset.StandardCharsets;
import java.time.Instant;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.test.autoconfigure.jdbc.AutoConfigureTestDatabase;
import org.springframework.boot.test.autoconfigure.orm.jpa.DataJpaTest;
import org.springframework.dao.DataIntegrityViolationException;
import org.springframework.http.HttpStatus;
import org.springframework.test.context.ActiveProfiles;

/**
 * Append-only reply-draft persistence: versioning, optimistic concurrency, the
 * UTF-8 byte contract, canonical fingerprinting, tenant isolation, immutability, and
 * no content leakage into audit rows.
 */
@DataJpaTest
@AutoConfigureTestDatabase(replace = AutoConfigureTestDatabase.Replace.NONE)
@ActiveProfiles("test")
class InquiryReplyDraftServiceTest {

    @Autowired InquiryRepository inquiries;
    @Autowired InquiryWorkItemRepository workItems;
    @Autowired InquiryReplyDraftRepository drafts;
    @Autowired InquiryWorkItemAuditRepository audits;

    private InquiryReplyDraftService service;
    private final UUID org = UUID.randomUUID();
    private final UUID user = UUID.randomUUID();

    @BeforeEach
    void setUp() {
        service = new InquiryReplyDraftService(workItems, drafts);
    }

    private InquiryWorkItem seedProposed(UUID orgId) {
        Inquiry q = new Inquiry();
        q.setOrgId(orgId);
        q.setChannelId(UUID.randomUUID());
        q.setTitle("t");
        q.setBody("b");
        q.setStatus("UNANSWERED");
        q.setReceivedAt(Instant.parse("2026-06-27T00:00:00Z"));
        UUID inquiryId = inquiries.save(q).getId();

        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(orgId);
        wi.setInquiryId(inquiryId);
        wi.setSellerAccountId(UUID.randomUUID());
        wi.setChannelId(q.getChannelId());
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        return workItems.save(wi);
    }

    @Test
    void firstSaveIsVersionOneAndAnEditIncrementsTheVersion() {
        InquiryWorkItem wi = seedProposed(org);

        ReplyDraftView v1 = service.save(org, wi.getId(), user, "배송 안내", "내일 출고됩니다", 0);
        assertThat(v1.version()).isEqualTo(1);
        assertThat(v1.answerStatus()).isEqualTo(2);
        assertThat(v1.fingerprintAlgorithm()).isEqualTo("esm-answer-v1");

        ReplyDraftView v2 = service.save(org, wi.getId(), user, "배송 안내 (수정)", "오늘 출고되었습니다", 1);
        assertThat(v2.version()).isEqualTo(2);
        assertThat(drafts.countByWorkItemId(wi.getId())).isEqualTo(2);
    }

    @Test
    void staleBaseVersionIsRejectedWith409() {
        InquiryWorkItem wi = seedProposed(org);
        service.save(org, wi.getId(), user, "제목", "내용", 0); // head is now version 1

        assertThatThrownBy(() -> service.save(org, wi.getId(), user, "제목", "다른 내용", 0))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT));
        assertThat(drafts.countByWorkItemId(wi.getId())).isEqualTo(1);
    }

    @Test
    void identicalRetryIsIdempotentAndCreatesNoNewVersion() {
        InquiryWorkItem wi = seedProposed(org);
        ReplyDraftView first = service.save(org, wi.getId(), user, "제목", "내용", 0);

        // Retry the same save (same base, same content) — replay of the first request.
        ReplyDraftView retry = service.save(org, wi.getId(), user, "제목", "내용", 0);
        // Re-save identical content from the head (base == current version).
        ReplyDraftView resave = service.save(org, wi.getId(), user, "제목", "내용", 1);

        assertThat(retry.version()).isEqualTo(first.version());
        assertThat(resave.version()).isEqualTo(first.version());
        assertThat(retry.contentFingerprint()).isEqualTo(first.contentFingerprint());
        assertThat(drafts.countByWorkItemId(wi.getId())).isEqualTo(1);
    }

    @Test
    void concurrentIdenticalWriteResolvesToTheHeadIdempotently() {
        UUID wiId = UUID.randomUUID();
        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        InquiryWorkItemRepository wiRepo = mock(InquiryWorkItemRepository.class);
        when(wiRepo.findById(wiId)).thenReturn(Optional.of(wi));

        InquiryReplyDraftRepository draftRepo = mock(InquiryReplyDraftRepository.class);
        InquiryReplyDraft head = headWith("제목", "내용");
        // Precheck sees v0 (both racers did); the winner's row appears on re-resolve.
        when(draftRepo.findTopByWorkItemIdOrderByVersionDesc(wiId))
                .thenReturn(Optional.empty()).thenReturn(Optional.of(head));
        when(draftRepo.save(any())).thenThrow(new DataIntegrityViolationException("dup version"));

        ReplyDraftView v = new InquiryReplyDraftService(wiRepo, draftRepo)
                .save(org, wiId, user, "제목", "내용", 0);
        assertThat(v.version()).isEqualTo(1); // resolved to the winner, no error
    }

    @Test
    void concurrentDifferentWriteThatLostTheRaceConflicts() {
        UUID wiId = UUID.randomUUID();
        InquiryWorkItem wi = new InquiryWorkItem();
        wi.setOrgId(org);
        wi.setPhase(InquiryWorkItemPhase.PROPOSED);
        InquiryWorkItemRepository wiRepo = mock(InquiryWorkItemRepository.class);
        when(wiRepo.findById(wiId)).thenReturn(Optional.of(wi));

        InquiryReplyDraftRepository draftRepo = mock(InquiryReplyDraftRepository.class);
        InquiryReplyDraft head = headWith("다른 제목", "다른 내용"); // winner had different content
        when(draftRepo.findTopByWorkItemIdOrderByVersionDesc(wiId))
                .thenReturn(Optional.empty()).thenReturn(Optional.of(head));
        when(draftRepo.save(any())).thenThrow(new DataIntegrityViolationException("dup version"));

        assertThatThrownBy(() -> new InquiryReplyDraftService(wiRepo, draftRepo)
                .save(org, wiId, user, "제목", "내용", 0))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT));
    }

    private static InquiryReplyDraft headWith(String title, String comments) {
        InquiryReplyDraft d = new InquiryReplyDraft();
        d.setVersion(1);
        d.setAnswerStatus(2);
        d.setTitle(title);
        d.setComments(comments);
        d.setContentFingerprint(ReplyDraftFingerprint.of(title, comments));
        d.setFingerprintAlgorithm("esm-answer-v1");
        d.setCreatedAt(Instant.now());
        return d;
    }

    @Test
    void fingerprintIsDeterministicSensitiveAndBoundToTheStoredContent() {
        assertThat(ReplyDraftFingerprint.of("제목", "내용"))
                .isEqualTo(ReplyDraftFingerprint.of("제목", "내용"));
        assertThat(ReplyDraftFingerprint.of("제목", "내용"))
                .isNotEqualTo(ReplyDraftFingerprint.of("제목", "다른 내용"));

        InquiryWorkItem wi = seedProposed(org);
        ReplyDraftView v = service.save(org, wi.getId(), user, "제목", "내용", 0);
        assertThat(v.contentFingerprint()).isEqualTo(ReplyDraftFingerprint.of("제목", "내용"));
    }

    @Test
    void crlfAndOuterWhitespaceAreNormalizedBeforePersistAndFingerprint() {
        InquiryWorkItem crlf = seedProposed(org);
        ReplyDraftView a = service.save(org, crlf.getId(), user, "  제목  ", "줄1\r\n줄2\r\n", 0);
        assertThat(a.title()).isEqualTo("제목");
        assertThat(a.comments()).isEqualTo("줄1\n줄2");

        InquiryWorkItem lf = seedProposed(org);
        ReplyDraftView b = service.save(org, lf.getId(), user, "제목", "줄1\n줄2", 0);
        // Same normalized content ⇒ same fingerprint regardless of CRLF/whitespace.
        assertThat(a.contentFingerprint()).isEqualTo(b.contentFingerprint());
    }

    private static String korean(int chars) {
        return "가".repeat(chars); // each '가' is 3 UTF-8 bytes
    }

    @Test
    void koreanUtf8CommentsAllowed999And1000ButRejected1001() {
        String c999 = korean(333); // 999 bytes
        String c1000 = korean(333) + "a"; // 1000 bytes
        String c1001 = korean(333) + "aa"; // 1001 bytes
        assertThat(c999.getBytes(StandardCharsets.UTF_8).length).isEqualTo(999);
        assertThat(c1000.getBytes(StandardCharsets.UTF_8).length).isEqualTo(1000);
        assertThat(c1001.getBytes(StandardCharsets.UTF_8).length).isEqualTo(1001);

        assertThat(service.save(org, seedProposed(org).getId(), user, "제목", c999, 0).version()).isEqualTo(1);
        assertThat(service.save(org, seedProposed(org).getId(), user, "제목", c1000, 0).version()).isEqualTo(1);
        assertThatThrownBy(() -> service.save(org, seedProposed(org).getId(), user, "제목", c1001, 0))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
    }

    @Test
    void blankTitleOrCommentsAreRejected() {
        InquiryWorkItem wi = seedProposed(org);
        assertThatThrownBy(() -> service.save(org, wi.getId(), user, "   ", "내용", 0))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThatThrownBy(() -> service.save(org, wi.getId(), user, "제목", "\r\n \n", 0))
                .isInstanceOfSatisfying(ApiException.class, e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.BAD_REQUEST));
        assertThat(drafts.countByWorkItemId(wi.getId())).isZero();
    }

    @Test
    void onlyProposedItemsAcceptDrafts() {
        InquiryWorkItem wi = seedProposed(org);
        wi.setPhase(InquiryWorkItemPhase.OPEN);
        workItems.save(wi);
        assertThatThrownBy(() -> service.save(org, wi.getId(), user, "제목", "내용", 0))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.CONFLICT));
        assertThat(drafts.countByWorkItemId(wi.getId())).isZero();
    }

    @Test
    void isTenantIsolatedByOrg() {
        InquiryWorkItem wi = seedProposed(org);
        UUID otherOrg = UUID.randomUUID();
        assertThatThrownBy(() -> service.save(otherOrg, wi.getId(), user, "제목", "내용", 0))
                .isInstanceOfSatisfying(ApiException.class,
                        e -> assertThat(e.getStatus()).isEqualTo(HttpStatus.NOT_FOUND));
        assertThat(drafts.countByWorkItemId(wi.getId())).isZero();
    }

    @Test
    void priorVersionsAreImmutable() {
        InquiryWorkItem wi = seedProposed(org);
        ReplyDraftView v1 = service.save(org, wi.getId(), user, "제목1", "내용1", 0);
        service.save(org, wi.getId(), user, "제목2", "내용2", 1);

        InquiryReplyDraft stored1 = drafts.findByWorkItemIdAndVersion(wi.getId(), 1).orElseThrow();
        assertThat(stored1.getTitle()).isEqualTo("제목1");
        assertThat(stored1.getComments()).isEqualTo("내용1");
        assertThat(stored1.getContentFingerprint()).isEqualTo(v1.contentFingerprint());
        assertThat(drafts.findByWorkItemIdAndVersion(wi.getId(), 2).orElseThrow().getComments())
                .isEqualTo("내용2");
    }

    @Test
    void savingADraftWritesNoAuditRowAndLeaksNoTokenOrAuthor() {
        InquiryWorkItem wi = seedProposed(org);
        service.save(org, wi.getId(), user, "제목", "내용", 0);

        // No lifecycle audit is emitted for a draft save (seeded work item had none).
        assertThat(audits.countByWorkItemId(wi.getId())).isZero();

        InquiryReplyDraft d = drafts.findTopByWorkItemIdOrderByVersionDesc(wi.getId()).orElseThrow();
        // Actor tag is the seller user id only — no buyer/author/token material anywhere.
        assertThat(d.getCreatedBy()).isEqualTo("SELLER:" + user);
        String allFields = String.join("|", d.getTitle(), d.getComments(), d.getCreatedBy(),
                d.getContentFingerprint(), d.getFingerprintAlgorithm());
        assertThat(allFields).doesNotContain("token").doesNotContain("author").doesNotContain("messageNo");
    }
}
