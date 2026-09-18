package com.sellerops.review.media;

import java.net.URI;
import java.time.Instant;
import java.util.List;
import java.util.Locale;
import java.util.Optional;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * The one writer of {@link ReviewMedia} references — what an observation read off the channel for one review.
 *
 * <p><b>Only the channel's own image CDN is accepted.</b> The address is later fetched without a credential
 * ({@code ReviewMediaInspector}), so an address from anywhere else is refused here rather than stored and refused
 * later: a reference that can never be inspected is not worth keeping as if it could.
 *
 * <p>Re-reading the same review is idempotent by ordinal. When the address at an ordinal changes, what was seen in
 * the old picture no longer describes the new one, so the inspection is reset to {@link
 * ReviewMedia.InspectionStatus#NOT_INSPECTED}.
 */
@Component
public class ReviewMediaWriter {

    /** NAVER's image CDN (host suffix). The READ-only census of the review row model confirms the host per run. */
    public static final List<String> ALLOWED_HOST_SUFFIXES = List.of(".pstatic.net");

    public record Attachment(String url, ReviewMedia.Kind kind) {
    }

    private final ReviewMediaRepository media;

    public ReviewMediaWriter(ReviewMediaRepository media) {
        this.media = media;
    }

    /** The host of an acceptable attachment address, or empty when it is not one. */
    public static Optional<String> acceptableHost(String url) {
        if (url == null || url.isBlank() || url.length() > 2048) {
            return Optional.empty();
        }
        try {
            URI uri = URI.create(url.strip());
            String host = uri.getHost() == null ? null : uri.getHost().toLowerCase(Locale.ROOT);
            if (!"https".equalsIgnoreCase(uri.getScheme()) || host == null || uri.getUserInfo() != null) {
                return Optional.empty();
            }
            return ALLOWED_HOST_SUFFIXES.stream().anyMatch(host::endsWith) ? Optional.of(host) : Optional.empty();
        } catch (IllegalArgumentException malformed) {
            return Optional.empty();
        }
    }

    /** @return how many references are now stored for the review */
    @Transactional
    public int record(UUID orgId, UUID reviewId, List<Attachment> attachments, String observedBy, Instant at) {
        if (attachments == null || attachments.isEmpty()) {
            return 0;
        }
        List<ReviewMedia> existing = media.findByOrgIdAndReviewIdOrderByOrdinalAsc(orgId, reviewId);
        int stored = 0;
        for (int i = 0; i < attachments.size(); i++) {
            Attachment a = attachments.get(i);
            Optional<String> host = acceptableHost(a.url());
            if (host.isEmpty()) {
                continue;
            }
            int ordinal = i + 1;
            ReviewMedia row = existing.stream().filter(m -> m.getOrdinal() == ordinal).findFirst()
                    .orElseGet(ReviewMedia::new);
            if (row.getId() != null && !a.url().strip().equals(row.getSourceUrl())) {
                resetInspection(row);
            }
            row.setOrgId(orgId);
            row.setReviewId(reviewId);
            row.setOrdinal(ordinal);
            row.setMediaKind(a.kind() == null ? ReviewMedia.Kind.UNKNOWN : a.kind());
            row.setSourceUrl(a.url().strip());
            row.setSourceHost(host.get());
            row.setObservedBy(observedBy);
            row.setObservedAt(at);
            media.save(row);
            stored++;
        }
        return stored;
    }

    static void resetInspection(ReviewMedia row) {
        row.setInspectionStatus(ReviewMedia.InspectionStatus.NOT_INSPECTED);
        row.setInspectedAt(null);
        row.setInspectionModel(null);
        row.setDepicts(null);
        row.setProblemVisible(null);
        row.setProblemDescription(null);
        row.setInspectionFailure(null);
    }
}
