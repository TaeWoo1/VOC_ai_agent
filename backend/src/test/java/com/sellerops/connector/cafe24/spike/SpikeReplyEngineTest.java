package com.sellerops.connector.cafe24.spike;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.community.CommunityReplyStatus;
import org.junit.jupiter.api.Test;

/**
 * Offline verification of the reply-spike decision engine (§6 of the brief). Every
 * gate, the idempotency ledger, the single-use approval, the A/B/C verdict, the
 * defensive HALTs, and the sanitized-output contract are exercised with a fake
 * transport — no test can reach the network.
 */
class SpikeReplyEngineTest {

    private static final String APPROVAL = "approve-once-XYZ";
    private static final String MALL = "teststore-mall";
    private static final String TOKEN = "ACCESS-TOKEN-SECRET-VALUE";

    private static SpikeAuthorization writeGranted() {
        return new SpikeAuthorization(MALL, TOKEN, true);
    }

    private static SpikeAuthorization writeNotGranted() {
        return new SpikeAuthorization(MALL, TOKEN, false);
    }

    private static SpikeReplyCommand cmd(String id) {
        return new SpikeReplyCommand(id, 6, 42L, true, false, APPROVAL,
                SpikeReplyCommand.ContentSource.FIXED, null);
    }

    // ---- §6 gates ---------------------------------------------------------------

    @Test
    void rejectsBoardOtherThanSix() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);
        SpikeReplyCommand c = new SpikeReplyCommand("c", 4, 42L, true, false, APPROVAL,
                SpikeReplyCommand.ContentSource.FIXED, null);

        SpikeReplyResult r = engine.execute(writeGranted(), c);

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.REFUSED_WRONG_BOARD);
        assertThat(r.verdict()).isEqualTo(SpikeVerdict.NONE);
        assertThat(t.createCalls).isZero();
        assertThat(t.observeCalls).isZero();
    }

    @Test
    void rejectsBoardNine() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);
        SpikeReplyCommand c = new SpikeReplyCommand("c", 9, 42L, true, false, APPROVAL,
                SpikeReplyCommand.ContentSource.FIXED, null);

        SpikeReplyResult r = engine.execute(writeGranted(), c);

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.REFUSED_WRONG_BOARD);
        assertThat(t.createCalls).isZero();
    }

    @Test
    void rejectsNonTestArticle() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);
        SpikeReplyCommand c = new SpikeReplyCommand("c", 6, 42L, false, false, APPROVAL,
                SpikeReplyCommand.ContentSource.FIXED, null);

        SpikeReplyResult r = engine.execute(writeGranted(), c);

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.REFUSED_NOT_TEST_ARTICLE);
        assertThat(t.createCalls).isZero();
    }

    @Test
    void missingWriteScopeIsVerdictC() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyResult r = engine.execute(writeNotGranted(), cmd("c"));

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.REFUSED_WRITE_SCOPE_NOT_GRANTED);
        assertThat(r.verdict()).isEqualTo(SpikeVerdict.GUIDED_HANDOFF_REMAINS);
        assertThat(r.writeScopeGranted()).isFalse();
        assertThat(t.observeCalls).isZero();
        assertThat(t.createCalls).isZero();
    }

    @Test
    void refusesWhenPreStatusIsNotN() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        t.currentRawStatus = "C"; // already answered
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyResult r = engine.execute(writeGranted(), cmd("c"));

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.REFUSED_PRECONDITION_STATUS_NOT_N);
        assertThat(r.preStatus()).isEqualTo(CommunityReplyStatus.ANSWERED);
        assertThat(r.preStatusToken()).isEqualTo("C");
        assertThat(t.createCalls).isZero();
    }

    @Test
    void refusesWhenApprovalMissing() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);
        SpikeReplyCommand c = new SpikeReplyCommand("c", 6, 42L, true, false, "  ",
                SpikeReplyCommand.ContentSource.FIXED, null);

        SpikeReplyResult r = engine.execute(writeGranted(), c);

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.REFUSED_MISSING_APPROVAL);
        assertThat(r.approvalPresent()).isFalse();
        assertThat(t.observeCalls).isZero();
        assertThat(t.createCalls).isZero();
    }

    @Test
    void refusesWhenApprovalDoesNotMatch() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);
        SpikeReplyCommand c = new SpikeReplyCommand("c", 6, 42L, true, false, "wrong-value",
                SpikeReplyCommand.ContentSource.FIXED, null);

        SpikeReplyResult r = engine.execute(writeGranted(), c);

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.REFUSED_MISSING_APPROVAL);
        assertThat(t.createCalls).isZero();
    }

    @Test
    void dryRunExecuteMakesZeroExternalCalls() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);
        SpikeReplyCommand c = new SpikeReplyCommand("c", 6, 42L, true, true, APPROVAL,
                SpikeReplyCommand.ContentSource.FIXED, null);

        SpikeReplyResult r = engine.execute(writeGranted(), c);

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.DRY_RUN_PLANNED);
        assertThat(t.observeCalls).isZero();
        assertThat(t.listCalls).isZero();
        assertThat(t.createCalls).isZero();
    }

    @Test
    void planMakesZeroExternalCalls() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyPlan plan = engine.plan(cmd("c"));

        assertThat(plan.preflightNote()).isEqualTo("BOARD_OK");
        assertThat(plan.writerMarker()).isEqualTo(SpikeContentGuard.SPIKE_WRITER_MARKER);
        assertThat(plan.approvalWouldBeRequired()).isTrue();
        assertThat(t.observeCalls).isZero();
        assertThat(t.listCalls).isZero();
        assertThat(t.createCalls).isZero();
    }

    @Test
    void refusesDuplicateWhenSpikeCommentAlreadyPresent() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        t.addSpikeComment();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyResult r = engine.execute(writeGranted(), cmd("c"));

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.REFUSED_DUPLICATE_EXISTING_COMMENT);
        assertThat(r.existingSpikeCommentFound()).isTrue();
        assertThat(t.createCalls).isZero();
    }

    // ---- idempotency & single-use ----------------------------------------------

    @Test
    void sameCommandIdReplaysWithoutSecondPost() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyResult first = engine.execute(writeGranted(), cmd("dup"));
        SpikeReplyResult second = engine.execute(writeGranted(), cmd("dup"));

        assertThat(first.outcome()).isEqualTo(SpikeReplyOutcome.COMMENT_CREATED);
        assertThat(first.idempotentReplay()).isFalse();
        assertThat(second.idempotentReplay()).isTrue();
        assertThat(second.outcome()).isEqualTo(SpikeReplyOutcome.COMMENT_CREATED);
        assertThat(t.createCalls).isEqualTo(1); // exactly one POST across both runs
    }

    @Test
    void sameCommandIdDifferentPayloadIsRejected() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        engine.execute(writeGranted(), cmd("k"));
        SpikeReplyCommand conflicting = new SpikeReplyCommand("k", 6, 99L, true, false, APPROVAL,
                SpikeReplyCommand.ContentSource.FIXED, null); // different articleNo
        SpikeReplyResult r = engine.execute(writeGranted(), conflicting);

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.REFUSED_COMMAND_CONFLICT);
        assertThat(t.createCalls).isEqualTo(1);
    }

    @Test
    void singleUseApprovalCannotBeReusedByAnotherCommand() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyResult first = engine.execute(writeGranted(), cmd("first"));
        // A different commandId reusing the now-consumed approval value.
        SpikeReplyResult second = engine.execute(writeGranted(), cmd("second"));

        assertThat(first.outcome()).isEqualTo(SpikeReplyOutcome.COMMENT_CREATED);
        assertThat(second.outcome()).isEqualTo(SpikeReplyOutcome.REFUSED_MISSING_APPROVAL);
        assertThat(t.createCalls).isEqualTo(1);
    }

    // ---- verdict matrix on a successful create ---------------------------------

    @Test
    void createThenStatusCIsVerdictA() {
        SpikeReplyResult r = createWithPostStatus("C");
        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.COMMENT_CREATED);
        assertThat(r.verdict()).isEqualTo(SpikeVerdict.API_REPLY_PRIMARY_CANDIDATE);
        assertThat(r.postStatusToken()).isEqualTo("C");
        assertThat(r.spikeCommentsCreated()).isEqualTo(1);
    }

    @Test
    void createThenStatusStaysNIsVerdictB() {
        SpikeReplyResult r = createWithPostStatus("N");
        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.COMMENT_CREATED);
        assertThat(r.verdict()).isEqualTo(SpikeVerdict.COMMENT_OK_STATUS_UNCHANGED_HALT);
        assertThat(r.postStatusToken()).isEqualTo("N");
    }

    @Test
    void createThenStatusPIsVerdictB() {
        SpikeReplyResult r = createWithPostStatus("P");
        assertThat(r.verdict()).isEqualTo(SpikeVerdict.COMMENT_OK_STATUS_UNCHANGED_HALT);
        assertThat(r.postStatusToken()).isEqualTo("P");
    }

    @Test
    void createThenUnknownStatusIsVerdictB() {
        SpikeReplyResult r = createWithPostStatus("");
        assertThat(r.verdict()).isEqualTo(SpikeVerdict.COMMENT_OK_STATUS_UNCHANGED_HALT);
        assertThat(r.postStatus()).isEqualTo(CommunityReplyStatus.UNKNOWN);
        assertThat(r.postStatusToken()).isEqualTo("OTHER");
    }

    private SpikeReplyResult createWithPostStatus(String postStatus) {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        t.currentRawStatus = "N";
        t.statusAfterCreate = postStatus;
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);
        return engine.execute(writeGranted(), cmd("c"));
    }

    // ---- rejection & HALTs ------------------------------------------------------

    @Test
    void createRejectedIsVerdictC() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        t.rejectOnCreate = true;
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyResult r = engine.execute(writeGranted(), cmd("c"));

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.COMMENT_CREATE_REJECTED);
        assertThat(r.verdict()).isEqualTo(SpikeVerdict.GUIDED_HANDOFF_REMAINS);
    }

    @Test
    void transportErrorOnObserveHalts() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        t.throwTransportOnFirstObserve = true;
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyResult r = engine.execute(writeGranted(), cmd("c"));

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.HALT_TRANSPORT_ERROR);
        assertThat(t.createCalls).isZero();
    }

    @Test
    void transportErrorOnCreateHaltsWithNoRetry() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        t.throwTransportOnCreate = true;
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyResult r = engine.execute(writeGranted(), cmd("c"));

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.HALT_TRANSPORT_ERROR);
        assertThat(t.createCalls).isEqualTo(1); // attempted once, never retried
    }

    @Test
    void unexpectedCommentCountHaltsWithNoPut() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        t.spikeCommentsAddedOnCreate = 2; // surprise: two comments appear
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyResult r = engine.execute(writeGranted(), cmd("c"));

        assertThat(r.outcome()).isEqualTo(SpikeReplyOutcome.HALT_UNEXPECTED_COMMENT_COUNT);
        assertThat(r.verdict()).isEqualTo(SpikeVerdict.NONE);
        assertThat(t.createCalls).isEqualTo(1);
        assertThat(t.observeCalls).isEqualTo(1); // no post-create article re-fetch after the halt
    }

    // ---- sanitized output -------------------------------------------------------

    @Test
    void resultLeaksNoSecretOrContent() {
        FakeSpikeReplyTransport t = new FakeSpikeReplyTransport();
        t.addForeignComment("customer@example.com"); // a foreign writer must not surface
        SpikeReplyEngine engine = new SpikeReplyEngine(t, APPROVAL);

        SpikeReplyResult r = engine.execute(writeGranted(), cmd("c"));
        String rendered = r.toString();

        assertThat(rendered)
                .doesNotContain(MALL)
                .doesNotContain(TOKEN)
                .doesNotContain(SpikeContentGuard.SPIKE_WRITER_MARKER)
                .doesNotContain(SpikeContentGuard.FIXED_TEST_CONTENT)
                .doesNotContain("customer@example.com")
                .doesNotContain(APPROVAL);
    }
}
