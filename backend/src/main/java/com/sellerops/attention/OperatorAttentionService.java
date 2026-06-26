package com.sellerops.attention;

import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.BackfillWindow;
import com.sellerops.common.ApiException;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Channel-generic operator attention layer: turns one account's collected VOC
 * counts over an explicit window into ranked, actionable {@link AttentionSignal}s.
 * A thin read-side companion to the PR #130 dashboard surface — same account-scoped,
 * window-validated, metadata-only pattern — that reads exact aggregate counts from
 * the Cafe24 community-article store (today's only source) behind generic DTOs.
 *
 * <p>The window is always supplied by the caller — this service reads no clock — and
 * is interpreted in the channel policy zone ({@link #KST} for Cafe24). No article
 * body is ever loaded: signals are pure counts, so no title/content/identifier can
 * leak. Counts cover known-date rows only (unknown source dates excluded upstream).
 */
@Service
public class OperatorAttentionService {

    /** Cafe24's explicit platform zone; window "day" boundaries are KST. */
    static final ZoneId KST = ZoneId.of("Asia/Seoul");
    static final String SOURCE_KIND_REVIEW = "REVIEW";
    static final String SOURCE_KIND_INQUIRY = "PRODUCT_INQUIRY";

    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;
    private final Cafe24CommunityArticleRepository articles;

    public OperatorAttentionService(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                                    Cafe24CommunityArticleRepository articles) {
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
        this.articles = articles;
    }

    /**
     * Attention summary for one account over the closed window [{@code from},
     * {@code to}] (validated here). Each signal is an exact count of collected
     * review/inquiry rows whose source date falls in the window; severity and
     * labels are assigned by {@link AttentionSignalRules}.
     */
    @Transactional(readOnly = true)
    public OperatorAttentionSummary attention(UUID orgId, UUID accountId, LocalDate from, LocalDate to) {
        SellerAccount account = requireAccount(orgId, accountId);
        // Reuse the backfill window validator (closed, non-inverted, both bounds present).
        BackfillWindow window = BackfillWindow.of(from, to);
        Instant fromInstant = window.startDate().atStartOfDay(KST).toInstant();
        Instant toExclusive = window.endDate().plusDays(1).atStartOfDay(KST).toInstant();

        VocWindowSnapshot snapshot = new VocWindowSnapshot(
                articles.countInWindow(orgId, accountId, SOURCE_KIND_REVIEW, fromInstant, toExclusive),
                articles.countInWindow(orgId, accountId, SOURCE_KIND_INQUIRY, fromInstant, toExclusive),
                articles.countInWindowByReplyStatus(orgId, accountId, SOURCE_KIND_INQUIRY,
                        CommunityReplyStatus.PENDING.name(), fromInstant, toExclusive),
                articles.countInWindowByReplyStatus(orgId, accountId, SOURCE_KIND_INQUIRY,
                        CommunityReplyStatus.UNKNOWN.name(), fromInstant, toExclusive),
                articles.countInWindowByRatingBetween(orgId, accountId, SOURCE_KIND_REVIEW,
                        1, 2, fromInstant, toExclusive),
                articles.countInWindowByRatingBetween(orgId, accountId, SOURCE_KIND_REVIEW,
                        3, 3, fromInstant, toExclusive));

        String channel = channelNameKo(account.getChannelId());
        List<AttentionSignal> items = AttentionSignalRules.evaluate(snapshot, channel);
        return new OperatorAttentionSummary(accountId, channel, window.startDate(), window.endDate(), items);
    }

    private String channelNameKo(UUID channelId) {
        return channels.findById(channelId).map(Channel::getNameKo).orElse(null);
    }

    private SellerAccount requireAccount(UUID orgId, UUID accountId) {
        // Org scoping at the query boundary — a cross-org id reads as absent.
        return sellerAccounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
    }
}
