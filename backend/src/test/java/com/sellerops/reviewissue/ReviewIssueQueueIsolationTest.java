package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.Test;

/**
 * The fence that keeps this package additive.
 *
 * <p>{@code contracts/review-eval/naver/v1/RUBRIC.md} §5 sets a regression gate: a detector may only
 * ADD, and {@code LOW_RATING_REVIEW} counts must be unchanged. It also sets bars this extractor has
 * not been measured against — the label seed is empty — so the extractor must not be able to affect
 * who is in the needs-a-look queue even by accident. That is a structural property, so it is checked
 * structurally rather than by asserting a count in one scenario and hoping.
 *
 * <p>Two independent checks, because either alone is weak: a source scan can be defeated by
 * indirection, and a reflection check only covers the classes it names.
 *
 * <p><b>Comments are stripped before scanning.</b> This package's javadoc legitimately mentions
 * {@code item-analysis} and the attention surface when explaining precedent, and the collector's
 * conventions record that prose in comments has produced false failures in exactly this kind of test.
 */
class ReviewIssueQueueIsolationTest {

    private static final Path PACKAGE_DIR =
            Path.of("src", "main", "java", "com", "sellerops", "reviewissue");

    /** Mechanisms that decide the needs-a-look queue. This package may not reach any of them. */
    private static final List<String> FORBIDDEN_REFERENCES = List.of(
            "com.sellerops.itemanalysis",
            "com.sellerops.attention",
            "ItemAnalysis",
            "AttentionSignal",
            "OperatorAttention",
            "VocItemSource");

    /**
     * The two — and only two — {@code com.sellerops.attention} symbols this package may reference,
     * added for the Review Issue → Guided Reply action loop (v1):
     *
     * <ul>
     *   <li>{@code VocItemRef} — the attention surface's ADDRESSING helper. The issue → reply bridge
     *       ({@code ReviewIssueReplyCandidatesService}) mints {@code review:<uuid>} through it rather
     *       than duplicating the format. It is a pure string helper; it decides no queue membership.
     *   <li>{@code IssueMemoryRefreshPort} — the seam the reply loop calls (implemented here by
     *       {@code ReviewReplyIssueMemoryRefreshAdapter}) to refresh issue AGGREGATION after a
     *       reported reply. It touches issue memory, never the queue.
     * </ul>
     *
     * <p>Neither reaches a queue-decision mechanism ({@code ItemAnalysis}, {@code AttentionSignal},
     * {@code OperatorAttention}, {@code VocItemSource}) — those bans stay, and the no-writes and
     * reflection checks below still hold — so the RUBRIC.md §5 gate's real intent is intact: an
     * UNMEASURED extractor still cannot move who is in the needs-a-look queue. Any OTHER
     * {@code com.sellerops.attention} reference (e.g. a reply/queue service or writer) is still an
     * offence.
     */
    private static final List<String> ALLOWED_ATTENTION_REFERENCES = List.of(
            "com.sellerops.attention.VocItemRef",
            "com.sellerops.attention.reply.IssueMemoryRefreshPort");

    @Test
    void thePackageIsNotEmptySoThisTestCannotPassVacuously() throws IOException {
        assertThat(sources()).isNotEmpty();
        assertThat(sources()).hasSizeGreaterThan(10);
    }

    @Test
    void nothingInThePackageReachesTheQueuesMechanisms() throws IOException {
        List<String> offences = new ArrayList<>();
        for (Path source : sources()) {
            String code = stripComments(Files.readString(source));
            // Blank out the sanctioned bridge symbols before the package-prefix scan, so an allowed
            // reference does not read as an offence — while any OTHER com.sellerops.attention reference
            // (a reply/queue service, a writer) still does. The specific queue-mechanism names below
            // are checked against the ORIGINAL code, so the allow-list can never smuggle one in.
            String withoutAllowed = code;
            for (String allowed : ALLOWED_ATTENTION_REFERENCES) {
                withoutAllowed = withoutAllowed.replace(allowed, "");
            }
            for (String forbidden : FORBIDDEN_REFERENCES) {
                String scanned = "com.sellerops.attention".equals(forbidden) ? withoutAllowed : code;
                if (scanned.contains(forbidden)) {
                    offences.add(source.getFileName() + " → " + forbidden);
                }
            }
        }
        assertThat(offences)
                .as("이슈 패키지는 확인 필요 큐의 판정 경로에 닿을 수 없습니다 (RUBRIC.md §5 회귀 게이트)")
                .isEmpty();
    }

    /** The allow-list must be exact FQNs, or it could blanket-permit the whole attention package. */
    @Test
    void theAttentionAllowListIsSpecificSymbolsNotThePackage() {
        assertThat(ALLOWED_ATTENTION_REFERENCES)
                .allSatisfy(ref -> assertThat(ref).startsWith("com.sellerops.attention.")
                        .isNotEqualTo("com.sellerops.attention"));
    }

    /**
     * Writes are confined to the issue tables. Scanning for {@code save} on a review or product
     * catches the case a future edit adds a repository and starts mutating rows the queue reads.
     */
    @Test
    void nothingInThePackageWritesToReviewsOrProducts() throws IOException {
        List<String> offences = new ArrayList<>();
        for (Path source : sources()) {
            String code = stripComments(Files.readString(source));
            for (String forbidden : List.of("reviews.save", "reviews.delete", "products.save",
                    "products.delete", "reviews.saveAll", "products.saveAll")) {
                if (code.contains(forbidden)) {
                    offences.add(source.getFileName() + " → " + forbidden);
                }
            }
        }
        assertThat(offences).isEmpty();
    }

    /**
     * The strongest single fact: the extraction service holds no {@code ReviewRepository} at all, so
     * it cannot load or persist a review even if someone wanted it to. It receives one {@code Review}
     * as a parameter and treats it as read-only input.
     */
    @Test
    void extractionCannotReachAReviewRepositoryAtAll() {
        List<Class<?>> dependencies =
                List.of(ReviewIssueExtractionService.class.getDeclaredConstructors()[0]
                        .getParameterTypes());

        assertThat(dependencies).containsExactly(
                IssueSignatureExtractor.class,
                ReviewIssueRepository.class,
                ReviewIssueEvidenceRepository.class,
                ReviewIssueUnknownUnitRepository.class,
                ReviewIssueStateEventRepository.class);
    }

    /**
     * The lifecycle pass cannot reach reviews either. It moves issue states from aggregate counts, so
     * a dependency on the review store would be the first step toward it "fixing" a row the queue
     * reads.
     */
    @Test
    void theLifecyclePassCannotReachAReviewRepositoryEither() {
        List<Class<?>> dependencies =
                List.of(ReviewIssueLifecycleService.class.getDeclaredConstructors()[0]
                        .getParameterTypes());

        assertThat(dependencies).containsExactly(
                ReviewIssueRepository.class,
                ReviewIssueStateEventRepository.class,
                ReviewIssueSnapshotService.class);
    }

    private static List<Path> sources() throws IOException {
        try (Stream<Path> walk = Files.walk(PACKAGE_DIR)) {
            return walk.filter(p -> p.toString().endsWith(".java")).sorted().toList();
        }
    }

    /**
     * Remove block and line comments. Deliberately naive: a {@code //} inside a string literal would
     * truncate that line. No source in this package contains one, and the alternative — a real Java
     * lexer in a guard test — would be more code than the thing it guards.
     */
    private static String stripComments(String source) {
        String withoutBlocks = source.replaceAll("(?s)/\\*.*?\\*/", "");
        StringBuilder out = new StringBuilder();
        for (String line : withoutBlocks.split("\n", -1)) {
            int marker = line.indexOf("//");
            out.append(marker >= 0 ? line.substring(0, marker) : line).append('\n');
        }
        return out.toString();
    }

    /** The stripper has to actually strip, or every scan above passes for the wrong reason. */
    @Test
    void theCommentStripperRemovesBothCommentForms() {
        assertThat(stripComments("a /* ItemAnalysis */ b")).doesNotContain("ItemAnalysis");
        assertThat(stripComments("a // ItemAnalysis\nb")).doesNotContain("ItemAnalysis");
        assertThat(stripComments("""
                /**
                 * ItemAnalysis in javadoc
                 */
                int keep = 1;""")).contains("keep").doesNotContain("ItemAnalysis");
    }

    /** And it must not strip real code, or the scans would pass by deleting everything. */
    @Test
    void theCommentStripperKeepsCode() {
        assertThat(stripComments("int keep = 1; // note")).contains("int keep = 1;");
    }
}
