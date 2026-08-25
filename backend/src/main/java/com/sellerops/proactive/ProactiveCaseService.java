package com.sellerops.proactive;

import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.common.ApiException;
import com.sellerops.common.MarkupText;
import com.sellerops.inbox.InboxService;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.proactive.dto.ProactiveCaseListResponse;
import com.sellerops.proactive.dto.ProactiveCaseView;
import com.sellerops.proactive.dto.ProactiveSummaryView;
import com.sellerops.proactive.dto.ProactiveTelemetryView;
import com.sellerops.product.OperatorProductName;
import com.sellerops.product.Product;
import com.sellerops.product.ProductRepository;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Objects;
import java.util.UUID;
import java.util.function.Function;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The read side of 「AI가 먼저 확인한 일」, plus the two telemetry marks a read is the only honest
 * place to make.
 *
 * <p><b>It decides nothing about status.</b> {@link ProactiveCaseReconciler} is the only writer of
 * {@link ProactiveCaseStatus}; this class writes {@code surfaced_at} and {@code opened_at}, which are
 * facts about the SCREEN rather than about the work, and which nothing else is in a position to
 * observe. Everything else it does is projection.
 *
 * <p><b>The subject is loaded to render, never to re-judge.</b> A case that names an inquiry the org
 * no longer holds is dropped from the list rather than rendered blank — the same rule the work queue
 * follows — and the reconciler closes it on its next pass.
 */
@Service
public class ProactiveCaseService {

    /** The list's default and ceiling. Bounded for the reason every operator read here is. */
    public static final int DEFAULT_LIMIT = 20;
    public static final int MAX_LIMIT = 100;

    private final ProactiveCaseRepository cases;
    private final InquiryRepository inquiries;
    private final ReviewRepository reviews;
    private final ChannelRepository channels;
    private final ProductRepository products;
    private final Clock clock;

    @Autowired
    public ProactiveCaseService(ProactiveCaseRepository cases, InquiryRepository inquiries,
                                ReviewRepository reviews, ChannelRepository channels,
                                ProductRepository products) {
        this(cases, inquiries, reviews, channels, products, Clock.systemUTC());
    }

    ProactiveCaseService(ProactiveCaseRepository cases, InquiryRepository inquiries,
                         ReviewRepository reviews, ChannelRepository channels,
                         ProductRepository products, Clock clock) {
        this.cases = cases;
        this.inquiries = inquiries;
        this.reviews = reviews;
        this.channels = channels;
        this.products = products;
        this.clock = clock;
    }

    @Transactional
    public ProactiveCaseListResponse list(UUID orgId, int limit) {
        int size = Math.max(1, Math.min(MAX_LIMIT, limit));
        List<ProactiveCase> open = cases.findOpen(orgId, ProactiveCaseStatus.PREPARED,
                PageRequest.of(0, size));

        Map<UUID, Inquiry> inquiryById = inquiries.findAllById(idsOf(open, ProactiveSubjectKind.INQUIRY))
                .stream().filter(i -> i.getOrgId().equals(orgId))
                .collect(Collectors.toMap(Inquiry::getId, Function.identity()));
        Map<UUID, Review> reviewById = reviews.findAllById(idsOf(open, ProactiveSubjectKind.REVIEW))
                .stream().filter(r -> r.getOrgId().equals(orgId))
                .collect(Collectors.toMap(Review::getId, Function.identity()));
        Map<UUID, Channel> channelById = channels
                .findAllById(open.stream().map(ProactiveCase::getChannelId).filter(Objects::nonNull)
                        .distinct().toList())
                .stream().collect(Collectors.toMap(Channel::getId, Function.identity()));
        Map<UUID, String> productNames = products
                .findAllById(open.stream().map(ProactiveCase::getProductId).filter(Objects::nonNull)
                        .distinct().toList())
                .stream().collect(java.util.HashMap::new,
                        (m, p) -> m.put(p.getId(), OperatorProductName.displayNameOrNull(p)),
                        java.util.HashMap::putAll);

        Instant now = clock.instant();
        List<ProactiveCaseView> views = new ArrayList<>(open.size());
        for (ProactiveCase row : open) {
            ProactiveCaseView view = render(row, inquiryById, reviewById, channelById, productNames);
            if (view == null) {
                continue;   // The subject is gone; the reconciler closes the case on its next pass.
            }
            views.add(view);
            if (row.getSurfacedAt() == null) {
                // "Surfaced" means a seller could have seen it. This is the only place that is true.
                row.setSurfacedAt(now);
                cases.save(row);
            }
        }
        // Re-sorted by the DECLARED priority rank, not by the enum's spelling — the repository's
        // ORDER BY only has to make a bounded page stable.
        views.sort(Comparator.comparingInt((ProactiveCaseView v) -> ProactivePriority.valueOf(v.priority()).rank())
                .thenComparing(ProactiveCaseView::preparedAt, Comparator.reverseOrder()));

        return new ProactiveCaseListResponse(views,
                cases.countByOrgIdAndStatus(orgId, ProactiveCaseStatus.PREPARED),
                cases.countByOrgIdAndStatusAndPriority(orgId, ProactiveCaseStatus.PREPARED,
                        ProactivePriority.HIGH));
    }

    /** The home screen's entry point: counts, never a second copy of the list. */
    @Transactional(readOnly = true)
    public ProactiveSummaryView summary(UUID orgId) {
        return new ProactiveSummaryView(
                cases.countByOrgIdAndStatus(orgId, ProactiveCaseStatus.PREPARED),
                cases.countByOrgIdAndStatusAndPriority(orgId, ProactiveCaseStatus.PREPARED,
                        ProactivePriority.HIGH),
                cases.countByOrgIdAndPreparedAction(orgId, ProactivePreparedAction.DRAFT_PREPARED));
    }

    /**
     * Record that the seller opened this case, and hand back what it says.
     *
     * <p>Idempotent on the mark: {@code opened_at} is the FIRST open, because "how long until someone
     * looked at it" is the question, and overwriting it with the latest visit would answer a different
     * one.
     */
    @Transactional
    public ProactiveCaseView open(UUID orgId, UUID caseId) {
        ProactiveCase row = cases.findByIdAndOrgId(caseId, orgId)
                .orElseThrow(() -> ApiException.notFound("확인할 항목을 찾을 수 없습니다."));
        if (row.getOpenedAt() == null) {
            row.setOpenedAt(clock.instant());
            cases.save(row);
        }
        ProactiveCaseView view = render(row,
                subjectMap(orgId, row, ProactiveSubjectKind.INQUIRY),
                subjectMapReview(orgId, row),
                row.getChannelId() == null ? Map.of()
                        : channels.findById(row.getChannelId())
                                .map(c -> Map.of(c.getId(), c)).orElse(Map.of()),
                row.getProductId() == null ? Map.of()
                        : products.findById(row.getProductId())
                                .map(p -> nameMap(p)).orElse(Map.of()));
        if (view == null) {
            throw ApiException.notFound("확인할 항목의 원본을 찾을 수 없습니다.");
        }
        return view;
    }

    @Transactional(readOnly = true)
    public ProactiveTelemetryView telemetry(UUID orgId) {
        // Every case this org has ever had, counted org-scoped in three reads rather than by a
        // table count — a bare count() here would put other tenants' work into this org's number.
        long prepared = cases.countByOrgIdAndStatus(orgId, ProactiveCaseStatus.PREPARED)
                + cases.countByOrgIdAndStatus(orgId, ProactiveCaseStatus.ACTED)
                + cases.countByOrgIdAndStatus(orgId, ProactiveCaseStatus.CLOSED);
        long acted = cases.countByOrgIdAndStatus(orgId, ProactiveCaseStatus.ACTED);
        List<Object[]> pairs = cases.actedTimestamps(orgId, PageRequest.of(0, 500));
        Long median = medianSeconds(pairs);
        return new ProactiveTelemetryView(
                prepared,
                cases.countByOrgIdAndSurfacedAtIsNotNull(orgId),
                cases.countByOrgIdAndOpenedAtIsNotNull(orgId),
                acted,
                cases.countByOrgIdAndStatus(orgId, ProactiveCaseStatus.CLOSED),
                cases.countByOrgIdAndPreparedAction(orgId, ProactivePreparedAction.DRAFT_PREPARED),
                median);
    }

    /**
     * The median, not the mean — one case a seller left for a fortnight would drag an average into
     * fiction, and the number exists to be believed.
     */
    static Long medianSeconds(List<Object[]> pairs) {
        List<Long> seconds = pairs.stream()
                .filter(p -> p[0] instanceof Instant && p[1] instanceof Instant)
                .map(p -> Duration.between((Instant) p[0], (Instant) p[1]).getSeconds())
                .filter(s -> s >= 0)
                .sorted()
                .toList();
        if (seconds.isEmpty()) {
            return null;
        }
        int middle = seconds.size() / 2;
        return seconds.size() % 2 == 1
                ? seconds.get(middle)
                : (seconds.get(middle - 1) + seconds.get(middle)) / 2;
    }

    // ------------------------------------------------------------------ rendering

    private ProactiveCaseView render(ProactiveCase row, Map<UUID, Inquiry> inquiryById,
                                     Map<UUID, Review> reviewById, Map<UUID, Channel> channelById,
                                     Map<UUID, String> productNames) {
        String snippet;
        Integer rating = null;
        Instant receivedAt;
        if (row.getSubjectKind() == ProactiveSubjectKind.INQUIRY) {
            Inquiry inquiry = inquiryById.get(row.getSubjectId());
            if (inquiry == null) {
                return null;
            }
            // The title is what a seller recognises the question by; the body preview is masked by
            // the inbox's own rule when the title is empty (Cafe24 board posts often carry none).
            String title = MarkupText.toPlainText(inquiry.getTitle());
            snippet = title == null || title.isBlank() ? InboxService.snippet(inquiry.getBody()) : title;
            receivedAt = inquiry.getReceivedAt();
        } else {
            Review review = reviewById.get(row.getSubjectId());
            if (review == null) {
                return null;
            }
            snippet = InboxService.snippet(review.getBody());
            rating = review.getRating();
            receivedAt = review.getReceivedAt();
        }
        Channel channel = row.getChannelId() == null ? null : channelById.get(row.getChannelId());
        String productName = row.getProductId() == null ? null : productNames.get(row.getProductId());
        return new ProactiveCaseView(
                row.getId(),
                row.getSubjectKind().name(),
                row.getSubjectId(),
                row.getWorkItemId(),
                row.getChannelId(),
                channel == null ? null : channel.getNameKo(),
                // A product id with no display name is ingest's shared bucket, not a product — the
                // same rule the queue and the inbox follow. Both go, so the screen says 상품 미지정.
                productName == null ? null : row.getProductId(),
                productName,
                snippet,
                rating,
                row.getPriority().name(),
                row.getReason().name(),
                row.getReasonNote(),
                row.getEvidenceState(),
                row.getEvidenceCount(),
                row.getKnowledgeGap(),
                row.getPreparedAction().name(),
                row.getDraftVersion(),
                row.getRecommendation(),
                receivedAt,
                row.getCreatedAt());
    }

    private static Map<UUID, String> nameMap(Product product) {
        String display = OperatorProductName.displayNameOrNull(product);
        return display == null ? Map.of() : Map.of(product.getId(), display);
    }

    private Map<UUID, Inquiry> subjectMap(UUID orgId, ProactiveCase row, ProactiveSubjectKind kind) {
        if (row.getSubjectKind() != kind) {
            return Map.of();
        }
        return inquiries.findById(row.getSubjectId())
                .filter(i -> i.getOrgId().equals(orgId))
                .map(i -> Map.of(i.getId(), i))
                .orElse(Map.of());
    }

    private Map<UUID, Review> subjectMapReview(UUID orgId, ProactiveCase row) {
        if (row.getSubjectKind() != ProactiveSubjectKind.REVIEW) {
            return Map.of();
        }
        return reviews.findById(row.getSubjectId())
                .filter(r -> r.getOrgId().equals(orgId))
                .map(r -> Map.of(r.getId(), r))
                .orElse(Map.of());
    }

    private static List<UUID> idsOf(List<ProactiveCase> rows, ProactiveSubjectKind kind) {
        return rows.stream().filter(r -> r.getSubjectKind() == kind)
                .map(ProactiveCase::getSubjectId).distinct().toList();
    }
}
