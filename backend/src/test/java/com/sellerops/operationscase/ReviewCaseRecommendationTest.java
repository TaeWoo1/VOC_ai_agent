package com.sellerops.operationscase;

import static org.assertj.core.api.Assertions.assertThat;

import java.io.IOException;
import java.nio.file.Files;
import java.nio.file.Path;
import java.nio.file.Paths;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * <b>A review reaches 「내 결정 필요」 carrying what is already known about it.</b>
 *
 * <p>Before this, every review case was written with {@code recommendedAction} null and stood in the queue beside an
 * inquiry that said 「제안: 답변 확인 후 발송 · 초안 있음」. That was read as a missing capability and it was not one:
 * the deterministic review preparation had shipped in the proactive lane long before, and this lane simply threw its
 * answer away every tick.
 *
 * <p>What these assertions hold is <b>whose judgement it is</b>. The review lane must not reach its own conclusion
 * about repetition — two producers counting 「같은 문제가 몇 번 있었나」 would drift, and the seller would have two
 * answers to one question. So the preparation is a call into the existing investigator and nothing else: no rule
 * about ratings, no sentence composed here, no vocabulary invented for it.
 */
class ReviewCaseRecommendationTest {

    private static final Path PROCESSOR =
            Paths.get("src/main/java/com/sellerops/operationscase/OperationsCaseProcessor.java");
    private static final Path INVESTIGATOR =
            Paths.get("src/main/java/com/sellerops/proactive/ProactiveReviewInvestigator.java");
    private static final Path HOME_WORK = Paths.get("../frontend/src/lib/homeWork.ts");
    private static final Path COPY = Paths.get("../frontend/src/lib/copy/customerOps.ts");
    private static final Path NAV = Paths.get("../frontend/src/lib/nav.v2.ts");

    private static String code(Path path) throws IOException {
        return Files.readString(path).replaceAll("(?s)/\\*.*?\\*/", "").replaceAll("(?m)//.*$", "");
    }

    /**
     * The body of one method, ending where the next one starts — <b>not</b> at a named neighbour. Slicing to a
     * neighbour made this test depend on file order, and it broke the day an unrelated method was inserted between
     * the two. What these assertions are about is one method's contents, so that is what the slice has to be.
     */
    private static String bodyOf(String source, String signature) {
        String from = source.substring(source.indexOf(signature));
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
    @DisplayName("the review recommendation is the existing investigator's, reached in exactly one place")
    void oneProducerOfTheReviewJudgement() throws IOException {
        String processor = code(PROCESSOR);

        assertThat(count(processor, "reviewInvestigator.investigate("))
                .as("one call site: a second would be a second opinion about the same review")
                .isEqualTo(1);
        assertThat(count(processor, "prepareReviewRecommendation("))
                .as("declared once and called once, from the rule-decided path")
                .isEqualTo(2);
        assertThat(processor)
                .as("the sentence is carried whole from the investigator, never composed here")
                .contains("c.setRecommendedAction(found.recommendation())");
    }

    @Test
    @DisplayName("nothing about a review is judged here — no rating rule, no repeat rule, no new sentence")
    void noSecondReviewBrain() throws IOException {
        String processor = code(PROCESSOR);
        String body = bodyOf(processor, "private void prepareReviewRecommendation(");

        assertThat(body)
                .as("no threshold, no rating arithmetic and no Korean prose: this method decides nothing, it asks")
                .doesNotContain("getRating()")
                .doesNotContain("Repository")
                .doesNotContain("\"");
        assertThat(count(body, "if ("))
                .as("one guard — is this a review the rules handed to a decision — and no branch beyond it")
                .isEqualTo(1);
    }

    @Test
    @DisplayName("it costs no model call and no marketplace call, so no review has to be chosen over another")
    void freeByConstruction() throws IOException {
        String investigator = code(INVESTIGATOR);
        String processor = code(PROCESSOR);
        String body = bodyOf(processor, "private void prepareReviewRecommendation(");

        assertThat(investigator)
                .as("the investigator reads the issue memory; it holds no model, transport or channel client")
                .doesNotContain("AgentLlm").doesNotContain("ChatModel").doesNotContain("prompt")
                .doesNotContain("Connector").doesNotContain("apiKey");
        assertThat(body)
                .as("no quota is charged and no investigation flag is consulted — there is no spend to ration")
                .doesNotContain("quota").doesNotContain("investigation.isEnabledFor").doesNotContain("investigator.");
    }

    @Test
    @DisplayName("preparation stops at RECOMMENDATION_ONLY — a review still has nothing to send")
    void ceilingHolds() throws IOException {
        String processor = code(PROCESSOR);
        String body = bodyOf(processor, "private void prepareReviewRecommendation(");

        assertThat(body)
                .as("the ceiling for a review, and the honest name for what now exists: something to read")
                .contains("CasePreparedAction.RECOMMENDATION_ONLY")
                .doesNotContain("DRAFT_PREPARED");
        assertThat(processor)
                .as("the draft fences are untouched — both still refuse a non-INQUIRY subject")
                .contains("c.getSubjectKind() != OperationsSubjectKind.INQUIRY");
    }

    @Test
    @DisplayName("an investigation still outranks the row count, and a settled review is prepared nothing")
    void ruleLaneIsTheFloorNotTheAnswer() throws IOException {
        String processor = code(PROCESSOR);
        String body = bodyOf(processor, "private void prepareReviewRecommendation(");

        assertThat(body)
                .as("only a review the rules handed to a decision is prepared — not one they closed or put under watch")
                .contains("conclusion.needsInvestigation()");
        assertThat(processor.indexOf("prepareReviewRecommendation(c,"))
                .as("written before applyInvestigation can overwrite it: a model that read the review outranks a count")
                .isLessThan(processor.indexOf("c.setRecommendedActionType(output.recommendedActionType())"));
    }

    @Test
    @DisplayName("the seller sees the prepared step, and a review is no longer described as 「판단 보류」")
    void theQueueShowsIt() throws IOException {
        String homeWork = code(HOME_WORK);
        String copy = code(COPY);

        assertThat(homeWork)
                .as("the row's one line falls through to what the review lane prepared before the rule's own line")
                .contains("missing ?? row.summary ?? row.recommendedAction ?? row.reasonNote");
        assertThat(copy)
                .as("a review that named no action type is tagged for what it is; subjectKind is a stored fact")
                .contains("subjectKind === \"REVIEW\" ? REASON.review : REASON.withheld");
    }

    @Test
    @DisplayName("the queue has a standing door, and it is not two doors")
    void theQueueIsReachable() throws IOException {
        String nav = code(NAV);

        assertThat(count(nav, "/customer-operations/cases"))
                .as("one menu entry for one screen")
                .isEqualTo(1);
        assertThat(nav)
                .as("named for the seller's question, in 운영 where that question is asked")
                .contains("label: \"확인할 일\"");
    }
}
