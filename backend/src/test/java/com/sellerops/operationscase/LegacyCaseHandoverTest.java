package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>The handover, in the parts behaviour cannot show.</b>
 *
 * <p>{@code OperationsCaseProcessorTest} proves what happens: a legacy card on a subject this responsibility is
 * deciding stands down, the operations case gets written, and a card on any other subject is left alone. What it
 * cannot prove is the <em>reason the collision stopped happening</em>, because the constraint at the centre of this
 * defect — {@code uq_proactive_case_open_subject}, a PARTIAL unique index — is a Postgres object and the offline
 * suite runs on H2, which has no partial indexes. There the insert would have succeeded either way.
 *
 * <p>So the ordering is pinned here instead. Three things have to be true of the production shape, and none of them
 * is visible in a database that does not enforce the index:
 *
 * <ol>
 *   <li>the legacy row is <b>flushed</b> before the insert, so the slot is free in the database and not merely in
 *       the persistence context;</li>
 *   <li>the deferred path is <b>not</b> a handover point — a subject that is coming back next run must keep the
 *       card it has;</li>
 *   <li>the takeover can only ever close, and only ever a legacy row.</li>
 * </ol>
 *
 * <p>That the index exists at all is {@code ProactiveSafetyFenceTest}'s assertion, against the migration.
 */
class LegacyCaseHandoverTest {

    private static final Path PROCESSOR =
            Paths.get("src/main/java/com/sellerops/operationscase/OperationsCaseProcessor.java");
    private static final Path REASON =
            Paths.get("src/main/java/com/sellerops/proactive/ProactiveCloseReason.java");
    private static final Path LEGACY_ENTITY = Paths.get("src/main/java/com/sellerops/proactive/ProactiveCase.java");

    private static String code(Path path) throws IOException {
        return Files.readString(path).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    /**
     * The body of the takeover, ending where the next method starts rather than at a named neighbour. A slice that
     * names its neighbour is a slice that breaks when someone inserts a method between them, and it breaks by
     * asserting something about code it was never about.
     */
    private static String takeover(String processor) {
        String signature = "private void takeOverLegacyCase(";
        String from = processor.substring(processor.indexOf(signature));
        int next = from.indexOf("\n    private ", signature.length());
        return next < 0 ? from : from.substring(0, next);
    }

    private static int count(String haystack, String needle) {
        int n = 0;
        for (int i = haystack.indexOf(needle); i >= 0; i = haystack.indexOf(needle, i + needle.length())) {
            n++;
        }
        return n;
    }

    @Test
    @DisplayName("the slot is freed in the database before the insert that needs it")
    void flushedNotMerelyDirtied() throws IOException {
        String body = takeover(code(PROCESSOR));

        assertThat(body)
                .as("a pending UPDATE does not free a unique index; the insert below would still collide")
                .contains("legacyCases.saveAndFlush(stale)")
                .doesNotContain("legacyCases.save(stale)");
    }

    @Test
    @DisplayName("it closes; it never deletes, and it never writes an operations case")
    void closesAndNothingElse() throws IOException {
        String body = takeover(code(PROCESSOR));

        assertThat(body)
                .as("history is the point: the seller has to be able to ask where a card went")
                .doesNotContain("delete").doesNotContain("Delete");
        assertThat(count(body, "legacyCases."))
                .as("one lookup and one save, and no other reach into the other lane")
                .isEqualTo(2);
        assertThat(body)
                .as("the operations repository is not touched here — this method's whole job is the other lane")
                .doesNotContain("cases.");
    }

    @Test
    @DisplayName("only a subject this responsibility decides changes hands")
    void scopedToTheSubjectAndTheTemplate() throws IOException {
        String processor = code(PROCESSOR);
        String body = takeover(processor);

        assertThat(body)
                .as("delegation is what makes the operations case canonical; another template is not this deal")
                .contains("ResponsibilityTemplate.CUSTOMER_OPERATIONS_V1");
        assertThat(body)
                .as("keyed by the one subject, never by the organisation — a sweep would close cards for subjects "
                        + "this responsibility will never reach and put nothing in their place")
                .contains("findByOrgIdAndSubjectKindAndSubjectIdAndStatus(orgId, legacyKind, subjectId")
                .contains("ProactiveCaseStatus.PREPARED");
        assertThat(body)
                .as("SOURCE has no legacy counterpart, so an observation gap can collide with nothing")
                .contains("case SOURCE -> null");
        assertThat(count(processor, "takeOverLegacyCase(orgId, responsibility, kind, subjectId, k)"))
                .as("the decided path and the already-decided path, and NOT the deferred one")
                .isEqualTo(2);
    }

    @Test
    @DisplayName("the deferred path writes nothing and takes nothing away")
    void deferredIsNotAHandover() throws IOException {
        String processor = code(PROCESSOR);
        int deferred = processor.indexOf("k.deferred++");
        int handover = processor.indexOf("takeOverLegacyCase(orgId, responsibility, kind, subjectId, k);\n"
                + "        Optional<OperationsCase> open");

        assertThat(deferred).isPositive();
        assertThat(handover)
                .as("the takeover sits after the cap check: a subject coming back next run keeps its card")
                .isGreaterThan(deferred);
    }

    @Test
    @DisplayName("the race fence survives, because the constraint and the concurrency both do")
    void theRaceCatchStays() throws IOException {
        String processor = code(PROCESSOR);

        assertThat(processor)
                .as("the insert is still guarded")
                .contains("catch (DataIntegrityViolationException race)")
                .contains("k.blocked++");
    }

    @Test
    @DisplayName("the handover has its own word, and the lane it reaches into can only be the legacy one")
    void namedAndFenced() throws IOException {
        String reason = code(REASON);
        String entity = Files.readString(LEGACY_ENTITY);

        assertThat(reason)
                .as("a card closed while its work was still open has to be able to say why, and 「source state "
                        + "changed」 is not what happened")
                .contains("DELEGATED_TO_RESPONSIBILITY")
                .contains("SUPERSEDED");
        assertThat(entity)
                .as("the repository the takeover holds is structurally unable to see an operations case")
                .contains("@SQLRestriction(\"responsibility_id is null\")");
    }
}
