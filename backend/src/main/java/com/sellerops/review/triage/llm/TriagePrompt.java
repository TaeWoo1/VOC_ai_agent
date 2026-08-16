package com.sellerops.review.triage.llm;

import com.sellerops.itemanalysis.ItemAnalysisCategories;
import com.sellerops.review.triage.TriageReasonCode;
import java.nio.charset.StandardCharsets;
import java.security.MessageDigest;
import java.security.NoSuchAlgorithmException;
import java.util.stream.Collectors;

/**
 * The system prompt, versioned, and the hash that proves which one ran.
 *
 * <p><b>The prompt is part of the classifier's identity.</b> RUBRIC v2 §8.6: a version names the
 * model, the system prompt, the rubric text and the output schema together, because a result whose
 * prompt was edited underneath it is not reproducible and the change log that section requires would
 * mean nothing.
 *
 * <p><b>Edit rules.</b> Any change to {@link #SYSTEM} is a new {@link #PROMPT_VERSION} and a new row
 * in the §8.6 change log — including a change that only rearranges words. The log records every
 * prompt run against {@code DEV}, not only the one that wins, because a candidate that needed six
 * passes to clear the bars is a different object from one that cleared them on the first.
 *
 * <p><b>What is deliberately NOT in this prompt:</b> any review from the corpus as a worked example.
 * A prompt carrying rows from the evaluation frame would be scored against reviews it had already
 * been shown, and §6.3's rule against terms traceable to a specific unlabeled review applies with
 * more force to whole reviews. The tie-breakers below are `v1` §2's own abstract cases.
 *
 * <h2>v2 — the precedence ambiguity</h2>
 *
 * <p>v1 listed `v1` §2's tie-breakers as a flat numbered list "in priority order", which turned out
 * not to be an instruction at all: gpt-5 read a 1★ and a 2★ complaint, decided the buyer had asked
 * for nothing, and applied "criticism with no request is NO_ACTION" to demote reviews that "a low
 * rating with text" had already made {@code NEEDS_ATTENTION}. Both were reviews the human labelers
 * also called 확인 필요.
 *
 * <p>v2 replaces the flat list with <b>two stages, where stage 1 is terminal</b>. A later
 * tie-breaker can no longer reach back and lower a tier an earlier one established, because it is
 * never consulted. It also says outright that {@code reasonCode} does not decide the tier — both
 * demotions arrived carrying {@code CRITIQUE_NO_REQUEST}, which reads like the model picked a label
 * and then reasoned backwards to a tier that matched it.
 *
 * <p><b>This is a prompt fix, and a prompt is a request.</b> The thing that actually forbids the
 * demotion is {@link AdditiveTriageDecision}. This change exists so the model is not fighting the
 * guard on every low-star review — not because the guard needs help.
 *
 * <p>The v1 text is not kept beside this one. It is in git history at the commit the change log's
 * runs 1 and 2 name, which is where any reproduction of those runs would have to start anyway.
 */
public final class TriagePrompt {

    /** Bump on ANY edit to {@link #SYSTEM}, including a rewording. */
    public static final String PROMPT_VERSION = "triage-prompt/v2";

    /**
     * `v1` §2's tie-breakers and §3's vocabularies, stated abstractly.
     *
     * <p>Written in Korean because the reviews are Korean and a rubric translated away from the
     * language its examples live in is a different rubric. The vocabularies are interpolated from
     * the enums rather than typed out, so a code added to {@link TriageReasonCode} cannot be one the
     * model was never told about.
     */
    public static final String SYSTEM = """
            당신은 한국 이커머스 판매자의 상품평을 분류합니다.

            판단할 질문은 하나입니다: **판매자가 이 리뷰에 대해 무언가 해야 하는가?**

            분류(tier):
            - NEEDS_ATTENTION — 판매자가 지금 답변하거나, 확인하거나, 고쳐야 할 근거가 본문에 있다.
            - WATCH — 이 리뷰 하나로 할 일은 없지만, 반복되면 문제가 되는 종류다.
            - FYI — 판매자가 할 일이 없다.

            판단은 두 단계입니다. **1단계에서 NEEDS_ATTENTION이 되면 2단계는 그것을 내릴 수 없습니다.**

            [1단계] 아래 중 하나라도 해당하면 즉시 NEEDS_ATTENTION이며, 여기서 판단이 끝납니다.
            A. 1~2점이고 본문에 내용이 있다. (요구가 없어도, 단순한 아쉬움이어도 NEEDS_ATTENTION이다)
            B. 만족한다고 말하면서도 구체적인 문제를 하나라도 짚었다. 5점이어도 NEEDS_ATTENTION이다.
            C. 택배·배송 사고에 대한 불만이다. 판매자 책임이 아니어도 NEEDS_ATTENTION이다.
            D. 하자·파손·오배송·누락·설치 불가·설명과 다름 중 하나가 언급되었다.
            E. 교환·환불·재발송·답변을 요구했다.

            [2단계] 1단계에 해당하지 않을 때만 적용합니다.
            F. 여러 내용이 섞여 있으면, 조치할 내용이 하나라도 있으면 전체를 NEEDS_ATTENTION으로 본다.
            G. 3점인데 본문에 조치할 내용이 없으면 WATCH다. 3점은 신호이므로 FYI까지 내리지 않는다.
            H. 아쉬움만 말하고 요구가 없는 제품 비평은 NEEDS_ATTENTION이 아니다.
            I. 낮은 별점인데 본문이 비어 있거나 의미가 없으면 NEEDS_ATTENTION이 아니다.
               (본문에 내용이 있으면 A가 이미 적용되었으므로 이 항목은 해당되지 않습니다)

            주의: H는 3점 이상에만 적용됩니다. 1~2점이면 A가 우선하며, 요구가 없다는 이유로
            NEEDS_ATTENTION을 WATCH로 낮추지 마십시오.

            reasonCode는 tier를 결정하지 않습니다. tier를 먼저 정하고, 그 다음에 본문을 가장 잘
            설명하는 reasonCode를 고르십시오. CRITIQUE_NO_REQUEST를 골랐다는 이유로 tier를 낮추지
            마십시오.

            별점은 참고 신호일 뿐이며 본문이 우선입니다. 별점만 보고 판단하지 마십시오.

            reasonCode는 다음 중 하나만 사용합니다:
            %s

            tags는 다음 중 0~2개만 사용합니다(가장 중요한 것을 먼저):
            %s

            suggestedNextAction은 다음 중 하나만 사용합니다:
            %s

            반드시 아래 JSON 객체 하나만 출력하십시오. 설명, 주석, 코드펜스를 붙이지 마십시오.
            {"tier":"...","reasonCode":"...","tags":[...],"suggestedNextAction":"..."}
            """.formatted(
            java.util.Arrays.stream(TriageReasonCode.values()).map(Enum::name)
                    .collect(Collectors.joining(", ")),
            String.join(", ", ItemAnalysisCategories.ORDERED),
            java.util.Arrays.stream(TriageSuggestedAction.values()).map(Enum::name)
                    .collect(Collectors.joining(", ")));

    /**
     * The user turn: the star rating and the body, and nothing else.
     *
     * <p>RUBRIC v2 §8.3's payload floor, at the last point before it becomes bytes. The labels are
     * fixed Korean words rather than interpolated field names so that no caller-supplied string can
     * reach the prompt except the body itself.
     */
    public static String userTurn(Integer rating, String body) {
        return "별점: " + (rating == null ? "없음" : rating + "점")
                + "\n본문:\n" + (body == null ? "" : body);
    }

    /**
     * SHA-256 of the system prompt, stored on every prediction.
     *
     * <p>The hash rather than the prompt: the text lives in this file under a version, and copying
     * it into every prediction row would be a large duplicate that could still drift from the
     * version string beside it. A hash cannot drift.
     */
    public static String promptHash() {
        try {
            byte[] digest = MessageDigest.getInstance("SHA-256")
                    .digest(SYSTEM.getBytes(StandardCharsets.UTF_8));
            StringBuilder hex = new StringBuilder(64);
            for (byte b : digest) {
                hex.append(String.format("%02x", b));
            }
            return hex.toString();
        } catch (NoSuchAlgorithmException e) {
            throw new IllegalStateException("SHA-256 is required by the JDK", e);
        }
    }

    private TriagePrompt() {
    }
}
