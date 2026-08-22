package com.sellerops.reviewimport;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.UUID;
import org.springframework.stereotype.Service;

/**
 * The canonical org identity fence for guided review import — the single place the chain
 * <b>authenticated caller → plan → segment → seller account → ticket</b> is proven to be one org.
 *
 * <h2>What it replaces, and why that mattered</h2>
 *
 * <p>Guided import has always had a real cross-org failure: on 2026-07-26 a live run refused with
 * {@code aw_import_host_scope_refused} because the browser had created the plan as one org while the local
 * agent was signed in as another. The server answered correctly — 404, deliberately the same answer as a
 * spent or unknown ref — and the run failed closed. It was written up as "runbook trap 6" and the local
 * agent's supervisor grew a guard for it: <b>refuse to start when {@code SELLEROPS_EMAIL} is the demo
 * account.</b>
 *
 * <p>That guard was a <b>proxy</b>, and proxies expire. It banned one email address because, at the time,
 * that address meant fixture data and every real run belonged to a freshly signed-up org. By 2026-08-22 the
 * same address owned the canonical Demo Org — four connected accounts, 4,046 real reviews, three channels
 * being assembled — and it is the org's <b>only</b> login. The guard had inverted: it now refused the one
 * org the work was about, while still permitting any two <i>other</i> mismatched orgs it had never heard of.
 *
 * <p>An email address is not an authorization fact. It is not what the server checks, it is not what a
 * ticket carries, and it can be changed by the person it is meant to constrain. So the proxy is gone and
 * the invariant it stood for is enforced here instead, on identity the <b>server</b> established.
 *
 * <h2>The invariant</h2>
 *
 * <pre>
 *   authenticated caller org        (JWT principal — never a client-supplied orgId)
 *     == review import plan owner org
 *     == segment org
 *     == resolved seller account org
 *     == ticket org
 *   and the ticket's account/channel/plan bindings agree with the rows they name.
 * </pre>
 *
 * <p>The local-agent runtime is not a special case: it authenticates as itself and reaches the same
 * endpoints, so "the agent is in the right org" is the ordinary caller check, not a separate rule.
 *
 * <h2>Why every join is re-proven rather than trusted</h2>
 *
 * <p>A ticket carries a denormalized copy of {@code sellerAccountId} and {@code channelId} written when it
 * was minted. Reading those back and using them — which is what {@code resolveScope} did — trusts a
 * snapshot: {@code segments.findById(ticket.getSegmentId())} carried no org filter at all, and
 * {@code ReviewImportRunService} resolved the plan of an org-scoped segment with an unscoped
 * {@code plans.findById}, then ingested into <b>that plan's</b> channel. Each was reachable only through a
 * ticket the caller's org already owned, so neither was an open door; both were an unproven link in a chain
 * whose whole job is to be proven.
 *
 * <p><b>Fail closed, and indistinguishably.</b> A wrong org, a missing row, a broken binding and an unknown
 * ref all answer the same 404, so the ref space cannot be probed for which of those it was. A spent or
 * expired ticket is the one case that answers differently (409) — the caller legitimately holds that ref and
 * needs to be told to start over.
 */
@Service
public class ReviewImportIdentityFence {

    /** One answer for every identity failure on a ticket path. See the class note on indistinguishability. */
    static final String REF_NOT_FOUND = "가져오기 요청을 찾을 수 없습니다.";

    private final ReviewImportLaunchRepository launches;
    private final ReviewImportPlanRepository plans;
    private final ReviewImportSegmentRepository segments;
    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;

    public ReviewImportIdentityFence(ReviewImportLaunchRepository launches,
                                     ReviewImportPlanRepository plans,
                                     ReviewImportSegmentRepository segments,
                                     SellerAccountRepository sellerAccounts,
                                     ChannelRepository channels) {
        this.launches = launches;
        this.plans = plans;
        this.segments = segments;
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
    }

    /**
     * Everything one launch ref legitimately resolves to, with every link proven. {@code plan} and
     * {@code segment} are null for a DISCOVERY ticket, which authorizes an account and no range.
     */
    public record BoundLaunch(ReviewImportLaunch ticket, SellerAccount account, Channel channel,
                              ReviewImportPlan plan, ReviewImportSegment segment) {
    }

    /** A plan with its owning account proven in the caller's org. */
    public record BoundPlan(ReviewImportPlan plan, SellerAccount account) {
    }

    /**
     * Resolve a ref for a caller, in any ticket status. Used by the diagnostic paths (readiness reports,
     * ticket reads) that must still work after the ticket that started the run was spent.
     */
    public BoundLaunch bindTicket(UUID callerOrgId, String launchRef) {
        ReviewImportLaunch ticket = launches.findByLaunchRef(launchRef)
                .orElseThrow(() -> ApiException.notFound(REF_NOT_FOUND));
        return bind(callerOrgId, ticket);
    }

    /** As {@link #bindTicket}, and the ticket must still be spendable. */
    public BoundLaunch bindOpenTicket(UUID callerOrgId, String launchRef) {
        BoundLaunch bound = bindTicket(callerOrgId, launchRef);
        if (!bound.ticket().isOpen()) {
            // Distinct from the 404 on purpose: this caller legitimately holds the ref.
            throw ApiException.conflict("이미 사용된 가져오기 요청입니다. 다시 시작해 주세요.");
        }
        return bound;
    }

    /** The plan-side entry: a plan id a caller named, with its account proven in the same org. */
    public BoundPlan bindPlan(UUID callerOrgId, UUID planId) {
        ReviewImportPlan plan = plans.findByIdAndOrgId(planId, callerOrgId)
                .orElseThrow(() -> ApiException.notFound("가져오기 계획을 찾을 수 없습니다."));
        return new BoundPlan(plan, accountOf(callerOrgId, plan));
    }

    /** The account-side entry: a seller account id a caller named, proven to be theirs. */
    public SellerAccount bindAccount(UUID callerOrgId, UUID sellerAccountId) {
        return sellerAccounts.findByIdAndOrgId(sellerAccountId, callerOrgId)
                .orElseThrow(() -> ApiException.notFound("연동할 채널 계정을 찾을 수 없습니다."));
    }

    /** The segment-side entry: a segment id a caller named, with its plan and account proven in that org. */
    public BoundPlan bindSegmentPlan(UUID callerOrgId, ReviewImportSegment segment) {
        ReviewImportPlan plan = plans.findByIdAndOrgId(segment.getPlanId(), callerOrgId)
                .orElseThrow(() -> ApiException.notFound("가져오기 계획을 찾을 수 없습니다."));
        return new BoundPlan(plan, accountOf(callerOrgId, plan));
    }

    // ─────────────────────────────────────────────────────────────── the chain

    private BoundLaunch bind(UUID callerOrgId, ReviewImportLaunch ticket) {
        if (callerOrgId == null || !callerOrgId.equals(ticket.getOrgId())) {
            throw ApiException.notFound(REF_NOT_FOUND);
        }
        // The account the ticket names must still be THIS org's, and the channel it names must be the
        // account's own. Re-read rather than trusted: the ticket holds a copy made when it was minted.
        SellerAccount account = sellerAccounts.findByIdAndOrgId(ticket.getSellerAccountId(), callerOrgId)
                .orElseThrow(() -> ApiException.notFound(REF_NOT_FOUND));
        if (!account.getChannelId().equals(ticket.getChannelId())) {
            throw ApiException.notFound(REF_NOT_FOUND);
        }
        Channel channel = channels.findById(ticket.getChannelId())
                .orElseThrow(() -> ApiException.notFound(REF_NOT_FOUND));

        if (ticket.getKind() == ReviewImportLaunchKind.DISCOVERY) {
            return new BoundLaunch(ticket, account, channel, null, null);
        }

        ReviewImportSegment segment = segments.findByIdAndOrgId(ticket.getSegmentId(), callerOrgId)
                .orElseThrow(() -> ApiException.notFound(REF_NOT_FOUND));
        ReviewImportPlan plan = plans.findByIdAndOrgId(segment.getPlanId(), callerOrgId)
                .orElseThrow(() -> ApiException.notFound(REF_NOT_FOUND));
        // The ticket must name the plan its own segment belongs to, and the plan must be about the same
        // account and channel the ticket authorizes. Any disagreement means the ticket no longer describes
        // a real piece of work, and guessing which half is right is not this fence's job.
        if (ticket.getPlanId() != null && !ticket.getPlanId().equals(plan.getId())) {
            throw ApiException.notFound(REF_NOT_FOUND);
        }
        if (!plan.getSellerAccountId().equals(ticket.getSellerAccountId())
                || !plan.getChannelId().equals(ticket.getChannelId())) {
            throw ApiException.notFound(REF_NOT_FOUND);
        }
        return new BoundLaunch(ticket, account, channel, plan, segment);
    }

    private SellerAccount accountOf(UUID callerOrgId, ReviewImportPlan plan) {
        SellerAccount account = sellerAccounts.findByIdAndOrgId(plan.getSellerAccountId(), callerOrgId)
                .orElseThrow(() -> ApiException.notFound("연동할 채널 계정을 찾을 수 없습니다."));
        if (!account.getChannelId().equals(plan.getChannelId())) {
            throw ApiException.notFound("가져오기 계획을 찾을 수 없습니다.");
        }
        return account;
    }
}
