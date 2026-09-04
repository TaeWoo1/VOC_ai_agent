package com.sellerops.reviewissue;

import java.time.LocalDate;
import java.time.ZoneOffset;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * On startup, re-derive the issue memory of every org whose issues were last derived by another
 * extractor version (Issue Evidence Trust Closure v1, 2026-09-04).
 *
 * <p>The after-ingest refresh only revisits the newest reviews, and evidence a worse extractor wrote
 * sits on reviews of every age — so without this pass the 「파손없이 잘 도착했네요」 rows would stay
 * evidence on every deployment that never runs a manual full extraction. Same posture as
 * {@code AnswerMemoryBackfillRunner}: database only, idempotent, once per extractor version (the
 * stamp {@link ReviewIssueRefreshService#reextractAll} writes is what makes the next boot skip the
 * org), and a failure is logged rather than allowed to stop the service.
 */
@Component
@ConditionalOnProperty(name = "sellerops.reviewissue.reextract-on-startup", havingValue = "true",
        matchIfMissing = true)
public class ReviewIssueReextractionRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(ReviewIssueReextractionRunner.class);

    private final ReviewIssueRepository issues;
    private final ReviewIssueRefreshService refresh;
    private final IssueSignatureExtractor extractor;

    public ReviewIssueReextractionRunner(ReviewIssueRepository issues, ReviewIssueRefreshService refresh,
                                         IssueSignatureExtractor extractor) {
        this.issues = issues;
        this.refresh = refresh;
        this.extractor = extractor;
    }

    @Override
    public void run(ApplicationArguments args) {
        for (UUID orgId : issues.orgIdsWithExtractorVersionNot(extractor.version())) {
            try {
                var result = refresh.reextractAll(orgId, LocalDate.now(ZoneOffset.UTC));
                log.info("review-issue reextract org={} version={} scanned={} evidenceAdded={} evidenceRemoved={}",
                        orgId, extractor.version(), result.reviewsScanned(), result.evidenceAdded(),
                        result.evidenceRemoved());
            } catch (Exception e) {
                log.warn("review-issue reextract failed org={}: {}", orgId, e.toString());
            }
        }
    }
}
