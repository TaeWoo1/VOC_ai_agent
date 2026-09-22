package com.sellerops.operations;

import com.sellerops.attention.OperatorAttentionService;
import com.sellerops.attention.reply.ReviewReplyWorkState;
import com.sellerops.auth.AuthPrincipal;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.operations.dto.ReviewWorkView;
import com.sellerops.review.triage.ReviewTriageChannelCapability;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.util.ArrayList;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.security.core.annotation.AuthenticationPrincipal;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * The review half of 확인할 일, whole — READ only (UI/UX v2 Phase 3). See {@link ReviewWorkView}.
 *
 * <p>Composed from two reads that already exist and already mean what they say: the Home's undecided-확인 필요
 * predicate, and each account's reply to-do. Only accounts whose channel has a reply flow are asked, because only
 * those can hold a reply to-do; the question is the capability table's, not this class's.
 */
@RestController
@RequestMapping("/api/operations")
public class ReviewWorkController {

    /** Enough for any morning; the count beside the list still says how many exist. */
    static final int MAX_ATTENTION = 100;
    static final int MAX_TODO = 100;
    /** The same five the 리뷰 screen's 「최근에 기록한 답변」 showed. */
    static final int RECENT = 5;
    private static final Set<String> STILL_THE_SELLERS =
            Set.of(ReviewReplyWorkState.DRAFT_NEEDED.name(), ReviewReplyWorkState.AWAITING_APPROVAL.name());

    private final OperationsHomeService home;
    private final OperatorAttentionService attention;
    private final SellerAccountRepository accounts;
    private final ChannelRepository channels;

    public ReviewWorkController(OperationsHomeService home, OperatorAttentionService attention,
                                SellerAccountRepository accounts, ChannelRepository channels) {
        this.home = home;
        this.attention = attention;
        this.accounts = accounts;
        this.channels = channels;
    }

    @GetMapping("/review-work")
    public ReviewWorkView reviewWork(@AuthenticationPrincipal AuthPrincipal principal) {
        UUID orgId = principal.orgId();
        Map<UUID, Channel> byId = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, Function.identity(), (a, b) -> a));
        List<ReviewWorkView.AccountWork> committed = new ArrayList<>();
        for (SellerAccount account : accounts.findAllByOrgId(orgId)) {
            Channel channel = byId.get(account.getChannelId());
            if (channel == null || !ReviewTriageChannelCapability.of(channel.getCode()).replyFlowExists()) {
                continue;
            }
            var work = attention.replyWork(orgId, account.getId(), MAX_TODO, RECENT);
            committed.add(new ReviewWorkView.AccountWork(account.getId(), channel.getCode(), channel.getNameKo(),
                    work.coverage() == null ? null : work.coverage().name(),
                    work.todo().stream().filter(t -> STILL_THE_SELLERS.contains(t.replyWorkState())).toList(),
                    work.recentlyReported()));
        }
        return new ReviewWorkView(home.undecidedAttentionCount(orgId), home.undecidedAttention(orgId, MAX_ATTENTION),
                committed);
    }
}
