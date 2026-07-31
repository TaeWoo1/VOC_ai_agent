package com.sellerops.connector.cafe24.spike;

import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.connector.cafe24.spike.SpikeReplyTransport.ArticleObservation;
import com.sellerops.connector.cafe24.spike.SpikeReplyTransport.CommentDraft;
import com.sellerops.connector.cafe24.spike.SpikeReplyTransport.CommentObservation;
import java.security.SecureRandom;
import java.util.Arrays;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.concurrent.ConcurrentHashMap;

/**
 * The tested brain of the board-6 reply spike. It runs the ordered, fail-closed
 * gate chain (§3–§5 of the brief) and produces a sanitized {@link SpikeReplyResult}
 * plus one of the A/B/C {@link SpikeVerdict}s.
 *
 * <p><b>Never posts more than once, never PUTs, never retries.</b> The single
 * comment POST is guarded by: write-scope granted, board == 6, operator-confirmed
 * test article, validated content, a valid single-use approval, a pre-status of
 * raw {@code N}, and the absence of a prior spike comment. After the post it
 * verifies exactly one comment was created and observes the raw reply_status; any
 * surprise HALTs with no follow-up call. Idempotency is keyed by {@code commandId}:
 * a replay returns the prior result unchanged; the same id with a different payload
 * is rejected.
 *
 * <p>The engine holds an in-memory ledger and consumed-approval set — appropriate
 * for a single-operator spike run; it is not a distributed store.
 */
public class SpikeReplyEngine {

    private static final SecureRandom RANDOM = new SecureRandom();
    private static final char[] PASSWORD_ALPHABET =
            "ABCDEFGHJKLMNPQRSTUVWXYZabcdefghijkmnpqrstuvwxyz23456789".toCharArray();
    private static final int PASSWORD_LENGTH = 20;

    private final SpikeReplyTransport transport;
    /** The single-use approval value the operator supplies out-of-band for this run. */
    private final String expectedApproval;

    private final Map<String, LedgerEntry> ledger = new ConcurrentHashMap<>();
    private final Set<String> consumedApprovals = ConcurrentHashMap.newKeySet();

    public SpikeReplyEngine(SpikeReplyTransport transport, String expectedApproval) {
        this.transport = transport;
        this.expectedApproval = expectedApproval;
    }

    /** Dry-run: describe the intended action with ZERO external calls. */
    public SpikeReplyPlan plan(SpikeReplyCommand cmd) {
        String note;
        if (cmd.boardNo() != Cafe24Boards.PRODUCT_INQUIRY_BOARD_NO) {
            note = "WRONG_BOARD";
        } else if (!cmd.operatorTestInquiryConfirmed()) {
            note = "NOT_TEST_ARTICLE";
        } else {
            note = "BOARD_OK";
        }
        return new SpikeReplyPlan(cmd.boardNo(), cmd.articleNo(), cmd.contentSource(),
                SpikeContentGuard.SPIKE_WRITER_MARKER, true, note);
    }

    /**
     * The full gated flow. Never throws for a domain condition — every refusal/halt
     * is a sanitized result. Only a programming error (null args) would throw.
     */
    public synchronized SpikeReplyResult execute(SpikeAuthorization auth, SpikeReplyCommand cmd) {
        // 0. Idempotency: replay identical, reject conflicting, before any work.
        LedgerEntry prior = ledger.get(cmd.commandId());
        if (prior != null) {
            if (prior.fingerprint().equals(cmd.payloadFingerprint())) {
                return prior.result().withReplay();
            }
            return base(cmd, auth).outcome(SpikeReplyOutcome.REFUSED_COMMAND_CONFLICT).build();
        }

        // 1. Dry-run short-circuit: no network even if execute() is called with it.
        if (cmd.dryRun()) {
            return base(cmd, auth).outcome(SpikeReplyOutcome.DRY_RUN_PLANNED).build();
        }

        // 2. Write scope — the one refusal that is itself a capability verdict (C).
        if (!auth.writeCommunityGranted()) {
            return base(cmd, auth)
                    .outcome(SpikeReplyOutcome.REFUSED_WRITE_SCOPE_NOT_GRANTED)
                    .verdict(SpikeVerdict.GUIDED_HANDOFF_REMAINS)
                    .build();
        }

        // 3. Board must be 6.
        if (cmd.boardNo() != Cafe24Boards.PRODUCT_INQUIRY_BOARD_NO) {
            return base(cmd, auth).outcome(SpikeReplyOutcome.REFUSED_WRONG_BOARD).build();
        }

        // 4. Operator-owned test article assertion.
        if (!cmd.operatorTestInquiryConfirmed()) {
            return base(cmd, auth).outcome(SpikeReplyOutcome.REFUSED_NOT_TEST_ARTICLE).build();
        }

        // 5. Resolve + validate content (fail-closed on operator PII/shape).
        String content;
        try {
            content = SpikeContentGuard.resolveContent(cmd.contentSource(), cmd.operatorContent());
        } catch (SpikeContentGuard.SpikeContentRejectedException e) {
            return base(cmd, auth).outcome(SpikeReplyOutcome.REFUSED_CONTENT_REJECTED).build();
        }

        // 6. Single-use approval — checked BEFORE any network call.
        boolean approvalValid = expectedApproval != null && !expectedApproval.isBlank()
                && expectedApproval.equals(cmd.approvalToken())
                && !consumedApprovals.contains(cmd.approvalToken());
        if (!approvalValid) {
            return base(cmd, auth).outcome(SpikeReplyOutcome.REFUSED_MISSING_APPROVAL).build();
        }

        // 7. Read + gate on the current state (read scope). Transport failure => HALT.
        ArticleObservation before;
        List<CommentObservation> commentsBefore;
        try {
            before = transport.observeArticle(auth.mallId(), auth.accessToken(),
                    cmd.boardNo(), cmd.articleNo());
            commentsBefore = transport.listComments(auth.mallId(), auth.accessToken(),
                    cmd.boardNo(), cmd.articleNo());
        } catch (SpikeTransportException e) {
            return base(cmd, auth).approvalPresent(true)
                    .outcome(SpikeReplyOutcome.HALT_TRANSPORT_ERROR).build();
        }

        CommunityReplyStatus preStatus = CommunityReplyStatus.normalize(before.rawReplyStatus());
        String preToken = SpikeReplyResult.tokenClass(before.rawReplyStatus());
        Builder b = base(cmd, auth).approvalPresent(true)
                .preStatus(preStatus, preToken)
                .commentsBefore(commentsBefore.size());

        // 7a. Pre-status must be raw N. Anything else (P/C/blank/unknown) — refuse, no post.
        if (!"N".equals(preToken)) {
            return b.outcome(SpikeReplyOutcome.REFUSED_PRECONDITION_STATUS_NOT_N).build();
        }

        // 7b. Duplicate protection: our own prior comment already present — refuse.
        long priorSpikeComments = countSpikeComments(commentsBefore);
        if (priorSpikeComments > 0) {
            return b.existingSpikeCommentFound(true)
                    .outcome(SpikeReplyOutcome.REFUSED_DUPLICATE_EXISTING_COMMENT).build();
        }

        // 8. Consume the single-use approval and POST exactly once.
        consumedApprovals.add(cmd.approvalToken());
        char[] password = randomPassword();
        CommentDraft draft = new CommentDraft(content, SpikeContentGuard.SPIKE_WRITER_MARKER, password);
        try {
            transport.createComment(auth.mallId(), auth.accessToken(),
                    cmd.boardNo(), cmd.articleNo(), draft);
        } catch (SpikeCommentRejectedException e) {
            // Field mismatch / rejection — a capability signal (verdict C).
            return remember(cmd, b.verdict(SpikeVerdict.GUIDED_HANDOFF_REMAINS)
                    .outcome(SpikeReplyOutcome.COMMENT_CREATE_REJECTED).build());
        } catch (SpikeTransportException e) {
            // Unexpected transport failure on the write — HALT, no retry/PUT.
            return remember(cmd, b.outcome(SpikeReplyOutcome.HALT_TRANSPORT_ERROR).build());
        } finally {
            Arrays.fill(password, '\0');
        }

        // 9. Post-verify: exactly one comment created, then observe reply_status.
        try {
            List<CommentObservation> commentsAfter = transport.listComments(
                    auth.mallId(), auth.accessToken(), cmd.boardNo(), cmd.articleNo());
            long created = countSpikeComments(commentsAfter) - priorSpikeComments;
            b.commentsAfter(commentsAfter.size());
            if (created != 1) {
                // Surprise — do not retry, do not PUT.
                return remember(cmd, b.spikeCommentsCreated((int) Math.max(0, created))
                        .outcome(SpikeReplyOutcome.HALT_UNEXPECTED_COMMENT_COUNT).build());
            }
            b.spikeCommentsCreated(1);

            ArticleObservation after = transport.observeArticle(
                    auth.mallId(), auth.accessToken(), cmd.boardNo(), cmd.articleNo());
            CommunityReplyStatus postStatus = CommunityReplyStatus.normalize(after.rawReplyStatus());
            b.postStatus(postStatus, SpikeReplyResult.tokenClass(after.rawReplyStatus()));

            // A vs B: reply_status transitioned to C (ANSWERED) or not.
            SpikeVerdict verdict = postStatus == CommunityReplyStatus.ANSWERED
                    ? SpikeVerdict.API_REPLY_PRIMARY_CANDIDATE
                    : SpikeVerdict.COMMENT_OK_STATUS_UNCHANGED_HALT;
            return remember(cmd, b.verdict(verdict)
                    .outcome(SpikeReplyOutcome.COMMENT_CREATED).build());
        } catch (SpikeTransportException e) {
            // The write already happened; a failed post-verify is a HALT (no retry).
            return remember(cmd, b.outcome(SpikeReplyOutcome.HALT_TRANSPORT_ERROR).build());
        }
    }

    private static long countSpikeComments(List<CommentObservation> comments) {
        return comments.stream()
                .filter(c -> SpikeContentGuard.SPIKE_WRITER_MARKER.equals(c.writer()))
                .count();
    }

    private SpikeReplyResult remember(SpikeReplyCommand cmd, SpikeReplyResult result) {
        ledger.put(cmd.commandId(), new LedgerEntry(cmd.payloadFingerprint(), result));
        return result;
    }

    private static char[] randomPassword() {
        char[] out = new char[PASSWORD_LENGTH];
        for (int i = 0; i < out.length; i++) {
            out[i] = PASSWORD_ALPHABET[RANDOM.nextInt(PASSWORD_ALPHABET.length)];
        }
        return out;
    }

    private static Builder base(SpikeReplyCommand cmd, SpikeAuthorization auth) {
        return new Builder(cmd, auth);
    }

    /** Fluent builder that seeds the always-known booleans and safe defaults. */
    private static final class Builder {
        private final String commandId;
        private final boolean writeScopeGranted;
        private final boolean boardOk;
        private final boolean testArticleConfirmed;
        private boolean approvalPresent;
        private SpikeReplyOutcome outcome = SpikeReplyOutcome.HALT_TRANSPORT_ERROR;
        private SpikeVerdict verdict = SpikeVerdict.NONE;
        private CommunityReplyStatus preStatus;
        private String preStatusToken;
        private boolean existingSpikeCommentFound;
        private int commentsBefore = -1;
        private int commentsAfter = -1;
        private int spikeCommentsCreated;
        private CommunityReplyStatus postStatus;
        private String postStatusToken;

        Builder(SpikeReplyCommand cmd, SpikeAuthorization auth) {
            this.commandId = cmd.commandId();
            this.writeScopeGranted = auth.writeCommunityGranted();
            this.boardOk = cmd.boardNo() == Cafe24Boards.PRODUCT_INQUIRY_BOARD_NO;
            this.testArticleConfirmed = cmd.operatorTestInquiryConfirmed();
        }

        Builder outcome(SpikeReplyOutcome o) {
            this.outcome = o;
            return this;
        }

        Builder verdict(SpikeVerdict v) {
            this.verdict = v;
            return this;
        }

        Builder approvalPresent(boolean v) {
            this.approvalPresent = v;
            return this;
        }

        Builder preStatus(CommunityReplyStatus s, String token) {
            this.preStatus = s;
            this.preStatusToken = token;
            return this;
        }

        Builder existingSpikeCommentFound(boolean v) {
            this.existingSpikeCommentFound = v;
            return this;
        }

        Builder commentsBefore(int v) {
            this.commentsBefore = v;
            return this;
        }

        Builder commentsAfter(int v) {
            this.commentsAfter = v;
            return this;
        }

        Builder spikeCommentsCreated(int v) {
            this.spikeCommentsCreated = v;
            return this;
        }

        Builder postStatus(CommunityReplyStatus s, String token) {
            this.postStatus = s;
            this.postStatusToken = token;
            return this;
        }

        SpikeReplyResult build() {
            return new SpikeReplyResult(outcome, verdict, commandId, false,
                    writeScopeGranted, boardOk, testArticleConfirmed, approvalPresent,
                    preStatus, preStatusToken, existingSpikeCommentFound,
                    commentsBefore, commentsAfter, spikeCommentsCreated,
                    postStatus, postStatusToken);
        }
    }

    private record LedgerEntry(String fingerprint, SpikeReplyResult result) {
    }
}
