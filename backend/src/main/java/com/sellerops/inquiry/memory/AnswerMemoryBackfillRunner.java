package com.sellerops.inquiry.memory;

import com.sellerops.organization.Organization;
import com.sellerops.organization.OrganizationRepository;
import java.util.UUID;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * On startup, bring every already-collected seller answer into Answer Memory.
 *
 * <p><b>Why a boot pass and not only the ingest hook.</b> The answers that exist today were collected
 * before this memory existed. The ingest hook will catch every future one, but it only runs when an
 * ingest runs — and an ingest is a live marketplace read, which needs a fresh approval and must never
 * be the price of turning a local feature on. This pass reads the database and nothing else.
 *
 * <p>Idempotent and cheap: bounded by the rows that carry an answer body, and a row whose text and
 * strength are unchanged is not written. Safe to run every boot, like the dispatch recovery runner
 * beside it. Failure is logged and never blocks startup — a service that will not start because a
 * convenience index could not be rebuilt is worse than a stale index.
 */
@Component
@ConditionalOnProperty(name = "sellerops.answer-memory.import-on-startup", havingValue = "true",
        matchIfMissing = true)
public class AnswerMemoryBackfillRunner implements ApplicationRunner {

    private static final Logger log = LoggerFactory.getLogger(AnswerMemoryBackfillRunner.class);

    private final OrganizationRepository organizations;
    private final InquiryAnswerMemoryImporter importer;

    public AnswerMemoryBackfillRunner(OrganizationRepository organizations,
                                      InquiryAnswerMemoryImporter importer) {
        this.organizations = organizations;
        this.importer = importer;
    }

    @Override
    public void run(ApplicationArguments args) {
        for (Organization org : organizations.findAll()) {
            UUID orgId = org.getId();
            try {
                int written = importer.importCollectedAnswers(orgId);
                if (written > 0) {
                    log.info("answer-memory backfill org={} 건수={}", orgId, written);
                }
            } catch (Exception e) {
                log.warn("answer-memory backfill failed org={}: {}", orgId, e.toString());
            }
        }
    }
}
