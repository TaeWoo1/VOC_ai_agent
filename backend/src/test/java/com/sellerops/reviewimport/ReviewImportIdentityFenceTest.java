package com.sellerops.reviewimport;

import static org.assertj.core.api.Assertions.assertThat;
import static org.assertj.core.api.Assertions.assertThatThrownBy;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.LocalDate;
import java.util.Optional;
import java.util.UUID;
import org.junit.jupiter.api.BeforeEach;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The canonical org identity fence — and the retirement of the email proxy it replaces.
 *
 * <p>Guided import's real failure mode is a caller reaching work that belongs to a different org. It was
 * observed live on 2026-07-26 (browser in one org, local agent in another) and the mitigation that shipped
 * was in the agent's supervisor: refuse to start as {@code demo@sellerops.ai}. That guard could only ever
 * have been a proxy — it named one address, and by 2026-08-22 that address owned the canonical Demo Org and
 * was its only login, so the guard refused the one org the work was about while permitting every other
 * mismatch it had never heard of.
 *
 * <p>So these tests assert the invariant instead of the proxy: <b>an email address is never an authorization
 * fact, and the whole chain — caller / plan / segment / account / ticket — must be one org, proven from what
 * the server established rather than from anything a client sent.</b>
 */
class ReviewImportIdentityFenceTest {

    private final ReviewImportLaunchRepository launches = mock(ReviewImportLaunchRepository.class);
    private final ReviewImportPlanRepository plans = mock(ReviewImportPlanRepository.class);
    private final ReviewImportSegmentRepository segments = mock(ReviewImportSegmentRepository.class);
    private final SellerAccountRepository sellerAccounts = mock(SellerAccountRepository.class);
    private final ChannelRepository channels = mock(ChannelRepository.class);

    private final ReviewImportIdentityFence fence =
            new ReviewImportIdentityFence(launches, plans, segments, sellerAccounts, channels);

    private final UUID orgId = UUID.randomUUID();
    private final UUID foreignOrgId = UUID.randomUUID();
    private final UUID accountId = UUID.randomUUID();
    private final UUID foreignAccountId = UUID.randomUUID();
    private final UUID channelId = UUID.randomUUID();
    private final UUID otherChannelId = UUID.randomUUID();
    private final UUID planId = UUID.randomUUID();
    private final UUID segId = UUID.randomUUID();
    private static final String REF = "00112233445566aa";

    @BeforeEach
    void chainResolves() {
        when(launches.findByLaunchRef(REF)).thenReturn(Optional.of(ticket(ReviewImportLaunchStatus.ISSUED)));
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.of(account(orgId, channelId)));
        when(channels.findById(channelId)).thenReturn(Optional.of(channel()));
        when(segments.findByIdAndOrgId(segId, orgId)).thenReturn(Optional.of(segment()));
        when(plans.findByIdAndOrgId(planId, orgId)).thenReturn(Optional.of(plan(orgId, accountId, channelId)));
    }

    // ─────────────────────────────────────────────── the case the product needs to work

    /**
     * The canonical Demo Org's owner is {@code demo@sellerops.ai} and there is no second login for that org.
     * Under the retired proxy this run could not start at all. Under the invariant it is simply a caller
     * whose org matches everything the ticket names — which is the only question worth asking.
     */
    @Test
    @DisplayName("the canonical demo org's own user resolves — the address is not part of the decision")
    void theCanonicalDemoOrgOwnerIsAllowed() {
        ReviewImportIdentityFence.BoundLaunch bound = fence.bindOpenTicket(orgId, REF);

        assertThat(bound.ticket().getLaunchRef()).isEqualTo(REF);
        assertThat(bound.account().getId()).isEqualTo(accountId);
        assertThat(bound.plan().getId()).isEqualTo(planId);
        assertThat(bound.segment().getId()).isEqualTo(segId);
        assertThat(bound.channel().getCode()).isEqualTo("NAVER");
    }

    /**
     * Two different people in the SAME org — one signed into the browser, one running the local agent —
     * is a normal setup and must work. Nothing in the chain reads an identity below the org.
     */
    @Test
    @DisplayName("same org, different user: allowed, because the fence never looks at who")
    void sameOrgDifferentEmailIsAllowed() {
        // A second caller in the same org resolves the identical chain; no per-user fact participates.
        ReviewImportIdentityFence.BoundLaunch first = fence.bindOpenTicket(orgId, REF);
        ReviewImportIdentityFence.BoundLaunch second = fence.bindOpenTicket(orgId, REF);

        assertThat(second.ticket().getId()).isEqualTo(first.ticket().getId());
        assertThat(second.plan().getOrgId()).isEqualTo(orgId);
    }

    // ─────────────────────────────────────────────── everything that must fail closed

    /** Trap 6 itself: the agent authenticated as another org. Same answer as an unknown ref. */
    @Test
    @DisplayName("cross-org: a foreign caller cannot resolve the ref, and cannot tell it exists")
    void aForeignOrgIsRefusedIndistinguishablyFromAMiss() {
        assertThatThrownBy(() -> fence.bindOpenTicket(foreignOrgId, REF))
                .isInstanceOf(ApiException.class)
                .hasMessage(ReviewImportIdentityFence.REF_NOT_FOUND);

        assertThatThrownBy(() -> fence.bindOpenTicket(orgId, "ffffffffffffffff"))
                .isInstanceOf(ApiException.class)
                .hasMessage(ReviewImportIdentityFence.REF_NOT_FOUND);
    }

    /** The ticket's account is a copy made at mint time; it must still be this org's account today. */
    @Test
    @DisplayName("account mismatch: the account the ticket names is no longer resolvable in the caller's org")
    void anAccountThatIsNoLongerThisOrgsFailsClosed() {
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> fence.bindOpenTicket(orgId, REF))
                .isInstanceOf(ApiException.class)
                .hasMessage(ReviewImportIdentityFence.REF_NOT_FOUND);
    }

    /** …and it must be on the channel the ticket authorizes, or the runtime opens the wrong marketplace. */
    @Test
    @DisplayName("account/channel mismatch: the ticket's channel is not the account's channel")
    void anAccountOnADifferentChannelFailsClosed() {
        when(sellerAccounts.findByIdAndOrgId(accountId, orgId))
                .thenReturn(Optional.of(account(orgId, otherChannelId)));

        assertThatThrownBy(() -> fence.bindOpenTicket(orgId, REF))
                .isInstanceOf(ApiException.class)
                .hasMessage(ReviewImportIdentityFence.REF_NOT_FOUND);
    }

    /** The ticket must name the plan its own segment belongs to. A disagreement is not resolved by guessing. */
    @Test
    @DisplayName("ticket mismatch: the ticket names a different plan than its segment's")
    void aTicketNamingAnotherPlanFailsClosed() {
        ReviewImportLaunch crossed = ticket(ReviewImportLaunchStatus.ISSUED);
        crossed.setPlanId(UUID.randomUUID()); // not the segment's plan
        when(launches.findByLaunchRef(REF)).thenReturn(Optional.of(crossed));

        assertThatThrownBy(() -> fence.bindOpenTicket(orgId, REF))
                .isInstanceOf(ApiException.class)
                .hasMessage(ReviewImportIdentityFence.REF_NOT_FOUND);
    }

    /** …and the plan must be about the same account the ticket authorizes. */
    @Test
    @DisplayName("ticket mismatch: the plan is for a different seller account than the ticket")
    void aPlanForAnotherAccountFailsClosed() {
        when(plans.findByIdAndOrgId(planId, orgId))
                .thenReturn(Optional.of(plan(orgId, foreignAccountId, channelId)));

        assertThatThrownBy(() -> fence.bindOpenTicket(orgId, REF))
                .isInstanceOf(ApiException.class)
                .hasMessage(ReviewImportIdentityFence.REF_NOT_FOUND);
    }

    /** The segment lookup used to carry no org filter at all — the one unchecked link in the chain. */
    @Test
    @DisplayName("segment mismatch: a segment not resolvable in the caller's org fails closed")
    void aSegmentOutsideTheCallersOrgFailsClosed() {
        when(segments.findByIdAndOrgId(segId, orgId)).thenReturn(Optional.empty());

        assertThatThrownBy(() -> fence.bindOpenTicket(orgId, REF))
                .isInstanceOf(ApiException.class)
                .hasMessage(ReviewImportIdentityFence.REF_NOT_FOUND);
    }

    /**
     * A spent or expired ticket answers 409, NOT 404 — this caller legitimately holds the ref and needs to
     * be told to start over rather than to doubt the ref exists.
     */
    @Test
    @DisplayName("expired and consumed tickets fail closed, and say so to the org that owns them")
    void aSpentTicketIsRefusedButLegibly() {
        for (ReviewImportLaunchStatus spent :
                new ReviewImportLaunchStatus[] {ReviewImportLaunchStatus.EXPIRED, ReviewImportLaunchStatus.CONSUMED}) {
            when(launches.findByLaunchRef(REF)).thenReturn(Optional.of(ticket(spent)));

            assertThatThrownBy(() -> fence.bindOpenTicket(orgId, REF))
                    .as("%s", spent)
                    .isInstanceOf(ApiException.class)
                    .hasMessageContaining("이미 사용된");

            // …and it stays readable for diagnostics, which is why bindTicket exists separately.
            assertThat(fence.bindTicket(orgId, REF).ticket().getStatus()).isEqualTo(spent);
        }
    }

    /** A null caller org (an unauthenticated or unresolved principal) is a refusal, never a wildcard. */
    @Test
    @DisplayName("an unverified caller identity is refused rather than treated as any org")
    void aMissingCallerOrgFailsClosed() {
        assertThatThrownBy(() -> fence.bindOpenTicket(null, REF))
                .isInstanceOf(ApiException.class)
                .hasMessage(ReviewImportIdentityFence.REF_NOT_FOUND);
    }

    // ─────────────────────────────────────────────── plan- and account-side entries

    @Test
    @DisplayName("the plan entry proves the plan's own account is the caller's, not merely the plan")
    void bindPlanProvesTheAccountToo() {
        assertThat(fence.bindPlan(orgId, planId).account().getId()).isEqualTo(accountId);

        when(sellerAccounts.findByIdAndOrgId(accountId, orgId)).thenReturn(Optional.empty());
        assertThatThrownBy(() -> fence.bindPlan(orgId, planId)).isInstanceOf(ApiException.class);
    }

    @Test
    @DisplayName("a foreign caller cannot bind a plan or an account")
    void planAndAccountEntriesAreOrgScoped() {
        assertThatThrownBy(() -> fence.bindPlan(foreignOrgId, planId)).isInstanceOf(ApiException.class);
        assertThatThrownBy(() -> fence.bindAccount(foreignOrgId, accountId)).isInstanceOf(ApiException.class);
    }

    // ─────────────────────────────────────────────── fixtures

    private ReviewImportLaunch ticket(ReviewImportLaunchStatus status) {
        ReviewImportLaunch t = new ReviewImportLaunch();
        t.setId(UUID.randomUUID());
        t.setOrgId(orgId);
        t.setSellerAccountId(accountId);
        t.setChannelId(channelId);
        t.setLaunchRef(REF);
        t.setKind(ReviewImportLaunchKind.SEGMENT);
        t.setPlanId(planId);
        t.setSegmentId(segId);
        t.setStatus(status);
        return t;
    }

    private SellerAccount account(UUID org, UUID channel) {
        SellerAccount a = new SellerAccount();
        a.setId(accountId);
        a.setOrgId(org);
        a.setChannelId(channel);
        return a;
    }

    private ReviewImportPlan plan(UUID org, UUID account, UUID channel) {
        ReviewImportPlan p = new ReviewImportPlan();
        p.setId(planId);
        p.setOrgId(org);
        p.setSellerAccountId(account);
        p.setChannelId(channel);
        return p;
    }

    private ReviewImportSegment segment() {
        ReviewImportSegment s = new ReviewImportSegment();
        s.setId(segId);
        s.setPlanId(planId);
        s.setOrgId(orgId);
        s.setSegmentStart(LocalDate.parse("2026-08-01"));
        s.setSegmentEnd(LocalDate.parse("2026-08-22"));
        s.setExecutionState(SegmentExecutionState.PENDING);
        s.setCoverageState(SegmentCoverageState.UNVERIFIED);
        return s;
    }

    private Channel channel() {
        Channel c = new Channel();
        c.setId(channelId);
        c.setCode("NAVER");
        return c;
    }
}
