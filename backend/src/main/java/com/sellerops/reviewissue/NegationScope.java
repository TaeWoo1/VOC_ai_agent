package com.sellerops.reviewissue;

import java.util.List;

/**
 * Whether a vocabulary hit inside one opinion unit is <b>negated</b> — 「파손없이」, 「불량품도 없고」,
 * 「어렵진 않아요」, 「절대 안 떨어져요」, 「누락된 줄 알고」, 「미설치라」, 「설치를 안 해봐서」.
 *
 * <p><b>Why this exists (Issue Evidence Trust Closure v1, 2026-09-04).</b> {@link IssueVocabulary} is a
 * substring table, and a problem word is a hit whether the customer reports it or denies it. Measured
 * on the live Demo Org: the 15-row 「배송 파손」 issue was fourteen copies of 「파손없이 잘 도착했네요」,
 * and the Opportunity Engine turned it into a 교환·반품 기준 suggestion. That is the one failure this
 * class closes — an <i>obviously</i> false issue reaching an Opportunity or a report — and it closes it
 * at the seam the extractor lacked: polarity of the matched word, not the sentiment of the review.
 *
 * <p><b>What this deliberately is not.</b> Not a sentiment model, not a rating gate (a 5★ review may
 * still say 「배송이 좀 늦었네요」, and that clause stays evidence — the structural point of
 * {@link OpinionUnitSplitter}), and not a wider vocabulary. Every token below is closed and stated;
 * the fixture in {@code IssuePolarityFixtureTest} is the measurement it must keep passing.
 *
 * <p><b>Shape.</b> A marker must be <i>attached</i> to the keyword: after it, separated only by
 * bridge tokens (particles, degree adverbs, the verbal negation link 지/진/하지, a few placeholder
 * nouns); or immediately before it (안/못, with at most one space, and 미 with none). Anything else
 * between the word and the marker means the marker belongs to a different predicate — 「접착력이
 * 약해서 안 붙어요」 keeps 약해 because 서 is not a bridge. The asymmetry is chosen: a negation missed
 * leaves one false row; a negation invented erases a real complaint.
 */
public final class NegationScope {

    /** Longest first, so 하지 is consumed before 하 and 하나도 before 하. */
    private static final List<String> BRIDGE = List.of(
            "하나도", "한개도", "한 개도", "전혀", "별로", "거의", "딱히", "전부", "걱정", "부분", "하지", "하진",
            "되지", "되진", "되어", "되었", "1도", "곳", "것", "거", "점", "데", "품", "들", "은", "는", "이", "가",
            "도", "을", "를", "만", "진", "지", "치", "된", "한", "하", "되", "다", " ");

    /** How far past the keyword a bridge may run before the marker must appear. */
    private static final int MAX_BRIDGE_CHARS = 10;

    /**
     * Markers that, attached after the keyword, deny it. 「줄 알」 is the counterfactual 「…인 줄 알았는데」
     * — the customer thought so and found otherwise.
     */
    private static final List<String> AFTER_MARKERS = List.of("없", "않", "못", "줄 알", "줄알");

    /**
     * A keyword that IS a negation (「안 왔」, 「붙지 않」, 「없어서」 — the problem 누락 and 탈락 are spelled
     * as denials) is never itself negated: 「부품이 없어서 못 썼어요」 must not read the consequence 못 as
     * a denial of 없어서. Double negation of these forms does not occur in reviews.
     */
    public static boolean isNegativeForm(String keyword) {
        return keyword.contains("없") || keyword.contains("않") || keyword.contains("안");
    }

    /** 안 as a marker needs a verb after it; these continuations make it a noun (안에, 안쪽…). */
    private static final List<String> NOT_A_NEGATION_AFTER_AN = List.of("에", "쪽", "의", "으로", "이");

    /**
     * A unit that says whose product it is talking about, and it is not this one — 「전에 설치했던
     * 타사의 몰딩은 … 떨어져서」 (four live evidence rows for 「접착 탈락」 were this one review). The
     * problem is real and it is somebody else's; as evidence for THIS seller it is false. Closed and
     * short: only phrases that name another product outright, never a comparison word alone.
     */
    private static final List<String> OTHER_PRODUCT = List.of(
            "타사", "타제품", "다른 회사", "다른 제품", "다른 브랜드", "전에 쓰던", "전에 썼던", "전에 샀던",
            "전에 설치했던", "전에 산", "기존에 쓰던", "기존 제품", "이전 제품", "예전 제품", "예전에 쓰던");

    private NegationScope() {
    }

    /** Does the unit name another product as the thing it is describing? */
    public static boolean aboutAnotherProduct(String unit) {
        if (unit == null) {
            return false;
        }
        for (String phrase : OTHER_PRODUCT) {
            if (unit.contains(phrase)) {
                return true;
            }
        }
        return false;
    }

    /**
     * Is the keyword occupying {@code [start, end)} of {@code unit} negated?
     *
     * @param allowPrefixMi whether 미 directly before the word negates it (미설치 · 미시공) — true for
     *     aspects, where 미 means "not yet done", and false for problems, where 미 is not idiomatic
     */
    public static boolean negated(String unit, int start, int end, boolean allowPrefixMi) {
        return negatedBefore(unit, start, allowPrefixMi) || negatedAfter(unit, end) >= 0;
    }

    /**
     * Position of the after-marker that negates the keyword ending at {@code end}, or -1. Exposed so a
     * caller can ask whether that marker is itself part of another vocabulary hit (「배송이 안 왔어요」 —
     * the 안 belongs to the problem 누락, so it does not negate the aspect 배송).
     */
    public static int negatedAfter(String unit, int end) {
        int pos = end;
        int limit = Math.min(unit.length(), end + MAX_BRIDGE_CHARS);
        while (pos <= limit) {
            for (String marker : AFTER_MARKERS) {
                if (unit.startsWith(marker, pos)) {
                    return pos;
                }
            }
            if (unit.startsWith("안", pos) && isNegatingAn(unit, pos)) {
                return pos;
            }
            String bridge = bridgeAt(unit, pos);
            if (bridge == null) {
                return -1;
            }
            pos += bridge.length();
        }
        return -1;
    }

    /** Is the keyword starting at {@code start} negated by what immediately precedes it (안 · 못 · 미)? */
    public static boolean negatedBefore(String unit, int start, boolean allowPrefixMi) {
        if (allowPrefixMi && start >= 1 && unit.charAt(start - 1) == '미' && startsWord(unit, start - 1)) {
            return true;
        }
        int p = start;
        if (p >= 1 && unit.charAt(p - 1) == ' ') {
            p--;
        }
        if (p >= 1 && (unit.charAt(p - 1) == '안' || unit.charAt(p - 1) == '못') && startsWord(unit, p - 1)) {
            return true;
        }
        return false;
    }

    /** 안/못/미 count only as their own word: 「불안」 or 「미리」 before a keyword is not a negation. */
    private static boolean startsWord(String unit, int index) {
        return index == 0 || !isHangul(unit.charAt(index - 1));
    }

    private static boolean isNegatingAn(String unit, int pos) {
        if (pos + 1 >= unit.length()) {
            return false;
        }
        String rest = unit.substring(pos + 1);
        for (String noun : NOT_A_NEGATION_AFTER_AN) {
            if (rest.startsWith(noun)) {
                return false;
            }
        }
        // 안 + space + verb (안 나와서) or 안 + verb (안나와서); both need something after.
        return rest.charAt(0) == ' ' ? rest.length() > 1 && isHangul(rest.charAt(1)) : isHangul(rest.charAt(0));
    }

    private static String bridgeAt(String unit, int pos) {
        for (String token : BRIDGE) {
            if (unit.startsWith(token, pos)) {
                return token;
            }
        }
        return null;
    }

    private static boolean isHangul(char c) {
        return c >= '가' && c <= '힣';
    }
}
