package com.sellerops.operationscase;

import com.fasterxml.jackson.core.type.TypeReference;
import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.Channel;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.channel.ChannelStatus;
import com.sellerops.common.MarkupText;
import com.sellerops.common.SafePreviewResult;
import com.sellerops.common.VocPreviewSanitizer;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryOperationalState;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.workitem.InquiryWorkItemPhase;
import com.sellerops.inquiry.workitem.InquiryWorkItemRepository;
import com.sellerops.operationscase.dto.CustomerOperationsHomeView;
import com.sellerops.responsibility.Responsibility;
import com.sellerops.responsibility.ResponsibilityRepository;
import com.sellerops.responsibility.ResponsibilityRollout;
import com.sellerops.responsibility.ResponsibilityRun;
import com.sellerops.responsibility.ResponsibilityRunCoordinator;
import com.sellerops.responsibility.ResponsibilityRunRepository;
import com.sellerops.responsibility.ResponsibilityRunSource;
import com.sellerops.responsibility.ResponsibilityRunSourceRepository;
import com.sellerops.responsibility.ResponsibilitySources;
import com.sellerops.responsibility.ResponsibilityTemplate;
import com.sellerops.responsibility.ResponsibilityWindows;
import com.sellerops.responsibility.RunStatus;
import com.sellerops.responsibility.SourceFailureReason;
import com.sellerops.review.Review;
import com.sellerops.review.ReviewReplyState;
import com.sellerops.review.ReviewRepository;
import java.time.Clock;
import java.time.Duration;
import java.time.Instant;
import java.util.ArrayList;
import java.util.Arrays;
import java.util.Comparator;
import java.util.List;
import java.util.Map;
import java.util.Optional;
import java.util.UUID;
import java.util.stream.Collectors;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.data.domain.PageRequest;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * The Home's read of 「고객 운영 관리」. <b>Reads only — no model, no channel, no write.</b>
 *
 * <p>A case waits up to two hours for the next run to reconcile it, and the Home is read in between. So the decision
 * area applies the canonical record at read time: an inquiry the seller answered at 10:05 is not «내 결정 필요» at
 * 10:06, whatever the case row still says. That is a filter on what is shown, not a write — the reconciler is still
 * the only writer, and it records the same conclusion on the next run.
 */
@Service
public class CustomerOperationsHomeService {

    static final int MAX_ROWS = 5;
    /**
     * How deep a single read looks. The canonical-record filter runs in Java, so this is the page the database is
     * asked for — not a cap on what the seller may see. It is deliberately the same number for the briefing and the
     * queue: a `total` counted over a different depth than the rows is a total about a different question.
     */
    static final int SCAN = 200;
    static final int MAX_QUEUE_ROWS = SCAN;
    static final Duration HANDLED_PERIOD = Duration.ofHours(24);
    private static final ObjectMapper MAPPER = new ObjectMapper();

    private final ResponsibilityRepository responsibilities;
    private final ResponsibilityRunRepository runs;
    private final ResponsibilityRunSourceRepository sourceRows;
    private final ResponsibilitySources sources;
    private final ResponsibilityRollout rollout;
    private final OperationsCaseRepository cases;
    private final InquiryRepository inquiries;
    private final InquiryWorkItemRepository workItems;
    private final ReviewRepository reviews;
    private final ChannelRepository channels;
    private final Clock clock;

    @Autowired
    public CustomerOperationsHomeService(ResponsibilityRepository responsibilities, ResponsibilityRunRepository runs,
                                         ResponsibilityRunSourceRepository sourceRows, ResponsibilitySources sources,
                                         ResponsibilityRollout rollout, OperationsCaseRepository cases,
                                         InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                                         ReviewRepository reviews, ChannelRepository channels) {
        this(responsibilities, runs, sourceRows, sources, rollout, cases, inquiries, workItems, reviews, channels,
                Clock.systemUTC());
    }

    public CustomerOperationsHomeService(ResponsibilityRepository responsibilities, ResponsibilityRunRepository runs,
                                         ResponsibilityRunSourceRepository sourceRows, ResponsibilitySources sources,
                                         ResponsibilityRollout rollout, OperationsCaseRepository cases,
                                         InquiryRepository inquiries, InquiryWorkItemRepository workItems,
                                         ReviewRepository reviews, ChannelRepository channels, Clock clock) {
        this.responsibilities = responsibilities;
        this.runs = runs;
        this.sourceRows = sourceRows;
        this.sources = sources;
        this.rollout = rollout;
        this.cases = cases;
        this.inquiries = inquiries;
        this.workItems = workItems;
        this.reviews = reviews;
        this.channels = channels;
        this.clock = clock;
    }

    @Transactional(readOnly = true)
    public CustomerOperationsHomeView home(UUID orgId) {
        int cadence = (int) ResponsibilityWindows.LENGTH.toMinutes();
        if (!rollout.allows(orgId)) {
            return CustomerOperationsHomeView.unavailable(cadence);
        }
        ResponsibilityTemplate template = ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1;
        boolean eligible = sources.resolve(orgId, template).stream()
                .anyMatch(s -> s.account().getConnectionStatus() == ChannelStatus.CONNECTED);
        Optional<Responsibility> found = responsibilities.findByOrgIdAndTemplateCode(orgId, template);
        if (found.isEmpty()) {
            return new CustomerOperationsHomeView(true, eligible, null, cadence, null, null, null, List.of(),
                    new CustomerOperationsHomeView.Decisions(0, List.of()),
                    new CustomerOperationsHomeView.Handled(null, 0, 0, 0, 0, List.of(), 0),
                    new CustomerOperationsHomeView.Gaps(0, List.of()));
        }
        Responsibility r = found.get();
        Map<UUID, Channel> channelById = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, c -> c, (a, b) -> a));
        Map<String, Channel> channelByCode = channelById.values().stream()
                .collect(Collectors.toMap(Channel::getCode, c -> c, (a, b) -> a));

        ResponsibilityRun lastFinished = runs.findTop20ByResponsibilityIdOrderByWindowStartDesc(r.getId()).stream()
                .filter(run -> run.getFinishedAt() != null && run.getStatus() != RunStatus.CANCELLED)
                .findFirst().orElse(null);
        List<CustomerOperationsHomeView.SourceHealth> health = lastFinished == null ? List.of()
                : ResponsibilityRunCoordinator.latestPerSource(
                                sourceRows.findByRunIdOrderByAttemptAscCreatedAtAsc(lastFinished.getId()))
                        .values().stream()
                        .map(s -> new CustomerOperationsHomeView.SourceHealth(s.getChannelCode(),
                                Optional.ofNullable(channelByCode.get(s.getChannelCode())).map(Channel::getNameKo)
                                        .orElse(null),
                                s.getDataType(), s.getCompleteness() == null ? null : s.getCompleteness().name(),
                                s.getObservedCount(), s.getNewCount(),
                                s.getFailureReason() == null ? null : s.getFailureReason().name(), s.getObservedAt(),
                                s.getFailureReason() == SourceFailureReason.AUTH_REQUIRED
                                        || s.getFailureReason() == SourceFailureReason.NOT_CONNECTED))
                        .toList();

        return new CustomerOperationsHomeView(true, eligible, r.getStatus().name(), cadence,
                lastFinished == null ? null : lastFinished.getFinishedAt(),
                lastFinished == null ? null : lastFinished.getStatus().name(),
                r.getNextRunAt(), health,
                decisions(orgId, r, channelById), handled(orgId, r, channelById), gaps(orgId, r, channelById));
    }

    /**
     * <b>The whole queue, in one place.</b> The Home shows the first {@link #MAX_ROWS} of exactly this list as a
     * briefing; the queue screen asks for the rest. Both call {@link #waiting} and {@link #rowsOf}, so the two
     * surfaces cannot disagree about which cases are waiting, in what order, or in what words — the brief they open
     * from and the list they are worked through are the same population, not two answers to the same question.
     *
     * <p>Review and inquiry are not two queues here. A case is a case; its {@code subjectKind} is a fact the row
     * carries, not a list it belongs to.
     */
    @Transactional(readOnly = true)
    public CustomerOperationsHomeView.Decisions decisions(UUID orgId, int size) {
        if (!rollout.allows(orgId)) {
            return new CustomerOperationsHomeView.Decisions(0, List.of());
        }
        Optional<Responsibility> found = responsibilities.findByOrgIdAndTemplateCode(
                orgId, ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1);
        if (found.isEmpty()) {
            return new CustomerOperationsHomeView.Decisions(0, List.of());
        }
        Map<UUID, Channel> channelById = channels.findAll().stream()
                .collect(Collectors.toMap(Channel::getId, c -> c, (a, b) -> a));
        List<OperationsCase> waiting = waiting(orgId, found.get());
        return new CustomerOperationsHomeView.Decisions(waiting.size(), rowsOf(waiting, size, channelById));
    }

    private CustomerOperationsHomeView.Decisions decisions(UUID orgId, Responsibility r, Map<UUID, Channel> channelById) {
        List<OperationsCase> waiting = waiting(orgId, r);
        return new CustomerOperationsHomeView.Decisions(waiting.size(), rowsOf(waiting, MAX_ROWS, channelById));
    }

    private List<OperationsCase> waiting(UUID orgId, Responsibility r) {
        return cases.findByOrgIdAndResponsibilityIdAndCaseKindAndStatusOrderByCreatedAtDesc(
                        orgId, r.getId(), OperationsCaseKind.CUSTOMER_WORK, OperationsCaseStatus.PREPARED,
                        PageRequest.of(0, SCAN)).stream()
                .filter(c -> c.getDisposition() == CaseDisposition.NEEDS_DECISION)
                .filter(this::stillWaitingOnCanonicalRecord)
                .sorted(Comparator.comparing((OperationsCase c) -> c.getPriority() == CasePriority.HIGH ? 0 : 1)
                        .thenComparing(OperationsCase::getCreatedAt, Comparator.reverseOrder()))
                .toList();
    }

    private List<CustomerOperationsHomeView.DecisionRow> rowsOf(List<OperationsCase> waiting, int size,
                                                                Map<UUID, Channel> channelById) {
        return waiting.stream().limit(size).map(c -> {
            Subject subject = subject(c);
            return new CustomerOperationsHomeView.DecisionRow(c.getId(), c.getSubjectKind().name(),
                    channelName(channelById, c.getChannelId()), subject.title(), subject.rating(), CaseReason.noteFor(c),
                    c.getSummary(),
                    c.getRecommendedActionType() == null ? null : c.getRecommendedActionType().name(),
                    c.getRecommendedAction(), missing(c.getMissingInformation()),
                    c.getPreparedAction() == CasePreparedAction.DRAFT_PREPARED,
                    c.getDecidedBy() == null ? null : c.getDecidedBy().name(), c.getCreatedAt(), linkOf(c));
        }).toList();
    }

    private CustomerOperationsHomeView.Handled handled(UUID orgId, Responsibility r, Map<UUID, Channel> channelById) {
        Instant since = clock.instant().minus(HANDLED_PERIOD);
        long autoResolved = cases.countByOrgIdAndResponsibilityIdAndDispositionAndCreatedAtGreaterThanEqual(
                orgId, r.getId(), CaseDisposition.AUTO_RESOLVED, since);
        List<OperationsCase> openCases = cases.findByOrgIdAndResponsibilityIdAndCaseKindAndStatusOrderByCreatedAtDesc(
                orgId, r.getId(), OperationsCaseKind.CUSTOMER_WORK, OperationsCaseStatus.PREPARED,
                PageRequest.of(0, 200));
        List<OperationsCase> monitoring = openCases.stream()
                .filter(c -> c.getDisposition() == CaseDisposition.MONITORING)
                .toList();
        // The seller already decided; the record that owns the result has not settled it yet. Without this the
        // case leaves 「직접 판단하실 일」 the moment they act and appears nowhere until verification lands — which
        // reads as «gone». It is not gone, and it is not done either: only the execution record may say that.
        List<OperationsCase> verifying = openCases.stream()
                .filter(c -> c.getDisposition() == CaseDisposition.NEEDS_DECISION)
                .filter(c -> !stillWaitingOnCanonicalRecord(c))
                .toList();
        java.util.Set<UUID> verifyingIds = verifying.stream().map(OperationsCase::getId)
                .collect(java.util.stream.Collectors.toSet());
        long drafts = cases.countByOrgIdAndResponsibilityIdAndPreparedActionAndCreatedAtGreaterThanEqual(
                orgId, r.getId(), CasePreparedAction.DRAFT_PREPARED, since);
        List<OperationsCase> shown = new ArrayList<>(cases
                .findByOrgIdAndResponsibilityIdAndDispositionAndCreatedAtGreaterThanEqualOrderByCreatedAtDesc(
                        orgId, r.getId(), CaseDisposition.AUTO_RESOLVED, since, PageRequest.of(0, MAX_ROWS)));
        monitoring.stream().limit(MAX_ROWS).forEach(shown::add);
        verifying.stream().limit(MAX_ROWS).forEach(shown::add);
        List<CustomerOperationsHomeView.HandledRow> rows = shown.stream()
                .sorted(Comparator.comparing(OperationsCase::getCreatedAt, Comparator.reverseOrder()))
                .limit(MAX_ROWS)
                .map(c -> {
                    Subject subject = subject(c);
                    return new CustomerOperationsHomeView.HandledRow(c.getId(), c.getSubjectKind().name(),
                            channelName(channelById, c.getChannelId()), subject.title(), subject.rating(),
                            c.getDisposition().name(), c.getDecidedBy() == null ? null : c.getDecidedBy().name(),
                            CaseReason.noteFor(c), c.getSummary(), verifyingIds.contains(c.getId()), linkOf(c));
                }).toList();
        long checked = cases.countByOrgIdAndResponsibilityIdAndCaseKindAndCreatedAtGreaterThanEqual(
                orgId, r.getId(), OperationsCaseKind.CUSTOMER_WORK, since);
        return new CustomerOperationsHomeView.Handled(since, autoResolved, monitoring.size(), drafts,
                verifying.size(), rows, checked);
    }

    private CustomerOperationsHomeView.Gaps gaps(UUID orgId, Responsibility r, Map<UUID, Channel> channelById) {
        List<OperationsCase> open = cases.findByOrgIdAndResponsibilityIdAndCaseKindAndStatusOrderByCreatedAtDesc(
                orgId, r.getId(), OperationsCaseKind.OBSERVATION_GAP, OperationsCaseStatus.PREPARED,
                PageRequest.of(0, 50));
        List<CustomerOperationsHomeView.GapRow> rows = open.stream().limit(MAX_ROWS).map(c -> {
            Channel channel = c.getChannelId() == null ? null : channelById.get(c.getChannelId());
            return new CustomerOperationsHomeView.GapRow(c.getId(), channel == null ? null : channel.getCode(),
                    channel == null ? null : channel.getNameKo(), c.getReason().name(),
                    dataTypesOf(c.getSourceState()), c.getCreatedAt(), c.getUpdatedAt(),
                    channel != null && "CAFE24".equals(channel.getCode()) ? "/connect/cafe24" : "/connect");
        }).toList();
        return new CustomerOperationsHomeView.Gaps(open.size(), rows);
    }

    /** The canonical record still says the seller's move is pending. Read-only; the reconciler writes. */
    boolean stillWaitingOnCanonicalRecord(OperationsCase c) {
        if (c.getSubjectKind() == OperationsSubjectKind.INQUIRY) {
            Optional<Inquiry> inquiry = inquiries.findById(c.getSubjectId())
                    .filter(i -> c.getOrgId().equals(i.getOrgId()));
            if (inquiry.isEmpty() || !"UNANSWERED".equals(inquiry.get().getStatus())
                    || (inquiry.get().getOperationalState() != null
                            && inquiry.get().getOperationalState() != InquiryOperationalState.ACTIVE)) {
                return false;
            }
            return (c.getWorkItemId() == null ? workItems.findByInquiryId(c.getSubjectId())
                    : workItems.findById(c.getWorkItemId()))
                    .map(w -> InquiryWorkItemPhase.AWAITING_SELLER.contains(w.getPhase()))
                    .orElse(true);
        }
        if (c.getSubjectKind() == OperationsSubjectKind.REVIEW) {
            Optional<Review> review = reviews.findById(c.getSubjectId()).filter(x -> c.getOrgId().equals(x.getOrgId()));
            return review.isPresent() && review.get().getReplyState() != ReviewReplyState.ANSWERED
                    && !cases.reviewDecidedSince(c.getOrgId(), c.getSubjectId(), c.getCreatedAt());
        }
        return false;
    }

    private record Subject(String title, Integer rating) {
    }

    private Subject subject(OperationsCase c) {
        if (c.getSubjectKind() == OperationsSubjectKind.INQUIRY) {
            return inquiries.findById(c.getSubjectId()).filter(i -> c.getOrgId().equals(i.getOrgId()))
                    .map(i -> {
                        String title = MarkupText.toPlainText(i.getTitle());
                        String shown = preview(title == null || title.isBlank()
                                ? MarkupText.toPlainText(i.getBody()) : title);
                        return new Subject(shown, null);
                    }).orElse(new Subject(null, null));
        }
        if (c.getSubjectKind() == OperationsSubjectKind.REVIEW) {
            return reviews.findById(c.getSubjectId()).filter(x -> c.getOrgId().equals(x.getOrgId()))
                    .map(x -> new Subject(preview(MarkupText.toPlainText(x.getBody())), x.getRating()))
                    .orElse(new Subject(null, null));
        }
        return new Subject(null, null);
    }

    private static String preview(String raw) {
        SafePreviewResult preview = VocPreviewSanitizer.sanitize(raw);
        return preview == null || preview.text() == null || preview.text().isBlank() ? null : preview.text();
    }

    private static String linkOf(OperationsCase c) {
        return switch (c.getSubjectKind()) {
            case INQUIRY -> "/inquiries/" + c.getSubjectId();
            case REVIEW -> "/reviews/reply/" + c.getSubjectId();
            case SOURCE -> "/connect";
        };
    }

    private static String channelName(Map<UUID, Channel> channelById, UUID channelId) {
        Channel channel = channelId == null ? null : channelById.get(channelId);
        return channel == null ? null : channel.getNameKo();
    }

    private static List<String> missing(String json) {
        if (json == null || json.isBlank()) {
            return List.of();
        }
        try {
            return MAPPER.readValue(json, new TypeReference<List<String>>() { });
        } catch (Exception e) {
            return List.of();
        }
    }

    private static List<String> dataTypesOf(String sourceState) {
        int at = sourceState == null ? -1 : sourceState.indexOf("types=");
        if (at < 0) {
            return List.of();
        }
        return Arrays.stream(sourceState.substring(at + "types=".length()).split(","))
                .map(String::trim).filter(s -> !s.isEmpty()).toList();
    }
}
