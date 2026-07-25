package com.sellerops.reviewissue;

import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Optional;

/**
 * The closed vocabulary a deterministic signature extractor can recognise: an <b>aspect</b>
 * (부품·속성 — what the customer is talking about) and a <b>problem</b> (what is wrong with it).
 *
 * <p><b>Read this before extending the keyword lists.</b>
 * {@code contracts/review-eval/naver/v1/RUBRIC.md} records a measured attempt at exactly this
 * shape: 0/30 sample recall, 0/121 records, 12 of 12 attributes never captured — with the
 * diagnosis that the failure was <i>surface-form rigidity</i> rather than vocabulary breadth, and
 * an explicit warning that naive expansion converts 0% recall into unacceptable false positives.
 * So:
 *
 * <ul>
 *   <li>This vocabulary is the <b>first implementation of a port</b>, not a claim to detect
 *       complaints. Its job is to give the Issue Memory something real to store so the
 *       aggregation, change-detection, lifecycle and report layers can be built and verified
 *       without waiting on a semantic capability that scope lock v1.6 ② has not opened.</li>
 *   <li>Its output feeds <b>issue aggregation only</b>. It never decides who is in the
 *       needs-a-look queue — the rubric's regression gate says a detector may only ADD.</li>
 *   <li>Adding keywords to make a demo look better is the failure mode the rubric exists to
 *       prevent. Widen this only against measured labels.</li>
 * </ul>
 *
 * <p><b>Structural improvement that is real even here.</b> The current shipped analyzer derives
 * sentiment and urgency as pure functions of {@code rating}, so a 5★ review saying
 * "배송이 너무 늦었어요" is invisible. Because this vocabulary is applied to each opinion unit
 * <i>separately</i> (see {@link OpinionUnitSplitter}), a complaining clause inside a positive
 * review can produce a signature. That is a structural fix, independent of vocabulary breadth —
 * and it is the part of this design worth keeping when a better extractor replaces the keywords.
 */
public final class IssueVocabulary {

    /** 부품·속성 — what the unit is about. Order is detection order: first hit wins. */
    private static final Map<String, List<String>> ASPECTS = new LinkedHashMap<>();
    /** 문제 — what is wrong. Order is detection order: first hit wins. */
    private static final Map<String, List<String>> PROBLEMS = new LinkedHashMap<>();
    /**
     * Severity is a fixed property of the PROBLEM, not a judgment about any one review, and
     * deliberately not derived from rating. HIGH means the customer did not receive a usable
     * product; that is an operational failure regardless of how they rated it.
     */
    private static final Map<String, IssueSeverity> PROBLEM_SEVERITY = new LinkedHashMap<>();

    static {
        ASPECTS.put("배송", List.of("배송", "택배", "발송", "출고", "도착"));
        ASPECTS.put("포장", List.of("포장", "박스", "완충", "뽁뽁이", "비닐"));
        ASPECTS.put("접착", List.of("접착", "양면테이프", "테이프", "붙였", "붙이"));
        ASPECTS.put("표면", List.of("표면", "마감", "코팅", "도장", "재질"));
        ASPECTS.put("색상", List.of("색상", "컬러", "색깔", "색감"));
        ASPECTS.put("크기", List.of("사이즈", "길이", "두께", "치수", "규격"));
        ASPECTS.put("설치", List.of("설치", "시공", "조립", "부착", "고정"));
        ASPECTS.put("설명", List.of("설명서", "매뉴얼", "설명", "안내문"));
        ASPECTS.put("가격", List.of("가격", "가성비", "비싸", "저렴"));

        PROBLEMS.put("파손", List.of("깨짐", "깨져", "깨진", "파손", "부서", "찌그러", "터짐", "찢어"));
        PROBLEMS.put("결함", List.of("불량", "하자", "결함"));
        PROBLEMS.put("누락", List.of("누락", "빠져", "안 왔", "안왔", "오지 않", "없어서"));
        PROBLEMS.put("균열", List.of("갈라", "크랙", "금이", "실금"));
        PROBLEMS.put("탈락", List.of("떨어졌", "떨어져", "안 붙", "안붙", "붙지 않", "떨어집"));
        PROBLEMS.put("불일치", List.of("사진과", "생각과", "달라", "달랐", "다르네", "다릅"));
        PROBLEMS.put("지연", List.of("지연", "늦게", "늦었", "늦어", "오래 걸"));
        // 약해/약함/약하/약합 are four conjugations of ONE stem (약하다), not four pieces of
        // vocabulary. Covering some and not others is a hole in a single word rather than a gap in
        // coverage — and 약합니다 is the polite-formal form that dominates Korean product reviews, so
        // omitting it would miss the most common way the complaint is actually written. This is the
        // bounded kind of addition; widening to NEW problems needs measured labels first.
        PROBLEMS.put("부족", List.of("약해", "약함", "약하", "약합", "부족", "헐렁"));
        PROBLEMS.put("오염", List.of("오염", "얼룩", "지저분", "먼지"));
        PROBLEMS.put("난이도", List.of("어렵", "어려", "힘들", "복잡", "모르겠"));

        PROBLEM_SEVERITY.put("파손", IssueSeverity.HIGH);
        PROBLEM_SEVERITY.put("결함", IssueSeverity.HIGH);
        PROBLEM_SEVERITY.put("누락", IssueSeverity.HIGH);
        PROBLEM_SEVERITY.put("균열", IssueSeverity.NORMAL);
        PROBLEM_SEVERITY.put("탈락", IssueSeverity.NORMAL);
        PROBLEM_SEVERITY.put("불일치", IssueSeverity.NORMAL);
        PROBLEM_SEVERITY.put("지연", IssueSeverity.NORMAL);
        PROBLEM_SEVERITY.put("부족", IssueSeverity.NORMAL);
        PROBLEM_SEVERITY.put("오염", IssueSeverity.NORMAL);
        PROBLEM_SEVERITY.put("난이도", IssueSeverity.LOW);
    }

    private IssueVocabulary() {
    }

    /** Every recognisable aspect, in detection order. */
    public static List<String> aspects() {
        return List.copyOf(ASPECTS.keySet());
    }

    /** Every recognisable problem, in detection order. */
    public static List<String> problems() {
        return List.copyOf(PROBLEMS.keySet());
    }

    /** First aspect whose keyword appears in {@code unit}, or empty. */
    public static Optional<String> aspectOf(String unit) {
        return firstMatch(ASPECTS, unit);
    }

    /** First problem whose keyword appears in {@code unit}, or empty. */
    public static Optional<String> problemOf(String unit) {
        return firstMatch(PROBLEMS, unit);
    }

    /**
     * Severity of a problem. Throws for an unknown problem rather than defaulting: a severity
     * quietly defaulted to NORMAL would let a vocabulary edit downgrade 파손 without anyone
     * noticing, and severity is what an operator triages on.
     */
    public static IssueSeverity severityOf(String problem) {
        IssueSeverity severity = PROBLEM_SEVERITY.get(problem);
        if (severity == null) {
            throw new IllegalArgumentException("알 수 없는 문제 유형입니다: " + problem);
        }
        return severity;
    }

    private static Optional<String> firstMatch(Map<String, List<String>> table, String unit) {
        if (unit == null || unit.isBlank()) {
            return Optional.empty();
        }
        for (Map.Entry<String, List<String>> entry : table.entrySet()) {
            for (String keyword : entry.getValue()) {
                if (unit.contains(keyword)) {
                    return Optional.of(entry.getKey());
                }
            }
        }
        return Optional.empty();
    }
}
