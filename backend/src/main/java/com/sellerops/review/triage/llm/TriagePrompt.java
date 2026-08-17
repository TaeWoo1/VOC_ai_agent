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
 * <p>v2 replaced the flat list with two stages, where stage 1 is terminal. It worked: across three
 * holdout passes and a 220-row pass the model raw-demoted a baseline positive <b>zero</b> times.
 *
 * <h2>v3 — the axis, after candidate B was rejected on precision</h2>
 *
 * <p>v2's stage 1 fixed the precedence and then <b>enumerated four §3.1 reason codes as tier-forcing
 * conditions</b>, in the same prompt that told the model a reason code does not decide a tier. The
 * freeze recorded that as an accepted risk; RUBRIC v2 §8.11 now forbids it outright, because the
 * gate it was accepted under did not hold.
 *
 * <p>The item that cost the most was v2's B — <i>"satisfied but pointed at one concrete problem →
 * NEEDS_ATTENTION, even at 5★"</i>. It is broader than the rubric it came from, and it promotes
 * every praise-plus-gripe review. `v1` §2 does not split on praise and does not split on whether a
 * request was made:
 *
 * <pre>
 *   "예쁜데 배송이 너무 늦었어요"  → NEEDS_LOOK    something went wrong fulfilling this order
 *   "생각보다 두꺼워요"            → NO_ACTION     an opinion about what the product is
 * </pre>
 *
 * <p>Both praise-free of a request; one praises. What separates them is <b>what the complaint is
 * about.</b> v3 asks that question first and asks nothing else in stage 1, and gives the gripe a
 * legitimate home in {@code WATCH} instead of forcing a choice between {@code NEEDS_ATTENTION} and
 * {@code FYI}.
 *
 * <p>Both illustrations above are `v1` §2's own invented rows, written before this corpus was drawn.
 * §8.11 permits them by name and forbids anything else: <b>no review, phrase or row from the corpus
 * appears here</b>, and no wording in this file was chosen because a particular row would flip.
 *
 * <p><b>This is a prompt fix, and a prompt is a request.</b> The thing that actually forbids a
 * demotion is {@link AdditiveTriageDecision}. Stage 1 item 3 restates the low-star floor for the
 * same reason v2 did — so the model is not fighting the guard on every low-star review — and the
 * guard remains what enforces it.
 *
 * <p>Earlier prompt texts are not kept beside this one. They are in git history at the commits the
 * §8.6 change log names, which is where any reproduction of those runs would have to start anyway.
 */
public final class TriagePrompt {

    /** Bump on ANY edit to {@link #SYSTEM}, including a rewording. */
    public static final String PROMPT_VERSION = "triage-prompt/v3";

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

            순서를 지키십시오. **먼저 tier를 정하고, 그 다음에 나머지 필드를 붙입니다.**
            reasonCode·tags·suggestedNextAction은 이미 정해진 tier에 이름을 붙이는 것일 뿐이며,
            tier를 올리거나 내리지 못합니다. 1단계에서는 reasonCode를 생각하지 마십시오.

            ──── 1단계 · tier를 정한다 ────

            물어야 할 것은 "불만이 있는가"가 아니라 **"이 주문에서 무언가 잘못되었는가"**입니다.
            칭찬이 함께 있는지, 요구가 있는지는 이 질문에 답하지 않습니다.

            (가) 아래 중 하나라도 해당하면 NEEDS_ATTENTION이며, 여기서 판단이 끝납니다.

              1. 이 주문을 이행하는 과정에서 잘못된 일이 있었다.
                 배송 지연·분실·파손, 택배 기사 응대, 하자·고장, 오배송·누락·수량 부족,
                 포장 훼손, 설명이나 사진과 다름, 설치나 사용이 되지 않음.
                 칭찬과 함께 적혀 있어도, 별점이 5점이어도, 아무 요구가 없어도 해당됩니다.
                 택배사 잘못이어도 판매자가 답할 일이므로 해당됩니다.

              2. 교환·환불·재발송·답변·확인을 요구했다.

              3. 별점이 1~2점이고 본문에 읽을 내용이 있다.

            (나) (가)에 해당하지 않으면 NEEDS_ATTENTION이 아닙니다.

              잘못된 일도 없고 요구도 없다면, 남은 것은 이 상품이 원래 어떤 물건인지에 대한
              의견입니다. 두께감·크기감·색감·재질·향·맛·가격 대비 느낌에 대한 아쉬움은,
              아무리 구체적이고 아무리 부정적이어도 NEEDS_ATTENTION이 아닙니다.
              판매자가 지금 확인하거나 고칠 대상이 없기 때문입니다.

              헷갈릴 때 기준은 하나입니다.
                "예쁜데 배송이 너무 늦었어요"  → 배송이 잘못됨   → (가)1 → NEEDS_ATTENTION
                "생각보다 두꺼워요"            → 잘못된 것 없음   → (나)
              두 문장은 칭찬 여부도 요구 여부도 다르지 않습니다.
              갈리는 것은 **무엇에 대한 말인가**입니다.

              (나) 안에서만 다음을 고릅니다.
              - WATCH — 하나로는 할 일이 없지만 반복되면 문제가 될 종류의 아쉬움.
                        별점이 3점인데 조치할 내용이 없으면 WATCH입니다.
                        낮은 별점인데 본문이 비어 있거나 의미가 없으면 WATCH입니다.
              - FYI   — 칭찬뿐이거나, 상품과 무관하거나, 판매자가 알 필요가 없는 내용.

              WATCH와 FYI는 둘 다 "지금 할 일 없음"입니다. 둘 중 무엇을 고를지 고민하다가
              NEEDS_ATTENTION을 다시 꺼내지 마십시오. 그 판단은 (가)에서 이미 끝났습니다.

            별점은 (가)3 외에는 참고 신호일 뿐이며 본문이 우선입니다.

            ──── 2단계 · 정해진 tier에 이름을 붙인다 ────

            tier는 더 이상 바뀌지 않습니다. 아래는 그 tier를 설명하는 이름일 뿐입니다.
            어떤 reasonCode가 어울린다는 이유로 tier를 다시 고치지 마십시오.

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
