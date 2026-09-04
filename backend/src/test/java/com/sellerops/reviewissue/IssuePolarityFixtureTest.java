package com.sellerops.reviewissue;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.reviewissue.IssueSignatureExtractor.ExtractedUnit;
import java.util.ArrayList;
import java.util.List;
import org.junit.jupiter.api.DisplayName;
import org.junit.jupiter.api.Test;

/**
 * The polarity fixture behind Issue Evidence Trust Closure v1 (2026-09-04).
 *
 * <p><b>Why a fixture and not a rule.</b> The live Demo Org had 85 evidence rows and most of them sat
 * on 4–5★ reviews: 「파손없이 잘 도착했네요」 was the whole of a 15-row 「배송 파손」 issue, which the
 * Opportunity Engine then turned into a 교환·반품 기준 suggestion. The extractor has no seam for
 * polarity — {@code IssueVocabulary} is a substring table and a problem word inside its own negation
 * is still a hit. Hard-coding 「파손없이」 would close one row; the fixture below is the SHAPES the live
 * corpus actually used (written fresh, not copied from any customer), so the fix is measured against
 * what fooled the extractor and against what it must keep finding.
 *
 * <p>Four categories, each with an expectation the extractor must meet:
 * <ul>
 *   <li>A 실제 불만 — the signature must still be produced (recall floor).</li>
 *   <li>B 문제 없음·부정 표현 — the problem word is negated; no signature.</li>
 *   <li>C 칭찬 속 issue 단어 — praise that names a problem word, or another product's problem; no
 *       signature.</li>
 *   <li>D mixed sentiment — the complaining clause is evidence, the praising clause is not.</li>
 * </ul>
 *
 * <p>The goal is not recall. It is that no OBVIOUSLY false issue reaches an Opportunity or a report,
 * so B and C are asserted to be exactly zero, while A and D are asserted to be complete.
 */
class IssuePolarityFixtureTest {

    private final RuleBasedIssueSignatureExtractor extractor = new RuleBasedIssueSignatureExtractor(false);

    /** One fixture sentence: the text, and the signature keys it must (or must not) yield. */
    record Case(String category, String text, List<String> expectedKeys) {
        static Case real(String text, String... keys) {
            return new Case("A 실제 불만", text, List.of(keys));
        }

        static Case negated(String text) {
            return new Case("B 문제 없음", text, List.of());
        }

        static Case praise(String text) {
            return new Case("C 칭찬 속 issue 단어", text, List.of());
        }

        static Case mixed(String text, String... keys) {
            return new Case("D mixed", text, List.of(keys));
        }
    }

    static final List<Case> FIXTURE = List.of(
            // A — real complaints, including the ones a 5★ rating hides.
            Case.real("배송이 좀 늦었네요", "배송:지연"),
            Case.real("접착력이 약해서 3M 테이프로 다시 붙였어요", "접착:부족"),
            Case.real("박스가 찌그러져서 왔어요", "포장:파손"),
            Case.real("설명서가 안 왔어요", "설명:누락"),
            Case.real("배송이 안 왔어요", "배송:누락"),
            Case.real("테이프가 하루 만에 떨어졌어요", "접착:탈락"),
            Case.real("색상이 사진과 달라요", "색상:불일치"),
            Case.real("마감캡이 자꾸 빠져서 속상해요", "표면:누락"),
            Case.real("양면테이프가 생각보다 약해서 고정이 안 될 것 같아요", "접착:부족"),
            Case.real("설치가 너무 어려웠습니다", "설치:난이도"),
            // B — the problem word, negated. Every shape below was a live evidence row.
            Case.negated("파손없이 잘 도착했네요"),
            Case.negated("파손 없이 잘 도착했습니다"),
            Case.negated("불량품도 없고 배송 빠르고 만족스러워요"),
            Case.negated("불량품 전혀 안 나와서 좋아요 배송 정확하고 빨라요"),
            Case.negated("누락없이 잘 왔습니다"),
            Case.negated("설치가 어렵진 않아요"),
            Case.negated("실리콘으로 붙이면 절대 안 떨어져요"),
            Case.negated("배송도 늦지 않았어요"),
            Case.negated("포장이 찢어진 곳 하나도 없었어요"),
            Case.negated("마감캡 누락된 줄 알고 상자를 버리려다 찾았어요"),
            Case.negated("아직 설치를 안 해봐서 잘 모르겠어요"),
            Case.negated("아직 미설치라 잘 모르겠어요"),
            Case.negated("배송 중에 깨진 데 없이 왔어요"),
            // C — praise that names a problem word.
            Case.praise("튼튼해서 파손 걱정 없어요"),
            Case.praise("배송 빠르고 불량 하나도 없어요"),
            Case.praise("포장이 꼼꼼해서 깨짐 없이 도착했어요"),
            Case.praise("배송 빠르고 다른 상품도 누락 없이 잘 도착했습니다"),
            Case.praise("전에 설치했던 타사 몰딩은 얼마 안 있다 떨어져서 고생했는데 이건 잘 붙어요"),
            Case.praise("예전 제품은 접착력이 약했는데 이건 튼튼하네요"),
            // D — mixed: the complaining clause is evidence, the rest is not.
            Case.mixed("예쁜데 배송이 너무 늦었어요", "배송:지연"),
            Case.mixed("배송은 늦었지만 제품은 만족해요", "배송:지연"),
            Case.mixed("포장은 좋았는데 색상이 사진과 달라요", "색상:불일치"),
            Case.mixed("파손 없이 왔는데 접착력이 약해요", "접착:부족"),
            Case.mixed("제품 좋고 설치는 편한데, 진짜 접착력이 약하네요.", "접착:부족"),
            Case.mixed("가격도 저렴하고 만족스러워요 배송 시 박스가 파손되어서 걱정했는데", "배송:파손"));

    private List<String> keysOf(String text) {
        List<String> keys = new ArrayList<>();
        for (ExtractedUnit unit : extractor.extract(text)) {
            if (unit.isMatched()) {
                keys.add(unit.signature().signatureKey());
            }
        }
        return keys;
    }

    @Test
    @DisplayName("the fixture: false issues are zero, real issues are all found")
    void fixtureMeasuresPolarity() {
        List<String> falseIssues = new ArrayList<>();
        List<String> missedIssues = new ArrayList<>();
        for (Case c : FIXTURE) {
            List<String> got = keysOf(c.text());
            if (c.expectedKeys().isEmpty() && !got.isEmpty()) {
                falseIssues.add(c.category() + " | " + c.text() + " → " + got);
            } else if (!c.expectedKeys().isEmpty() && !got.equals(c.expectedKeys())) {
                missedIssues.add(c.category() + " | " + c.text() + " → " + got + " (wanted " + c.expectedKeys() + ")");
            }
        }
        // Reported as one line per failure so a regression names the sentence, not a percentage.
        assertThat(falseIssues).as("문제 없음·칭찬 문장이 issue evidence가 됨").isEmpty();
        assertThat(missedIssues).as("실제 불만이 evidence에서 빠짐").isEmpty();
    }

    /** The measurement table, for the package record — never a pass/fail by itself. */
    @Test
    void printMeasurement() {
        int falseCount = 0;
        int negativeTotal = 0;
        int missed = 0;
        int positiveTotal = 0;
        for (Case c : FIXTURE) {
            List<String> got = keysOf(c.text());
            if (c.expectedKeys().isEmpty()) {
                negativeTotal++;
                if (!got.isEmpty()) {
                    falseCount++;
                }
            } else {
                positiveTotal++;
                if (!got.equals(c.expectedKeys())) {
                    missed++;
                }
            }
        }
        System.out.printf("POLARITY_FIXTURE false=%d/%d missed=%d/%d%n",
                falseCount, negativeTotal, missed, positiveTotal);
    }
}
