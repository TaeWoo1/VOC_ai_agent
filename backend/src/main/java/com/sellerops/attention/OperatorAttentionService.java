package com.sellerops.attention;

import com.sellerops.attention.dto.AttentionSignal;
import com.sellerops.attention.dto.OperatorAttentionSummary;
import com.sellerops.attention.dto.OperatorVocItemPage;
import com.sellerops.attention.source.VocItemSlice;
import com.sellerops.attention.source.VocItemSource;
import com.sellerops.attention.source.VocItemSourceRegistry;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.collect.BackfillWindow;
import com.sellerops.common.ApiException;
import com.sellerops.selleraccount.SellerAccount;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.LocalDate;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Channel-generic operator attention layer: turns one account's collected VOC counts
 * over an explicit window into ranked, actionable {@link AttentionSignal}s. A thin
 * read-side companion to the PR #130 dashboard surface — same account-scoped,
 * window-validated, metadata-only pattern.
 *
 * <p>The data access is delegated to a per-channel {@link VocItemSource} (resolved by
 * {@link VocItemSourceRegistry}); this service owns only the channel-generic concerns:
 * org-scoped account resolution, window validation, signal-rule evaluation, and the
 * public page envelope. A channel with no source (e.g. GMARKET today) resolves to a
 * safe empty state — never a fabricated signal. This service reads no clock — the
 * window is always supplied by the caller — and never loads an article body, so no
 * title/content/identifier can leak.
 */
@Service
public class OperatorAttentionService {

    /** Drill-down page-size ceiling (mirrors the article-list drill-down). */
    static final int MAX_PAGE_SIZE = 50;
    /** A channel with no source contributes no counts — yields zero signals. */
    private static final VocWindowSnapshot EMPTY_SNAPSHOT =
            new VocWindowSnapshot(0, 0, 0, 0, 0, 0, 0, 0);

    private final SellerAccountRepository sellerAccounts;
    private final ChannelRepository channels;
    private final VocItemSourceRegistry sources;

    public OperatorAttentionService(SellerAccountRepository sellerAccounts, ChannelRepository channels,
                                    VocItemSourceRegistry sources) {
        this.sellerAccounts = sellerAccounts;
        this.channels = channels;
        this.sources = sources;
    }

    /**
     * Attention summary for one account over the closed window [{@code from},
     * {@code to}] (validated here). Each signal is an exact count of collected
     * review/inquiry rows whose source date falls in the window; severity and labels
     * are assigned by {@link AttentionSignalRules}.
     */
    @Transactional(readOnly = true)
    public OperatorAttentionSummary attention(UUID orgId, UUID accountId, LocalDate from, LocalDate to) {
        SellerAccount account = requireAccount(orgId, accountId);
        // Reuse the backfill window validator (closed, non-inverted, both bounds present).
        BackfillWindow window = BackfillWindow.of(from, to);
        Channel channel = channels.findById(account.getChannelId()).orElse(null);
        String channelCode = channel == null ? null : channel.getCode();
        String channelNameKo = channel == null ? null : channel.getNameKo();

        VocWindowSnapshot snapshot = sources.forChannel(channelCode)
                .map(s -> s.snapshot(orgId, accountId, window.startDate(), window.endDate()))
                .orElse(EMPTY_SNAPSHOT);

        List<AttentionSignal> items = AttentionSignalRules.evaluate(snapshot, channelNameKo);
        return new OperatorAttentionSummary(accountId, channelNameKo, window.startDate(), window.endDate(), items);
    }

    /**
     * One page of the metadata-only rows behind a chosen attention signal, over the
     * same validated window as {@link #attention}. {@code type} is an
     * {@link AttentionSignalType} name (unknown → bad request). The resolved
     * {@link VocItemSource} maps it to the matching rows so the drilled rows match that
     * signal's count; no article body is exposed.
     */
    @Transactional(readOnly = true)
    public OperatorVocItemPage attentionItems(UUID orgId, UUID accountId, String type,
                                              LocalDate from, LocalDate to, int page, int size) {
        SellerAccount account = requireAccount(orgId, accountId);
        AttentionSignalType signalType = parseType(type);
        BackfillWindow window = BackfillWindow.of(from, to);
        int safeSize = Math.max(1, Math.min(size, MAX_PAGE_SIZE));
        int safePage = Math.max(0, page);
        Channel channel = channels.findById(account.getChannelId()).orElse(null);
        String channelCode = channel == null ? null : channel.getCode();
        String channelNameKo = channel == null ? null : channel.getNameKo();

        VocItemSlice slice = sources.forChannel(channelCode)
                .map(s -> s.items(orgId, accountId, channelCode, channelNameKo,
                        signalType, window.startDate(), window.endDate(), safePage, safeSize))
                .orElse(VocItemSlice.empty());

        return new OperatorVocItemPage(signalType.name(), window.startDate(), window.endDate(),
                safePage, safeSize, slice.total(), slice.items());
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

    private SellerAccount requireAccount(UUID orgId, UUID accountId) {
        // Org scoping at the query boundary — a cross-org id reads as absent.
        return sellerAccounts.findByIdAndOrgId(accountId, orgId)
                .orElseThrow(() -> ApiException.notFound("판매 계정을 찾을 수 없습니다."));
    }
}
