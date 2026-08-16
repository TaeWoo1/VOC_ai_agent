package com.sellerops.review.triage;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * The fourth RUBRIC §5 gate, made structural.
 *
 * <p>{@code contracts/review-eval/naver/v1/RUBRIC.md} §5's regression bar is
 * "{@code LOW_RATING_REVIEW} counts unchanged — a detector may only ADD". Review Triage v1 satisfies
 * it today by construction: it is a read-side suggestion on the channel review record and touches
 * neither the attention surface nor anything the attention surface reads. But "today, by
 * construction" is a property of the code as written, not a rule, and the whole point of a
 * pre-committed gate is that it survives the next edit.
 *
 * <p>So it is asserted the way {@code ReviewIssueQueueIsolationTest} asserts the same boundary for
 * the issue-memory package: structurally, over the package's own sources, rather than by checking a
 * count in one scenario and hoping.
 *
 * <p><b>Comments are stripped before scanning.</b> This package's javadoc legitimately names the
 * attention surface when explaining what it is NOT — the naming section in {@code ReviewTriageTier}
 * exists precisely to distinguish the two — and a guard that failed on its own explanation would be
 * deleted rather than fixed.
 */
class ReviewTriageQueueIsolationTest {

    private static final Path PACKAGE_DIR =
            Path.of("src", "main", "java", "com", "sellerops", "review", "triage");

    /**
     * Subpackages that were added AFTER this guard, and are allowed to persist.
     *
     * <p><b>Amended 2026-08-17, and the amendment is narrow on purpose.</b> {@code llm} and
     * {@code feedback} implement the classifier of
     * {@code docs/slices/llm-triage-classifier-v1.md}, which stores a prediction — so
     * {@link #nothingInTheTierRulePersistsAnything} could no longer be true of the whole tree.
     *
     * <p>What the amendment does NOT do is relax the gate it was written for. RUBRIC §5's bar is
     * "{@code LOW_RATING_REVIEW} counts unchanged — a detector may only ADD", and that is about the
     * attention queue, not about persistence in general. So
     * {@link #nothingInThePackageReachesTheQueuesMechanisms} still scans <b>every</b> source in the
     * tree including these, {@link #theClassifierWritesOnlyItsOwnTables} replaces the persistence
     * check for them with the property that actually matters, and the tier rule itself stays
     * store-nothing.
     */
    private static final List<String> PERSISTING_SUBPACKAGES = List.of("llm", "feedback");

    /**
     * Mechanisms that decide the needs-a-look queue, or that record a human's decision about a review.
     *
     * <p>{@code ReviewTriage} / {@code TriageDisposition} are on the list for a second reason beyond
     * the gate: they are the OTHER thing called triage in this codebase. A tier that started reading a
     * recorded disposition would make a computed suggestion depend on a durable human decision reached
     * on a different screen, and the two would drift into one confused concept.
     */
    private static final List<String> FORBIDDEN_REFERENCES = List.of(
            "com.sellerops.attention",
            "AttentionSignal",
            "OperatorAttention",
            "VocItemSource",
            "ReviewTriageRepository",
            "TriageDisposition");

    private static final Pattern TABLE = Pattern.compile("@Table\\(name = \"([a-z_]+)\"\\)");

    @Test
    void thePackageIsNotEmptySoThisTestCannotPassVacuously() throws IOException {
        assertThat(sources()).isNotEmpty();
        assertThat(sources()).hasSizeGreaterThanOrEqualTo(3);
        assertThat(tierRuleSources()).as("the tier rule's own files").hasSizeGreaterThanOrEqualTo(3);
        assertThat(PERSISTING_SUBPACKAGES).isNotEmpty();
    }

    @Test
    void nothingInThePackageReachesTheQueuesMechanisms() throws IOException {
        List<String> offences = new ArrayList<>();
        for (Path source : sources()) {
            String code = stripComments(Files.readString(source));
            for (String forbidden : FORBIDDEN_REFERENCES) {
                if (code.contains(forbidden)) {
                    offences.add(source.getFileName() + " → " + forbidden);
                }
            }
        }
        assertThat(offences)
                .as("triage는 확인 필요 큐의 판정 경로에 닿을 수 없습니다 (RUBRIC.md §5 회귀 게이트)")
                .isEmpty();
    }

    /**
     * The tier rule is computed, never stored — so it cannot become a state that drifts from the
     * review it describes, and it cannot write anything the attention queue reads.
     *
     * <p>Scoped to the tier rule's own sources since the classifier arrived. That is the object the
     * property was ever about: {@code ReviewTriageRules} is what the list sorts by and the counts
     * count, and a stored tier there is what would drift.
     */
    @Test
    void nothingInTheTierRulePersistsAnything() throws IOException {
        List<String> offences = new ArrayList<>();
        for (Path source : tierRuleSources()) {
            String code = stripComments(Files.readString(source));
            for (String forbidden : List.of(".save(", ".saveAll(", ".delete(", "Repository",
                    "@Entity", "@Transactional")) {
                if (code.contains(forbidden)) {
                    offences.add(source.getFileName() + " → " + forbidden);
                }
            }
        }
        assertThat(offences)
                .as("triage 등급 규칙은 읽기 시점 계산이며 어떤 것도 저장하지 않습니다")
                .isEmpty();
    }

    /**
     * The classifier may persist, and only into its own three tables.
     *
     * <p>This is the property that replaces "stores nothing" for the subpackages, and it is the one
     * RUBRIC §5's regression bar actually needs: a prediction store cannot change a
     * {@code LOW_RATING_REVIEW} count if it never writes anything the attention queue reads. The
     * check is on the entity mappings rather than on intent, so a future entity pointed at
     * {@code reviews} or {@code review_triages} fails here rather than in production.
     */
    @Test
    void theClassifierWritesOnlyItsOwnTables() throws IOException {
        List<String> tables = new ArrayList<>();
        for (Path source : sources()) {
            String code = stripComments(Files.readString(source));
            Matcher matcher = TABLE.matcher(code);
            while (matcher.find()) {
                tables.add(matcher.group(1));
            }
        }
        assertThat(tables).as("the classifier's entities must be found, or this passes vacuously")
                .isNotEmpty();
        assertThat(tables)
                .as("triage는 자기 테이블 밖에는 아무것도 쓰지 않습니다 (RUBRIC.md §5 회귀 게이트)")
                .containsOnly("review_triage_predictions", "review_triage_corrections",
                        "review_correction_dispositions");
    }

    /** Only the tier rule's own files — the subpackages are covered by the two tests above. */
    private static List<Path> tierRuleSources() throws IOException {
        List<Path> all = new ArrayList<>();
        for (Path source : sources()) {
            Path relative = PACKAGE_DIR.relativize(source);
            if (relative.getNameCount() == 1) {
                all.add(source);
            }
        }
        return all;
    }

    private static List<Path> sources() throws IOException {
        try (Stream<Path> walk = Files.walk(PACKAGE_DIR)) {
            return walk.filter(p -> p.toString().endsWith(".java")).sorted().toList();
        }
    }

    /**
     * Remove block and line comments. Deliberately naive, and copied in spirit from
     * {@code ReviewIssueQueueIsolationTest}: a {@code //} inside a string literal would truncate that
     * line. No source in this package contains one, and a real Java lexer in a guard test would be
     * more code than the thing it guards.
     */
    private static String stripComments(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }
}
