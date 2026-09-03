package com.sellerops.knowledge;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.ArrayList;
import java.util.List;
import java.util.stream.Stream;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>Evidence is fixed when the draft version is written, and a reopen re-reads it rather than
 * re-deciding it.</b> Retrieval Runtime Closure v1 §1–§2.
 *
 * <p>The property was already true when this was written, and that is exactly why it is written
 * down. Two of the three retrieval stages are now model calls made afresh on every search
 * ({@code KnowledgeQuestionIntent}, {@code KnowledgeEvidenceEligibility}), and the holdout
 * measurement observed what that means at the borderline: the same question, over an unchanged
 * library, can settle differently on two consecutive searches. A read path that re-ran the retrieval
 * would therefore be able to tell a seller a different story about a saved draft than the one they
 * were shown when it was written — and the sentence 「왜 이렇게 썼어요?」 would stop being true.
 *
 * <p>So the boundary is structural: <b>retrieval belongs to generation.</b> A seller-facing read
 * assembles a draft from the version's own row and the citation rows recorded beside it, and cannot
 * reach the retriever at all.
 */
class RetrievalRuntimeClosureTest {

    private static final Path MAIN = Path.of("src", "main", "java", "com", "sellerops");

    private static String stripComments(String source) {
        return source.replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    private static List<String> filesWhere(java.util.function.Predicate<String> code)
            throws IOException {
        List<String> names = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                if (code.test(stripComments(Files.readString(source)))) {
                    names.add(source.getFileName().toString());
                }
            }
        }
        return names;
    }

    /**
     * The three callers, and why each is allowed to spend a retrieval.
     *
     * <p>Two of them WRITE a draft version, which is the unit of work retrieval belongs to. The
     * third is the coverage diagnostic, which measures and never drafts — and pays for that
     * privilege by asking with a query that is not customer-written and an order lookup that is
     * stored-only, so a report over a backlog can neither reach a channel nor charge a per-question
     * model call per row ({@code InquiryKnowledgeCoverageService#measured}).
     */
    private static final List<String> MAY_RETRIEVE = List.of(
            "InquiryDraftComposer.java", "ReviewDraftComposer.java",
            "InquiryKnowledgeCoverageService.java");

    @Test
    @DisplayName("only a draft generation — and one diagnostic that spends nothing — runs a retrieval")
    void retrievalBelongsToGeneration() throws IOException {
        List<String> callers = filesWhere(code ->
                code.contains("InquiryEvidenceRetriever")
                        && (code.contains(".retrieve(") || code.contains(".retrieveFor(")));
        assertThat(callers)
                .as("a read path that re-ran the retrieval could contradict the saved version")
                .containsExactlyInAnyOrderElementsOf(MAY_RETRIEVE);
    }

    /**
     * The seller-facing reads, named — and what they are asserted NOT to hold.
     *
     * <p>{@code ReviewReplyService} assembles the review reply-work panel and
     * {@code InquiryProposalService} the inquiry detail. Both hand back the head version's body, its
     * author, its basis and its citations; neither may name the retriever, because the whole point of
     * writing the citations down was that the read does not have to ask again.
     */
    @Test
    @DisplayName("the two seller-facing reads cannot reach the retriever at all")
    void theReadPathsCannotRetrieve() throws IOException {
        List<String> readPaths = List.of("ReviewReplyService.java", "InquiryProposalService.java");
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                if (!readPaths.contains(name)) {
                    continue;
                }
                String code = stripComments(Files.readString(source));
                if (code.contains("InquiryEvidenceRetriever")) {
                    offenders.add(name + " (names the retriever)");
                }
                // The positive half: it reads what the version recorded.
                if (!code.contains("evidenceFor(") && !code.contains("DraftEvidenceRepository")
                        && !code.contains("draftEvidence")) {
                    offenders.add(name + " (does not read the stored citations)");
                }
            }
        }
        assertThat(offenders).isEmpty();
    }

    /**
     * Only a question a CUSTOMER wrote pays for the two v2 model lanes.
     *
     * <p>Retrieval Runtime Closure v1 §4. The intent capability was gated on this from the start; the
     * eligibility judge was not, so a seller typing 「반품 조건」 into their own knowledge library — and
     * the Agent reading this company's own policy on their behalf — had a refusal-only model deciding
     * which of the seller's own documents they were allowed to see. That is a different failure from
     * the wrong-source citation this capability was measured against, and one it cannot help with.
     */
    @Test
    @DisplayName("every judge call site asks whether a customer wrote the question")
    void onlyCustomerQuestionsAreJudged() throws IOException {
        List<String> callSites = filesWhere(code -> code.contains("eligibility.filter("));
        assertThat(callSites).containsExactlyInAnyOrder(
                "ProductKnowledgeLibraryService.java", "SellerOperationsKnowledgeService.java",
                "AnswerMemoryService.java");
        List<String> offenders = new ArrayList<>();
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                if (!callSites.contains(name)) {
                    continue;
                }
                String code = stripComments(Files.readString(source)).replaceAll("\\s+", " ");
                if (!code.contains("eligibility.filter(orgId, question.full(), question.customerWritten(),")) {
                    offenders.add(name);
                }
            }
        }
        assertThat(offenders)
                .as("a lane that judged a seller's own search would hide their own documents")
                .isEmpty();
    }

    /**
     * Nothing derived by a model is written down, and nothing derived by a model can be quoted.
     *
     * <p>The v2 package established this and Retrieval Runtime Closure v1 keeps it while ADDING
     * reuse: the restatement, the question vector and the judge's verdict are now remembered, and
     * the only place they are remembered is a bounded in-memory {@code SearchMemo}. So the guard is
     * the same one v2 wrote — the three files that know these things exist hold no repository, no
     * entity and no save — and it now also fixes that the memo itself is not a table.
     */
    @Test
    @DisplayName("the reused answers live in memory and nowhere else")
    void nothingGeneratedIsPersisted() throws IOException {
        List<String> offenders = new ArrayList<>();
        List<String> generated = List.of("KnowledgeQuestionIntent.java",
                "KnowledgeEvidenceEligibility.java", "SearchMemo.java");
        try (Stream<Path> walk = Files.walk(MAIN)) {
            for (Path source : walk.filter(p -> p.toString().endsWith(".java")).toList()) {
                String name = source.getFileName().toString();
                if (!generated.contains(name)) {
                    continue;
                }
                String code = stripComments(Files.readString(source));
                for (String forbidden : List.of("Repository", "@Entity", "@Table", "save(",
                        "JdbcTemplate", "EntityManager")) {
                    if (code.contains(forbidden)) {
                        offenders.add(name + " (" + forbidden + ")");
                    }
                }
            }
        }
        assertThat(offenders)
                .as("a restatement of a customer's sentence is a second copy of their wording")
                .isEmpty();
    }
}
