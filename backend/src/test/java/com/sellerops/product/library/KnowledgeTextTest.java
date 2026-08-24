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

    @Test
    @DisplayName("조사가 붙어도 같은 낱말로 읽힌다 — 이 층이 존재하는 이유")
    void matchesAcrossKoreanParticles() {
        String content = KnowledgeText.normalize("이 제품의 사용법은 다음과 같습니다.");

        double withParticle = KnowledgeText.score(KnowledgeText.normalize("사용법을 알려줘"), content);
        double bare = KnowledgeText.score(KnowledgeText.normalize("사용법"), content);

        assertThat(bare).isGreaterThan(0.0);
        // A whitespace tokenizer scores the first of these at zero, which is the whole failure.
        assertThat(withParticle).isGreaterThan(0.0);
    }

    @Test
    @DisplayName("띄어쓰기와 문장부호는 같은 문장을 두 개로 만들지 않는다")
    void normalizationIgnoresSpacingAndPunctuation() {
        assertThat(KnowledgeText.normalize("사용 방법!")).isEqualTo(KnowledgeText.normalize("사용방법"));
    }

    @Test
    @DisplayName("점수는 질문을 얼마나 덮었는지이지, 조각이 얼마나 짧은지가 아니다")
    void scoreIsAsymmetricTowardTheQuestion() {
        String question = KnowledgeText.normalize("반품 배송비");
        String shortAnswer = KnowledgeText.normalize("반품 배송비는 5000원입니다.");
        String longAnswer = KnowledgeText.normalize(
                "반품 배송비는 5000원입니다. " + "그 밖의 안내 사항이 아주 길게 이어집니다. ".repeat(10));

        // Jaccard would punish the long one for answering more than it was asked.
        assertThat(KnowledgeText.score(question, longAnswer))
                .isEqualTo(KnowledgeText.score(question, shortAnswer));
    }

    @Test
    @DisplayName("관계없는 질문은 0에 가깝다 — 없다고 말할 수 있어야 한다")
    void unrelatedQuestionsScoreNearZero() {
        String content = KnowledgeText.normalize("교환은 수령 후 7일 이내에 가능합니다.");

        double score = KnowledgeText.score(KnowledgeText.normalize("배터리 충전 시간"), content);

        assertThat(score).isLessThan(0.12);
    }

    // ── The two signals retrieval actually uses. Both exist because one of them alone shipped a
    //    wrong answer on a live read (see KnowledgeText#weigh).

    @Test
    @DisplayName("드문 낱말이 흔한 낱말보다 무겁다 — 질문의 주제가 문법을 이긴다")
    void rarityOutweighsFiller() {
        List<String> corpus = List.of(
                KnowledgeText.normalize("사용 방법 이 상품은 이렇게 씁니다"),
                KnowledgeText.normalize("교환 반품 이 상품은 이렇게 반품합니다"),
                KnowledgeText.normalize("배송 안내 이 상품은 이렇게 갑니다"));

        KnowledgeText.Weighing weighing =
                KnowledgeText.weigh(KnowledgeText.normalize("이 상품 사용 방법"), corpus);

        // "상품" is in all three and distinguishes nothing; "사용" is in one.
        assertThat(weighing.weights().get("사용")).isGreaterThan(weighing.weights().get("상품"));
        assertThat(weighing.topicCoverage(corpus.get(0)))
                .isGreaterThan(weighing.topicCoverage(corpus.get(1)));
    }

    @Test
    @DisplayName("아무도 쓰지 않은 낱말은 분모에 남는다 — 그래야 부재를 감지한다")
    void unwrittenShinglesStayInTheDenominator() {
        List<String> corpus = List.of(KnowledgeText.normalize("전선몰딩 부착 방법. 24시간 동안 두세요."));

        KnowledgeText.Weighing onTopic =
                KnowledgeText.weigh(KnowledgeText.normalize("부착 방법"), corpus);
        KnowledgeText.Weighing offTopic =
                KnowledgeText.weigh(KnowledgeText.normalize("배터리 충전 시간"), corpus);

        // The off-topic question shares only "시간", which the note happens to contain as "24시간" —
        // the exact coincidence that made an earlier scorer answer a battery question with a molding
        // note. The askable ratio is what refuses it.
        assertThat(onTopic.askableRatio()).isGreaterThan(offTopic.askableRatio());
        assertThat(offTopic.askableRatio()).isLessThan(0.35);
    }

    @Test
    @DisplayName("함께 쓰인 낱말은 흩어진 겹침과 다르다 — 이어진 구간의 길이")
    void contiguityDistinguishesAPhraseFromCoincidence() {
        String note = KnowledgeText.normalize("전선몰딩 부착 및 사용 방법");

        // The seller's own phrase, verbatim.
        assertThat(KnowledgeText.longestSharedRun(
                KnowledgeText.normalize("이 상품의 사용 방법은 무엇인가"), note)).isGreaterThanOrEqualTo(4);
        // Korean grammar lands on something in any text; two syllables is not a phrase.
        assertThat(KnowledgeText.longestSharedRun(
                KnowledgeText.normalize("배터리 충전 시간"), note)).isLessThan(3);
    }

    @Test
    @DisplayName("빈 코퍼스에서는 어떤 질문도 물을 수 없다")
    void anEmptyCorpusAnswersNothing() {
        KnowledgeText.Weighing weighing = KnowledgeText.weigh(KnowledgeText.normalize("사용 방법"), List.of());

        assertThat(weighing.weights()).isEmpty();
        assertThat(weighing.askableRatio()).isEqualTo(0.0);
        assertThat(weighing.topicCoverage("아무거나")).isEqualTo(0.0);
    }

    @Test
    @DisplayName("빈 질문은 무엇도 덮지 못한다")
    void emptyQueryScoresZero() {
        assertThat(KnowledgeText.score("", KnowledgeText.normalize("아무 내용"))).isEqualTo(0.0);
    }
}
