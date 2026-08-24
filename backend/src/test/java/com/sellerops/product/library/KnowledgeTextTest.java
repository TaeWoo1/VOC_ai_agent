package com.sellerops.product.library;

import static org.assertj.core.api.Assertions.assertThat;

import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * Retrieval's two halves, tested as the pure functions they are.
 *
 * <p>These are the tests that make "근거" mean something: if chunking and scoring are not reproducible,
 * an answer's citation is a coincidence, and no amount of provenance metadata fixes that.
 */
@DisplayName("상품 지식 — 인용 단위와 점수")
class KnowledgeTextTest {

    @Test
    @DisplayName("판매자가 비운 줄은 저자가 그은 경계이므로 그 자리에서 나뉜다")
    void splitsOnAuthoredBoundaries() {
        String body = "교환은 수령 후 7일 이내에 가능합니다.\n\n반품 배송비는 5,000원입니다.";

        List<String> parts = KnowledgeText.chunk(body);

        assertThat(parts).hasSize(1);
        // Both survive in one passage because together they are well under the target: an answer about
        // returns should not have to cite two rows to say one thing.
        assertThat(parts.get(0)).contains("교환은").contains("반품 배송비");
    }

    @Test
    @DisplayName("긴 글은 목표 길이에서 나뉘고, 어느 조각도 최대 길이를 넘지 않는다")
    void splitsLongDocuments() {
        String paragraph = "이 제품은 사용 전에 미지근한 물로 한 번 헹궈 주세요. ".repeat(12);
        String body = (paragraph + "\n\n") + (paragraph + "\n\n") + paragraph;

        List<String> parts = KnowledgeText.chunk(body);

        assertThat(parts.size()).isGreaterThan(1);
        assertThat(parts).allSatisfy(part ->
                assertThat(part.length()).isLessThanOrEqualTo(KnowledgeText.MAX_CHARS));
    }

    @Test
    @DisplayName("꼬리 한 줄은 제 조각이 되지 않고 앞 조각에 붙는다")
    void foldsAStrayTailIntoItsNeighbour() {
        String body = "사용법을 자세히 설명합니다. ".repeat(30) + "\n\n감사합니다.";

        List<String> parts = KnowledgeText.chunk(body);

        assertThat(parts).isNotEmpty();
        assertThat(parts.get(parts.size() - 1)).endsWith("감사합니다.");
        // "감사합니다." alone would win a query on nothing and carry no context.
        assertThat(parts).noneMatch(part -> part.equals("감사합니다."));
    }

    @Test
    @DisplayName("빈 글은 조각을 만들지 않는다 — 저장은 됐지만 인용할 것이 없는 상태")
    void emptyBodyProducesNoChunks() {
        assertThat(KnowledgeText.chunk("")).isEmpty();
        assertThat(KnowledgeText.chunk("   \n\n  ")).isEmpty();
        assertThat(KnowledgeText.chunk(null)).isEmpty();
    }

    // ── Retrieval. Every case below is a live 2026-08-24 read that the previous scorer got wrong,
    //    or the property whose absence let it get that read wrong. See QueryWords for the inversion.

    @Test
    @DisplayName("조사가 붙어도 같은 낱말로 읽힌다 — 이 층이 존재하는 이유")
    void matchesAcrossKoreanParticles() {
        String content = KnowledgeText.normalize("이 제품의 사용법은 다음과 같습니다.");

        // A whitespace tokenizer scores the first of these at zero, which is the whole failure.
        assertThat(KnowledgeText.prefixMatch("사용법을", content)).isEqualTo(3);
        assertThat(KnowledgeText.prefixMatch("사용법", content)).isEqualTo(3);
    }

    @Test
    @DisplayName("띄어쓰기와 문장부호는 같은 문장을 두 개로 만들지 않는다")
    void normalizationIgnoresSpacingAndPunctuation() {
        assertThat(KnowledgeText.normalize("사용 방법!")).isEqualTo(KnowledgeText.normalize("사용방법"));
    }

    @Test
    @DisplayName("겹치는 부분은 낱말의 앞에서부터 센다 — 어간은 앞에 있고 조사는 뒤에 붙는다")
    void prefixMatchCountsFromTheHeadOfTheWord() {
        String content = KnowledgeText.normalize("몰딩 케이블의 내부 폭은 18mm, 높이는 11mm입니다.");

        assertThat(KnowledgeText.prefixMatch("폭이", content)).isEqualTo(1);
        assertThat(KnowledgeText.prefixMatch("mm", content)).isEqualTo(2);
        // Nothing of this word is written here, and a lexical matcher must be able to say so.
        assertThat(KnowledgeText.prefixMatch("방수", content)).isEqualTo(0);
    }

    // ── A. 명시적으로 답하는 문서는 NO_MATCH를 이긴다.

    @Test
    @DisplayName("A. 폭을 적어 둔 문서는 폭을 묻는 질문에 걸린다")
    void aDocumentThatStatesTheWidthAnswersAQuestionAboutIt() {
        List<String> corpus = List.of(KnowledgeText.normalize("이 상품의 폭은 18mm입니다."));

        KnowledgeText.Weighing weighing =
                KnowledgeText.weigh("폭이 몇 mm인가요?", corpus, "몰딩 케이블");

        assertThat(weighing.askableRatio()).isGreaterThanOrEqualTo(0.35);
        KnowledgeText.Assessment assessment = weighing.assess(corpus.get(0));
        assertThat(assessment.coverage()).isGreaterThanOrEqualTo(0.4);
        assertThat(assessment.matchedChars()).isGreaterThanOrEqualTo(2);
    }

    // ── B. 안전한 표기 차이는 질문을 갈라놓지 않는다.

    @Test
    @DisplayName("B. \"교환 및 반품\"과 \"교환 반품\"은 같은 문서에 닿는다")
    void aConjunctionDoesNotDecideRetrieval() {
        List<String> corpus = List.of(
                KnowledgeText.normalize("교환 및 반품 안내 단순 변심 반품은 수령 후 7일 이내입니다."),
                KnowledgeText.normalize("부착 방법 벽면의 먼지를 닦고 눌러 붙입니다."));

        // Live on 2026-08-24 the first of these returned nothing and the second returned the policy:
        // the shingles straddled the word that was removed, so deleting 및 deleted 환및 and 및반 too.
        for (String question : List.of("교환 반품 기준 알려줘.", "교환 및 반품 기준 알려줘.")) {
            KnowledgeText.Weighing weighing = KnowledgeText.weigh(question, corpus, "전선몰딩");
            assertThat(weighing.askableRatio()).as(question).isGreaterThanOrEqualTo(0.35);
            assertThat(weighing.assess(corpus.get(0)).coverage()).as(question)
                    .isGreaterThanOrEqualTo(0.4)
                    .isGreaterThan(weighing.assess(corpus.get(1)).coverage());
        }
    }

    // ── C. 없는 내용은 없다고 말할 수 있어야 한다.

    @Test
    @DisplayName("C. 방수를 적지 않은 라이브러리는 방수 질문에 아무것도 내놓지 않는다")
    void anUnwrittenTopicIsRefusedRatherThanApproximated() {
        List<String> corpus = List.of(
                KnowledgeText.normalize("부착 방법 벽면의 먼지를 닦고 24시간 두세요."),
                KnowledgeText.normalize("교환 및 반품 안내 수령 후 7일 이내에 가능합니다."));

        assertThat(KnowledgeText.weigh("방수 되나요?", corpus, "전선몰딩").askableRatio())
                .isLessThan(0.35);
        // The same question with the subject spelled out. "이 상품" names what retrieval already
        // resolved, so it must not be able to carry the question over the gate.
        assertThat(KnowledgeText.weigh("이 상품 방수 되나요?", corpus, "전선몰딩").askableRatio())
                .isLessThan(0.35);
    }

    @Test
    @DisplayName("상품 이름을 부른 질문은 그 이름만으로는 근거를 얻지 못한다")
    void namingTheProductIsNotEvidence() {
        List<String> corpus = List.of(KnowledgeText.normalize(
                "선바로 상품 설명 신개념 일체형 전선몰딩 선바로는 공구 없이 설치할 수 있습니다."));
        String name = "[벌크] 신개념 일체형 전선몰딩 선바로";

        // Live on 2026-08-24 both of these returned this passage at score 1.00, because the product's
        // own name was a three-character verbatim run and the gate accepted runs.
        assertThat(KnowledgeText.weigh("선바로 방수 되나요?", corpus, name).askableRatio())
                .isLessThan(0.35);
        assertThat(KnowledgeText.weigh("선바로 한개당 길이가 몇 m인가요?", corpus, name).askableRatio())
                .isLessThan(0.35);
        // What the description DOES say still answers.
        KnowledgeText.Weighing installation =
                KnowledgeText.weigh("선바로 설치는 어떻게 하나요?", corpus, name);
        assertThat(installation.askableRatio()).isGreaterThanOrEqualTo(0.35);
        assertThat(installation.assess(corpus.get(0)).coverage()).isGreaterThanOrEqualTo(0.4);
    }

    // ── D. 아는 부분과 모르는 부분이 섞인 질문.

    @Test
    @DisplayName("D. 절반만 아는 질문은 아는 쪽으로 걸리되, 덮은 만큼만 점수를 받는다")
    void aPartlyAnsweredQuestionScoresOnlyThePartItCovers() {
        List<String> corpus = List.of(
                KnowledgeText.normalize("교환 및 반품 안내 반품 배송비는 5000원입니다."));

        KnowledgeText.Weighing both = KnowledgeText.weigh("반품 배송비와 방수 여부", corpus, "전선몰딩");
        KnowledgeText.Weighing known = KnowledgeText.weigh("반품 배송비", corpus, "전선몰딩");

        assertThat(both.askableRatio()).isGreaterThanOrEqualTo(0.35).isLessThan(1.0);
        assertThat(both.assess(corpus.get(0)).coverage()).isGreaterThanOrEqualTo(0.4);
        // The unanswerable half is visible in the ratio and nowhere else: it never lifts the passage.
        assertThat(known.askableRatio()).isGreaterThan(both.askableRatio());
    }

    // ── The properties the gates rest on.

    @Test
    @DisplayName("드문 낱말이 흔한 낱말보다 무겁다 — 질문의 주제가 문법을 이긴다")
    void rarityOutweighsFiller() {
        List<String> corpus = List.of(
                KnowledgeText.normalize("사용 방법 이 물건은 이렇게 씁니다"),
                KnowledgeText.normalize("교환 반품 이 물건은 이렇게 반품합니다"),
                KnowledgeText.normalize("배송 안내 이 물건은 이렇게 갑니다"));

        KnowledgeText.Weighing weighing = KnowledgeText.weigh("이렇게 사용 방법", corpus, "전선몰딩");

        // "이렇게" is in all three and distinguishes nothing; "사용" is in one.
        assertThat(weightOf(weighing, "사용")).isGreaterThan(weightOf(weighing, "이렇게"));
        assertThat(weighing.assess(corpus.get(0)).coverage())
                .isGreaterThan(weighing.assess(corpus.get(1)).coverage());
    }

    @Test
    @DisplayName("점수는 질문을 얼마나 덮었는지이지, 조각이 얼마나 짧은지가 아니다")
    void coverageIsAsymmetricTowardTheQuestion() {
        String shortAnswer = KnowledgeText.normalize("반품 배송비는 5000원입니다.");
        String longAnswer = KnowledgeText.normalize(
                "반품 배송비는 5000원입니다. " + "그 밖의 안내 사항이 아주 길게 이어집니다. ".repeat(10));
        KnowledgeText.Weighing weighing =
                KnowledgeText.weigh("반품 배송비", List.of(shortAnswer, longAnswer), "전선몰딩");

        // Jaccard would punish the long one for answering more than it was asked.
        assertThat(weighing.assess(longAnswer).coverage())
                .isEqualTo(weighing.assess(shortAnswer).coverage());
    }

    @Test
    @DisplayName("라이브러리가 질문을 더 많이 알수록 점수가 오르지는 않는다 — 뒤집힘이 사라진 자리")
    void knowingMoreOfTheQuestionNeverRaisesAPassage() {
        String policy = KnowledgeText.normalize("교환 및 반품 안내 수령 후 7일 이내에 가능합니다.");
        String question = "반품 기준과 방수 여부 알려주세요";

        double alone = KnowledgeText.weigh(question, List.of(policy), "전선몰딩")
                .assess(policy).coverage();
        double beside = KnowledgeText.weigh(question,
                        List.of(policy, KnowledgeText.normalize("방수 안내 이 제품은 방수가 되지 않습니다.")),
                        "전선몰딩")
                .assess(policy).coverage();

        // The old scorer's denominator was the askable part of the question, so adding the 방수 note
        // — knowledge the seller ADDED — lowered this passage. Ranking must not move on that.
        assertThat(beside).isLessThanOrEqualTo(alone);
        assertThat(beside).isGreaterThan(0.0);
    }

    @Test
    @DisplayName("한 음절 우연은 근거가 되지 않는다 — 절대 글자 수")
    void aSingleSyllableCoincidenceIsNotACitation() {
        List<String> corpus = List.of(KnowledgeText.normalize("보관 시 직사광선을 피해 주세요."));

        KnowledgeText.Weighing weighing = KnowledgeText.weigh("보증 기간", corpus, "전선몰딩");

        // "보증" shares only 보 with 보관, and "기간" only 간 — never counted from the head, so 0.
        assertThat(weighing.assess(corpus.get(0)).matchedChars()).isLessThan(2);
    }

    @Test
    @DisplayName("빈 코퍼스에서는 어떤 질문도 물을 수 없다")
    void anEmptyCorpusAnswersNothing() {
        KnowledgeText.Weighing weighing = KnowledgeText.weigh("사용 방법", List.of(), "전선몰딩");

        assertThat(weighing.askableRatio()).isEqualTo(0.0);
        assertThat(weighing.assess("아무거나").coverage()).isEqualTo(0.0);
    }

    @Test
    @DisplayName("질문에 내용어가 없으면 무엇도 덮지 못한다")
    void aQuestionOfPureGrammarScoresZero() {
        KnowledgeText.Weighing weighing =
                KnowledgeText.weigh("이 상품 어떤가요?", List.of(KnowledgeText.normalize("아무 내용")),
                        "전선몰딩");

        assertThat(weighing.askableRatio()).isEqualTo(0.0);
    }

    private static double weightOf(KnowledgeText.Weighing weighing, String word) {
        return weighing.terms().stream()
                .filter(term -> term.word().equals(word))
                .findFirst()
                .orElseThrow()
                .weight();
    }
}
