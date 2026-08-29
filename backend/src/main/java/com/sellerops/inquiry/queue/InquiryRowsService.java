package com.sellerops.inquiry.queue;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.queue.dto.InquiryRowItem;
import com.sellerops.inquiry.queue.dto.InquiryRowsResponse;
import com.sellerops.inquiry.workitem.InquiryWorkItem;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.product.OperatorProductName;
import com.sellerops.channel.ProductChannels;
import com.sellerops.product.ProductRepository;
import java.time.Clock;
import java.time.Instant;
import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.EnumSet;
import java.util.HashMap;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import org.springframework.data.domain.PageRequest;
import org.springframework.data.domain.Sort;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The customer's inquiries as ROWS (Query Accuracy v1, 2026-08-28).
 *
 * <p><b>This is not the work queue.</b> {@link InquiryQueueService} answers 「내가 답해야 할 일」 over
 * {@code InquiryWorkItem} phases; this read answers 「최근 문의 3개」 / 「오늘 네이버 문의」 / 「답변 안 한
 * 것만」 over {@link Inquiry} itself — a receipt window, one channel or all, one status or all, newest or
 * oldest first, cut to a limit. Every axis is a closed token the caller chose; nothing here reads the
 * seller's sentence. The open/proposed work item, when one exists, rides along on the row so a later
 * 「첫 번째 거 답변 준비해줘」 can find it without a second read.
 *
 * <p>Same floor as the queue: ACTIVE and {@code REAL} rows only, no buyer identity, no raw body.
 */
@Service
public class InquiryRowsService {

    public static final int DEFAULT_LIMIT = 20;
    public static final int MAX_LIMIT = 50;
    /** How far back a window with no {@code from} reaches — the epoch, i.e. the whole history. */
    private static final Instant BEGINNING = Instant.EPOCH;
    private static final EnumSet<InquiryWorkItemPhase> WORKABLE = EnumSet.of(InquiryWorkItemPhase.OPEN, InquiryWorkItemPhase.PROPOSED);

    private final InquiryRepository inquiries;
    private final InquiryWorkItemRepository workItems;
    private final ChannelRepository channels;
    private final ProductRepository products;
    private final com.sellerops.identity.ExecutableIdentityResolver identity;
    private final Clock clock;

    @org.springframework.beans.factory.annotation.Autowired
    public InquiryRowsService(InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                              ChannelRepository channels, ProductRepository products,
                              com.sellerops.identity.ExecutableIdentityResolver identity) {
        this(inquiries, workItems, channels, products, identity, Clock.systemUTC());
    }

    public InquiryRowsService(InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                              ChannelRepository channels, ProductRepository products,
                              com.sellerops.identity.ExecutableIdentityResolver identity, Clock clock) {
        this.inquiries = inquiries;
        this.workItems = workItems;
        this.channels = channels;
        this.products = products;
        this.identity = identity;
        this.clock = clock;
    }

    /**
     * @param from inclusive calendar date (UTC, the zone {@code receivedAt} is stored in); null = no lower bound
     * @param to inclusive calendar date; null = today
     * @param channel one of {@link ProductChannels#VISIBLE_CODES}, or null for all
     * @param status {@code UNANSWERED} | {@code ANSWERED} | {@code ALL}/null
     * @param order {@code NEWEST} (default) | {@code OLDEST}
     * @param limit rows to return, clamped to [1, {@link #MAX_LIMIT}]
     */
    @Transactional(readOnly = true)
    public InquiryRowsResponse rows(UUID orgId, LocalDate from, LocalDate to, String channel, String status,
                                    String order, Integer limit) {
        LocalDate toDate = to == null ? LocalDate.now(clock) : to;
        if (from != null && from.isAfter(toDate)) {
            throw ApiException.badRequest("조회 기간의 시작일이 종료일보다 늦습니다.");
        }
        Instant start = from == null ? BEGINNING : from.atStartOfDay(ZoneOffset.UTC).toInstant();
        Instant end = toDate.plusDays(1).atStartOfDay(ZoneOffset.UTC).toInstant();
        String statusToken = statusToken(status);
        String statusFilter = "ALL".equals(statusToken) ? null : statusToken;
        boolean oldest = oldestFirst(order);
        int size = limit == null ? DEFAULT_LIMIT : Math.max(1, Math.min(MAX_LIMIT, limit));

        UUID channelId = null;
        String channelCode = null;
        if (channel != null && !channel.isBlank()) {
            channelCode = channel.strip().toUpperCase(Locale.ROOT);
            if (!ProductChannels.isVisible(channelCode)) {
                // Refused rather than widened: a seller who asked for one channel and silently got all
                // three would read the answer as that channel's.
                throw ApiException.badRequest("알 수 없는 채널입니다.");
            }
            Optional<Channel> found = channels.findByCode(channelCode);
            if (found.isEmpty()) {
                return new InquiryRowsResponse(from, toDate, channelCode, statusToken, oldest ? "OLDEST" : "NEWEST",
                        size, 0, List.of());
            }
            channelId = found.get().getId();
        }

        Sort sort = oldest
                ? Sort.by(Sort.Order.asc("receivedAt"), Sort.Order.asc("id"))
                : Sort.by(Sort.Order.desc("receivedAt"), Sort.Order.desc("id"));
        List<Inquiry> page = inquiries.findRowsInWindow(orgId, channelId, statusFilter, start, end,
                PageRequest.of(0, size, sort));
        long total = inquiries.countRowsInWindow(orgId, channelId, statusFilter, start, end);

        Map<UUID, Channel> channelsById = new HashMap<>();
        for (Channel ch : channels.findAllById(page.stream().map(Inquiry::getChannelId).filter(java.util.Objects::nonNull).distinct().toList())) {
            channelsById.put(ch.getId(), ch);
        }
        Map<UUID, String> productNames = new HashMap<>();
        products.findAllByOrgIdAndIdIn(orgId, page.stream().map(Inquiry::getProductId).filter(java.util.Objects::nonNull).distinct().toList())
                .forEach(p -> productNames.put(p.getId(), OperatorProductName.displayNameOrNull(p)));
        // The open/proposed work item per inquiry, when one exists. Terminal work items (answered,
        // dismissed) are not "the seller's next act" and are left off the row.
        Map<UUID, InquiryWorkItem> workable = new HashMap<>();
        for (InquiryWorkItem w : workItems.findByInquiryIdIn(page.stream().map(Inquiry::getId).toList())) {
            if (WORKABLE.contains(w.getPhase())) {
                workable.put(w.getInquiryId(), w);
            }
        }
        Map<UUID, com.sellerops.identity.ExecutableIdentity> identities = identity.forInquiries(orgId, page);

        List<InquiryRowItem> items = page.stream()
                .map(q -> toItem(q, channelsById.get(q.getChannelId()), productNames, workable.get(q.getId()),
                        identities.getOrDefault(q.getId(), com.sellerops.identity.ExecutableIdentity.NONE)))
                .toList();
        return new InquiryRowsResponse(from, toDate, channelCode, statusToken, oldest ? "OLDEST" : "NEWEST",
                size, total, items);
    }

    private static InquiryRowItem toItem(Inquiry q, Channel channel, Map<UUID, String> productNames,
                                         InquiryWorkItem workItem,
                                         com.sellerops.identity.ExecutableIdentity executableIdentity) {
        String productName = q.getProductId() == null ? null : productNames.get(q.getProductId());
        return new InquiryRowItem(
                q.getId(),
                workItem == null ? null : workItem.getId(),
                q.getSellerAccountId(),
                q.getChannelId(),
                channel == null ? null : channel.getCode(),
                channel == null ? null : channel.getNameKo(),
                productName == null ? null : q.getProductId(),
                productName,
                workItem == null ? null : workItem.getPhase().name(),
                q.getStatus(),
                q.getTitle(),
                q.getReceivedAt(),
                q.getAnsweredAt(),
                q.getSourceSubtype(),
                executableIdentity.name());
    }

    private static String statusToken(String status) {
        if (status == null || status.isBlank()) {
            return "ALL";
        }
        return switch (status.strip().toUpperCase(Locale.ROOT)) {
            case "UNANSWERED" -> "UNANSWERED";
            case "ANSWERED" -> "ANSWERED";
            case "ALL" -> "ALL";
            default -> throw ApiException.badRequest("알 수 없는 상태입니다.");
        };
    }

    private static boolean oldestFirst(String order) {
        if (order == null || order.isBlank()) {
            return false;
        }
        return switch (order.strip().toUpperCase(Locale.ROOT)) {
            case "NEWEST" -> false;
            case "OLDEST" -> true;
            default -> throw ApiException.badRequest("알 수 없는 정렬입니다.");
        };
    }
}
