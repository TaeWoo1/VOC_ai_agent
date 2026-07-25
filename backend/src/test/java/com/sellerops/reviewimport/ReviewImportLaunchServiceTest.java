package com.sellerops.reviewimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.ArgumentMatchers.any;
import static org.mockito.ArgumentMatchers.eq;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.never;
import static org.mockito.Mockito.verify;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.io.ByteArrayInputStream;
import java.io.InputStream;
import java.time.LocalDate;
import java.util.List;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * The guided-run authorization layer, with repositories + the plan/run services mocked.
 *
 * <p>What these pin is mostly about what a ticket must REFUSE, because a ticket is the entire authorization
 * for one run against a live marketplace: single use, org-scoped without leaking existence, kind-checked,
 * and idempotent on re-click so one segment can never be driven by two concurrent runs. Plus the honesty
 * rules: the scope/range evidence a run reports is carried through verbatim, never defaulted to the
 * stronger claim.
 */
class ReviewImportLaunchServiceTest {

    private final ReviewImportLaunchRepository launches = mock(ReviewImportLaunchRepository.class);
    private final ReviewImportPlanRepository plans = mock(ReviewImportPlanRepository.class);
    private final ReviewImportSegmentRepository segments = mock(ReviewImportSegmentRepository.class);
    private final ReviewImportPlanService planService = mock(ReviewImportPlanService.class);
    private final ReviewImportRunService runService = mock(ReviewImportRunService.class);
    private final SellerAccountRepository sellerAccounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);

    private final ReviewImportLaunchService service = new ReviewImportLaunchService(
            launches, plans, segments, planService, runService, sellerAccounts, channels);

    private final UUID orgId = UUID.randomUUID();
    private final UUID otherOrgId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();
    private final UUID planId = UUID.randomUUID();
    private final UUID segId = UUID.randomUUID();

    private static InputStream file() {
        return new ByteArrayInputStream("synthetic".getBytes());
    }

    private void stubSave() {
        when(launches.save(any())).thenAnswer(inv -> inv.getArgument(0));
    }

    private SellerAccount account() {
        SellerAccount a = new SellerAccount();
        a.setId(accountId);
        a.setOrgId(orgId);
        a.setChannelId(channelId);
        return a;
    }

    private ReviewImportPlan plan() {
        ReviewImportPlan p = new ReviewImportPlan();
        p.setId(planId);
        p.setOrgId(orgId);
        p.setSellerAccountId(accountId);
        p.setChannelId(channelId);
        return p;
    }

    private ReviewImportSegment segment(SegmentExecutionState exec, SegmentCoverageState cov) {
        ReviewImportSegment s = new ReviewImportSegment();
        s.setId(segId);
        s.setPlanId(planId);
        s.setOrgId(orgId);
        s.setSegmentStart(LocalDate.parse("2026-03-01"));
        s.setSegmentEnd(LocalDate.parse("2026-03-31"));
        s.setExecutionState(exec);
        s.setCoverageState(cov);
        return s;
    }

    private ReviewImportLaunch ticket(ReviewImportLaunchKind kind, ReviewImportLaunchStatus status) {
        ReviewImportLaunch t = new ReviewImportLaunch();
        t.setId(UUID.randomUUID());
        t.setOrgId(orgId);
        t.setSellerAccountId(accountId);
        t.setChannelId(channelId);
        t.setLaunchRef("00112233445566aa");
        t.setKind(kind);
        t.setStatus(status);
        if (kind == ReviewImportLaunchKind.SEGMENT) {
            t.setPlanId(planId);
            t.setSegmentId(segId);
        }
        return t;
    }

    /* ─────────────── refs ─────────────── */

    @Test
    void mintsAnOpaqueSixteenHexRefTheActionWindowContractWillAccept() {
        // The ref rides the AW wire, where anything but 16 lowercase hex is rejected as non-opaque.
        for (int i = 0; i < 50; i++) {
            assertThat(ReviewImportLaunchService.newLaunchRef()).matches("^[0-9a-f]{16}$");
        }
    }

    @Test
    void refsAreUnguessableRatherThanSequential() {
        assertThat(List.of(ReviewImportLaunchService.newLaunchRef(), ReviewImportLaunchService.newLaunchRef(),
                        ReviewImportLaunchService.newLaunchRef(), ReviewImportLaunchService.newLaunchRef()))
                .doesNotHaveDuplicates();
    }

    /* ─────────────── issue ─────────────── */

    @Test
    void discoveryTicketCarriesNoPlanBecauseThePlanDoesNotExistYet() {
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));
        when(launches.findByOrgIdAndSellerAccountIdAndKindAndStatus(any(), any(), any(), any()))
                .thenReturn(Optional.empty());
        stubSave();

        ReviewImportLaunch t = service.mintDiscovery(orgId, accountId);

        assertThat(t.getKind()).isEqualTo(ReviewImportLaunchKind.DISCOVERY);
        assertThat(t.getPlanId()).isNull();
        assertThat(t.getSegmentId()).isNull();
        assertThat(t.getStatus()).isEqualTo(ReviewImportLaunchStatus.ISSUED);
    }

    @Test
    void reclickingReturnsTheSameOutstandingTicketInsteadOfMintingASecond() {
        ReviewImportLaunch existing = ticket(ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED);
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account()));
        when(launches.findByOrgIdAndSellerAccountIdAndKindAndStatus(
                orgId, accountId, ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED))
                .thenReturn(Optional.of(existing));

        assertThat(service.mintDiscovery(orgId, accountId)).isSameAs(existing);
        verify(launches, never()).save(any());
    }

    @Test
    void reclickingASegmentReturnsItsOutstandingTicketSoTwoRunsCannotDriveOneSegment() {
        ReviewImportLaunch existing = ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED);
        when(segments.findByIdAndOrgId(segId, orgId))
                .thenReturn(Optional.of(segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED)));
        when(plans.findByIdAndOrgId(planId, orgId)).thenReturn(Optional.of(plan()));
        when(launches.findBySegmentIdAndStatus(segId, ReviewImportLaunchStatus.ISSUED))
                .thenReturn(Optional.of(existing));

        assertThat(service.mintSegment(orgId, segId)).isSameAs(existing);
        verify(launches, never()).save(any());
    }

    @Test
    void aFailedSegmentCanBeRelaunchedBecauseRetryIsTheNormalRecovery() {
        when(segments.findByIdAndOrgId(segId, orgId))
                .thenReturn(Optional.of(segment(SegmentExecutionState.FAILED, SegmentCoverageState.UNVERIFIED)));
        when(plans.findByIdAndOrgId(planId, orgId)).thenReturn(Optional.of(plan()));
        when(launches.findBySegmentIdAndStatus(any(), any())).thenReturn(Optional.empty());
        stubSave();

        ReviewImportLaunch t = service.mintSegment(orgId, segId);
        assertThat(t.getSegmentId()).isEqualTo(segId);
        assertThat(t.getPlanId()).isEqualTo(planId);
    }

    @Test
    void refusesToLaunchASegmentThatIsAlreadyCoveredSupersededOrRunning() {
        when(plans.findByIdAndOrgId(planId, orgId)).thenReturn(Optional.of(plan()));

        when(segments.findByIdAndOrgId(segId, orgId))
                .thenReturn(Optional.of(segment(SegmentExecutionState.COMPLETED, SegmentCoverageState.COVERED)));
        assertThatThrownBy(() -> service.mintSegment(orgId, segId)).isInstanceOf(ApiException.class);

        when(segments.findByIdAndOrgId(segId, orgId))
                .thenReturn(Optional.of(segment(SegmentExecutionState.ACTIVE, SegmentCoverageState.UNVERIFIED)));
        assertThatThrownBy(() -> service.mintSegment(orgId, segId)).isInstanceOf(ApiException.class);

        ReviewImportSegment superseded = segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED);
        superseded.setSuperseded(true);
        when(segments.findByIdAndOrgId(segId, orgId)).thenReturn(Optional.of(superseded));
        assertThatThrownBy(() -> service.mintSegment(orgId, segId)).isInstanceOf(ApiException.class);

        verify(launches, never()).save(any());
    }

    @Test
    void nextSegmentSkipsCoveredAndMissingAndPicksTheEarliestRemaining() {
        ReviewImportSegment covered = segment(SegmentExecutionState.COMPLETED, SegmentCoverageState.COVERED);
        ReviewImportSegment missing = segment(SegmentExecutionState.COMPLETED, SegmentCoverageState.MISSING);
        ReviewImportSegment remaining = segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED);
        remaining.setId(UUID.randomUUID());
        when(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId))
                .thenReturn(List.of(covered, missing, remaining));

        assertThat(service.nextRemainingSegment(orgId, planId)).containsSame(remaining);
    }

    @Test
    void continuingWithNothingLeftFailsClosedRatherThanInventingWork() {
        when(segments.findByPlanIdAndSupersededFalseOrderBySegmentStartAsc(planId))
                .thenReturn(List.of(segment(SegmentExecutionState.COMPLETED, SegmentCoverageState.COVERED)));
        assertThatThrownBy(() -> service.mintNextSegment(orgId, planId)).isInstanceOf(ApiException.class);
    }

    /* ─────────────── resolve ─────────────── */

    @Test
    void resolvedScopeTellsTheRuntimeTheDatesAndChannelAndNothingIdentifying() {
        Channel channel = new Channel();
        channel.setId(channelId);
        channel.setCode("NAVER");
        when(launches.findByLaunchRef("00112233445566aa"))
                .thenReturn(Optional.of(ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED)));
        when(channels.findById(channelId)).thenReturn(Optional.of(channel));
        when(segments.findById(segId))
                .thenReturn(Optional.of(segment(SegmentExecutionState.PENDING, SegmentCoverageState.UNVERIFIED)));

        ReviewImportLaunchService.LaunchScope scope = service.resolveScope(orgId, "00112233445566aa");

        assertThat(scope.kind()).isEqualTo(ReviewImportLaunchKind.SEGMENT);
        // lowercase: the AW contract's channelCode is a semantic code, not the channel table's display code
        assertThat(scope.channelCode()).isEqualTo("naver");
        assertThat(scope.requiredStart()).isEqualTo(LocalDate.parse("2026-03-01"));
        assertThat(scope.requiredEnd()).isEqualTo(LocalDate.parse("2026-03-31"));
        // LaunchScope is a 4-field record by design — adding an id here would leak identity to the runtime
        assertThat(scope.toString()).doesNotContain(segId.toString()).doesNotContain(planId.toString());
    }

    @Test
    void aDiscoveryScopeCarriesNoDatesBecauseFindingThemIsItsJob() {
        Channel channel = new Channel();
        channel.setId(channelId);
        channel.setCode("NAVER");
        when(launches.findByLaunchRef("00112233445566aa"))
                .thenReturn(Optional.of(ticket(ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED)));
        when(channels.findById(channelId)).thenReturn(Optional.of(channel));

        ReviewImportLaunchService.LaunchScope scope = service.resolveScope(orgId, "00112233445566aa");
        assertThat(scope.requiredStart()).isNull();
        assertThat(scope.requiredEnd()).isNull();
    }

    @Test
    void aRefFromAnotherOrgIsIndistinguishableFromOneThatDoesNotExist() {
        ReviewImportLaunch foreign = ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED);
        foreign.setOrgId(otherOrgId);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(foreign));
        when(launches.findByLaunchRef("ffffffffffffffff")).thenReturn(Optional.empty());

        ApiException wrongOrg = catchApi(() -> service.resolveScope(orgId, "00112233445566aa"));
        ApiException missing = catchApi(() -> service.resolveScope(orgId, "ffffffffffffffff"));
        assertThat(wrongOrg.getMessage()).isEqualTo(missing.getMessage());
    }

    /* ─────────────── spend ─────────────── */

    @Test
    void recordingTheDiscoveredRangeCreatesThePlanOverThatRangeAndSpendsTheTicket() {
        ReviewImportLaunch t = ticket(ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(t));
        when(planService.createPlan(eq(orgId), eq(accountId), eq(channelId), any(), any())).thenReturn(plan());
        stubSave();

        ReviewImportPlan created = service.recordDiscoveredRange(orgId, "00112233445566aa",
                LocalDate.parse("2025-08-01"), LocalDate.parse("2026-07-25"),
                RangeDiscoveryEvidence.OPERATOR_CONFIRMED);

        assertThat(created.getId()).isEqualTo(planId);
        // the plan is built from the DISCOVERED range, not a period guessed up front
        verify(planService).createPlan(orgId, accountId, channelId,
                LocalDate.parse("2025-08-01"), LocalDate.parse("2026-07-25"));
        assertThat(t.getStatus()).isEqualTo(ReviewImportLaunchStatus.CONSUMED);
        assertThat(t.getConsumedAt()).isNotNull();
        assertThat(t.getPlanId()).isEqualTo(planId); // provenance of the plan it produced
        // an operator's confirmation is recorded AS an operator confirmation, never upgraded
        assertThat(t.getRangeEvidence()).isEqualTo(RangeDiscoveryEvidence.OPERATOR_CONFIRMED);
    }

    @Test
    void aSpentTicketCannotBeReplayed() {
        ReviewImportLaunch spent = ticket(ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.CONSUMED);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(spent));

        assertThatThrownBy(() -> service.recordDiscoveredRange(orgId, "00112233445566aa",
                LocalDate.parse("2025-08-01"), LocalDate.parse("2026-07-25"),
                RangeDiscoveryEvidence.MACHINE_DISCOVERED))
                .isInstanceOf(ApiException.class);
        verify(planService, never()).createPlan(any(), any(), any(), any(), any());
    }

    @Test
    void aTicketCannotBeSpentAsTheWrongKindOfRun() {
        when(launches.findByLaunchRef("00112233445566aa"))
                .thenReturn(Optional.of(ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED)));
        assertThatThrownBy(() -> service.recordDiscoveredRange(orgId, "00112233445566aa",
                LocalDate.parse("2025-08-01"), LocalDate.parse("2026-07-25"),
                RangeDiscoveryEvidence.MACHINE_DISCOVERED))
                .isInstanceOf(ApiException.class);

        when(launches.findByLaunchRef("00112233445566bb"))
                .thenReturn(Optional.of(ticket(ReviewImportLaunchKind.DISCOVERY, ReviewImportLaunchStatus.ISSUED)));
        assertThatThrownBy(() -> service.ingestForLaunch(orgId, "00112233445566bb",
                ScopeEvidence.MACHINE_MATCHED, "export.xlsx", file()))
                .isInstanceOf(ApiException.class);
        verify(runService, never()).importSegment(any(), any(), any(boolean.class), any(), any(), any());
    }

    @Test
    void ingestGoesToTheBoundSegmentAndCarriesTheReportedEvidence() {
        ReviewImportLaunch t = ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(t));
        stubSave();

        service.ingestForLaunch(orgId, "00112233445566aa", ScopeEvidence.MACHINE_MATCHED, "export.xlsx", file());

        verify(runService).importSegment(eq(orgId), eq(segId), eq(true), eq(ScopeEvidence.MACHINE_MATCHED),
                eq("export.xlsx"), any());
        assertThat(t.getScopeEvidence()).isEqualTo(ScopeEvidence.MACHINE_MATCHED);
        assertThat(t.getStatus()).isEqualTo(ReviewImportLaunchStatus.CONSUMED);
    }

    @Test
    void anOperatorConfirmedScopeIsNotSilentlyRecordedAsAMachineMatch() {
        ReviewImportLaunch t = ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(t));
        stubSave();

        service.ingestForLaunch(orgId, "00112233445566aa", ScopeEvidence.OPERATOR_CONFIRMED, "export.xlsx", file());

        verify(runService).importSegment(any(), any(), eq(true), eq(ScopeEvidence.OPERATOR_CONFIRMED), any(), any());
        assertThat(t.getScopeEvidence()).isEqualTo(ScopeEvidence.OPERATOR_CONFIRMED);
    }

    @Test
    void expiringAnUnspentTicketKeepsItAsHistorySoAFreshOneCanBeIssued() {
        ReviewImportLaunch t = ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.ISSUED);
        when(launches.findByLaunchRef("00112233445566aa")).thenReturn(Optional.of(t));
        stubSave();

        assertThat(service.expire(orgId, "00112233445566aa").getStatus())
                .isEqualTo(ReviewImportLaunchStatus.EXPIRED);
        verify(launches).save(t); // kept, not deleted
    }

    @Test
    void aSpentTicketCannotBeRetroactivelyExpired() {
        when(launches.findByLaunchRef("00112233445566aa"))
                .thenReturn(Optional.of(ticket(ReviewImportLaunchKind.SEGMENT, ReviewImportLaunchStatus.CONSUMED)));
        assertThatThrownBy(() -> service.expire(orgId, "00112233445566aa")).isInstanceOf(ApiException.class);
    }

    private static ApiException catchApi(Runnable r) {
        try {
            r.run();
            throw new AssertionError("expected an ApiException");
        } catch (ApiException e) {
            return e;
        }
    }
}
