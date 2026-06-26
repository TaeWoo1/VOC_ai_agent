package com.sellerops.attention;

import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.dto.OperatorVocItem;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.BackfillWindow;
import com.sellerops.common.ApiException;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.community.Cafe24CommunityArticle;
import com.sellerops.community.Cafe24CommunityArticleRepository;
import com.sellerops.community.CommunityReplyStatus;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneId;
import java.util.List;
import java.util.UUID;
import org.springframework.data.domain.Page;
import org.springframework.data.domain.PageRequest;
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
    /** Operator-facing source kinds (the stored PRODUCT_INQUIRY shows as INQUIRY). */
    static final String SOURCE_TYPE_REVIEW = "REVIEW";
    static final String SOURCE_TYPE_INQUIRY = "INQUIRY";
    /** Drill-down page-size ceiling (mirrors the article-list drill-down). */
    static final int MAX_PAGE_SIZE = 50;

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

    /**
     * One page of the metadata-only rows behind a chosen attention signal, over the
     * same validated KST window as {@link #attention}. {@code type} is an
     * {@link AttentionSignalType} name (unknown → bad request); {@link AttentionItemFilters}
     * maps it to the row predicates, so the drilled rows match that signal's count.
     * No article body is exposed — the {@link OperatorVocItem} shape carries metadata only.
     */
    @Transactional(readOnly = true)
    public OperatorVocItemPage attentionItems(UUID orgId, UUID accountId, String type,
                                              LocalDate from, LocalDate to, int page, int size) {
        SellerAccount account = requireAccount(orgId, accountId);
        AttentionSignalType signalType = parseType(type);
        BackfillWindow window = BackfillWindow.of(from, to);
        Instant fromInstant = window.startDate().atStartOfDay(KST).toInstant();
        Instant toExclusive = window.endDate().plusDays(1).atStartOfDay(KST).toInstant();

        VocItemFilter filter = AttentionItemFilters.forType(signalType);
        int safeSize = Math.max(1, Math.min(size, MAX_PAGE_SIZE));
        int safePage = Math.max(0, page);
        Channel channel = channels.findById(account.getChannelId()).orElse(null);
        String channelCode = channel == null ? null : channel.getCode();
        String channelNameKo = channel == null ? null : channel.getNameKo();

        Page<Cafe24CommunityArticle> result = articles.findInWindowFiltered(
                orgId, accountId, filter.sourceKind(), filter.replyStatus(),
                filter.minRating(), filter.maxRating(), fromInstant, toExclusive,
                PageRequest.of(safePage, safeSize));
        List<OperatorVocItem> rows = result.getContent().stream()
                .map(a -> toItem(a, signalType, channelCode, channelNameKo))
                .toList();
        return new OperatorVocItemPage(signalType.name(), window.startDate(), window.endDate(),
                safePage, safeSize, result.getTotalElements(), rows);
    }

    private OperatorVocItem toItem(Cafe24CommunityArticle a, AttentionSignalType signalType,
                                   String channelCode, String channelNameKo) {
        String sourceType = SOURCE_KIND_REVIEW.equals(a.getSourceKind()) ? SOURCE_TYPE_REVIEW : SOURCE_TYPE_INQUIRY;
        // Read-time, fail-closed preview — never the raw body, never persisted/logged.
        String rawText = a.getContent() == null || a.getContent().isBlank() ? a.getTitle() : a.getContent();
        String safePreview = VocPreviewSanitizer.sanitize(rawText).text();
        return new OperatorVocItem(channelCode, channelNameKo, sourceType, a.getRating(), a.getReplyStatus(),
                kstDate(a.getSourceCreatedAt()), kstDate(a.getCollectedAt()), signalType.name(), safePreview);
    }

    /** Parse an operator drill-down type into a signal type; unknown → bad request. */
    private static AttentionSignalType parseType(String type) {
        if (type == null || type.isBlank()) {
            throw ApiException.badRequest("확인할 신호 유형(type)을 지정해 주세요.");
        }
        try {
            return AttentionSignalType.valueOf(type.strip());
        } catch (IllegalArgumentException e) {
            throw ApiException.badRequest("지원되지 않는 신호 유형입니다.");
        }
    }

    /** Instant → KST calendar date string (date only), or null when unknown. */
    private static String kstDate(Instant instant) {
        return instant == null ? null : instant.atZone(KST).toLocalDate().toString();
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
