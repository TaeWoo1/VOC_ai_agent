package com.sellerops.inquiry.draft;

import com.sellerops.review.draft.ReviewClaimGuard;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Set;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * <b>An inquiry reply may say only what its evidence says</b> (Inquiry Claim Guard v1, 2026-09-19).
 *
 * <p>The review lane has had {@link ReviewClaimGuard} since Grounded Review Drafting v1; the inquiry lane checked a
 * model's reply for the seller's forbidden phrases and nothing else. The Past Answer Prefill proof
 * ({@code apr-3d8b27e5}) then produced, over two passages that say how the parts come apart, a GROUNDED draft ending
 * 「추가로 필요하시면 사용 중 사진을 보내주시면 확인 후 안내드리겠습니다」 — a request the seller never made of a customer
 * and a follow-up nobody on the seller's side agreed to. Both were invented, and both would have gone out in the
 * seller's voice.
 *
 * <p><b>Four closed shapes, each checked against the evidence rather than banned outright.</b> A shape is a violation
 * only when the draft has it and the text that may authorize it does not:
 * <ul>
 *   <li>{@link Kind#SELLER_PROMISE} — a follow-up the seller commits to: 「확인 후 안내드리겠습니다」, 「연락드리겠습니다」,
 *   「조치하겠습니다」. Authorized by the evidence or by the seller's own approved sentences (their unknown-fallback and
 *   required phrases).</li>
 *   <li>{@link Kind#CUSTOMER_ACTION} — the customer asked to send or attach something: 사진·영상·주문번호·송장 + 보내·첨부·
 *   올려. Authorized by the evidence or the seller's approved sentences.</li>
 *   <li>{@link Kind#REMEDY} — a named remedy (환불·교환·보상…), by {@link ReviewClaimGuard#unsupportedClaims}'s own list,
 *   authorized by the evidence alone. Reused, not copied, and that class is not changed.</li>
 *   <li>{@link Kind#FIGURE} — a number the reply states. Authorized by the evidence, the order's own sentence, or the
 *   customer's question (repeating 「10mm」 back to the person who wrote it is not inventing it).</li>
 * </ul>
 *
 * <p><b>What it does not do.</b> It is not a fact checker: an invented cause or a paraphrase that changes a meaning
 * without a number or one of these shapes passes. The lists are short on purpose; a longer one is a classifier by
 * another name. It does not stop a clarifying question — 「어떤 규격을 쓰실지 알려주시면」 names no material to send.
 *
 * <p><b>The response is refusal, never editing</b>, for the reason {@link ReviewClaimGuard} gives: a reply with a
 * clause deleted says something nobody chose.
 *
 * <p>Pure: no I/O, no model, no state.
 */
public final class InquiryClaimGuard {

    public enum Kind { SELLER_PROMISE, CUSTOMER_ACTION, REMEDY, FIGURE }

    /** One unsupported claim: its kind and the text that matched. */
    public record Violation(Kind kind, String matched) {
    }

    /** Matched on text with whitespace removed, so spacing between a noun, its particle and its verb cannot hide it. */
    static final List<Pattern> SELLER_PROMISES = List.of(
            Pattern.compile("확인(?:후|해서|하여|한뒤|한후|뒤|하고|되는대로|되면)(?:에)?(?:다시|바로|빠르게|신속히|곧)?"
                    + "(?:안내|연락|답변|회신|알려)"),
            Pattern.compile("(?:연락|회신)(?:을|를)?(?:다시)?드리(?:겠|도록)"),
            Pattern.compile("다시(?:안내|연락)(?:드리|해)"),
            Pattern.compile("조치(?:하겠|해드리겠|드리겠|하도록)"));

    static final Pattern CUSTOMER_ACTION = Pattern.compile(
            "(사진|영상|동영상|이미지|주문번호|송장번호|송장)[^.!?\\n]{0,12}?(보내|첨부|올려|전송|남겨|회신)");

    /**
     * The same material, as a seller writes that they collect it — 「사진을 받아 확인한 뒤 안내합니다」 is the seller asking
     * for a photo in their own words, so on the authorizing side receiving counts as well as sending.
     */
    static final Pattern CUSTOMER_ACTION_AUTHORIZED = Pattern.compile(
            "(사진|영상|동영상|이미지|주문번호|송장번호|송장)[^.!?\\n]{0,12}?(보내|첨부|올려|전송|남겨|회신|받)");

    /**
     * A number that states something: followed by a unit, or one end of a range. A list marker 「1.」 is not a figure
     * and must not be able to refuse a draft.
     */
    static final Pattern NUMBER = Pattern.compile("\\d+(?:[.,]\\d+)?(?=\\s*(?:~|-|mm|cm|ml|oz|온스|kg|g\\b|m\\b|L\\b|"
            + "리터|미터|센티|일|시간|분|개월|개|원|%|호|가닥|장|매|박스|세트|주|년|회|번째|차))");

    private InquiryClaimGuard() {
    }

    /**
     * @param body        the generated reply
     * @param evidence    the passage texts the drafter was shown — the only thing that authorizes a fact or a remedy
     * @param sellerVoice the seller's own approved sentences (unknown-fallback, required phrases) — they may authorize
     *                    a follow-up or a request, because the seller wrote them to be said
     * @param asked       the customer's question and the order sentence — they may authorize a number and nothing else
     * @return the unsupported claims, in declaration order; empty when the draft is clean
     */
    public static List<Violation> unsupportedClaims(String body, List<String> evidence, List<String> sellerVoice,
                                                    String asked) {
        if (body == null || body.isBlank()) {
            return List.of();
        }
        String draft = squash(body);
        String grounds = squash(join(evidence));
        String voice = grounds + squash(join(sellerVoice));
        List<Violation> found = new ArrayList<>();
        for (Pattern promise : SELLER_PROMISES) {
            Matcher m = promise.matcher(draft);
            if (m.find() && !promise.matcher(voice).find()) {
                found.add(new Violation(Kind.SELLER_PROMISE, m.group()));
            }
        }
        Set<String> authorizedMaterial = new LinkedHashSet<>();
        Matcher allowed = CUSTOMER_ACTION_AUTHORIZED.matcher(voice);
        while (allowed.find()) {
            authorizedMaterial.add(allowed.group(1));
        }
        Matcher action = CUSTOMER_ACTION.matcher(draft);
        while (action.find()) {
            if (!authorizedMaterial.contains(action.group(1))) {
                found.add(new Violation(Kind.CUSTOMER_ACTION, action.group()));
                break;
            }
        }
        for (String remedy : ReviewClaimGuard.unsupportedClaims(body, evidence)) {
            found.add(new Violation(Kind.REMEDY, remedy));
        }
        // Numbers are read from the text as written: squashing 「10 20」 would read one number that nobody wrote.
        // What authorizes a figure is any number the source wrote, with or without its unit.
        Set<String> known = numbers(ANY_NUMBER, join(evidence) + " " + (asked == null ? "" : asked));
        for (String n : numbers(NUMBER, body)) {
            if (!known.contains(n)) {
                found.add(new Violation(Kind.FIGURE, n));
            }
        }
        return List.copyOf(found);
    }

    private static final Pattern ANY_NUMBER = Pattern.compile("\\d+(?:[.,]\\d+)?");

    private static Set<String> numbers(Pattern pattern, String text) {
        Set<String> out = new LinkedHashSet<>();
        Matcher m = pattern.matcher(text);
        while (m.find()) {
            out.add(m.group().replace(",", ""));
        }
        return out;
    }

    private static String join(List<String> texts) {
        return texts == null ? "" : String.join(" ", texts.stream().map(t -> t == null ? "" : t).toList());
    }

    private static String squash(String text) {
        return text == null ? "" : text.replaceAll("\\s+", "");
    }
}
