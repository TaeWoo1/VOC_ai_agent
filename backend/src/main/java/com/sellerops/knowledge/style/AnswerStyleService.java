package com.sellerops.knowledge.style;

import com.sellerops.common.ApiException;
import com.sellerops.knowledge.style.dto.AnswerStyleRequest;
import com.sellerops.knowledge.style.dto.AnswerStyleView;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.UUID;
import org.springframework.stereotype.Service;
import org.springframework.transaction.annotation.Transactional;

/**
 * Read and write one organization's answer style.
 *
 * <p><b>The safety floor is enforced HERE, at write time.</b> {@link AnswerStyleSafetyFloor} was
 * written a package ago and had zero callers by design; this service is the one it was waiting for.
 * Checking on save means the seller is told which phrase was refused and why, while checking at
 * prompt time would mean a setting that appears saved and quietly does nothing — and a switch that
 * flips nothing is worse than one that refuses.
 *
 * <p><b>Required phrases get a second gate the other fields do not.</b> 「꼭 포함할 표현」 is an
 * instruction to put a sentence in EVERY reply, so a sentence that asserts a fact is refused there
 * even though the same words would be fine as a closing: see {@link StylePhrases#assertsFact}. The
 * seller is pointed at 운영 정책, which is where a delivery or refund term is evidence and therefore
 * subject to grounding.
 *
 * <p><b>Nothing here learns.</b> No past answer, no Answer Memory row and no draft is read by this
 * class; a style exists because a person typed it into a form. {@code AnswerStyleFenceTest} asserts
 * that by name.
 */
@Service
public class AnswerStyleService {

    /** Field caps. Short by intention — these are greetings, not paragraphs. */
    static final int MAX_GREETING = 60;
    static final int MAX_CLOSING = 60;
    static final int MAX_ADDRESS = 20;
    static final int MAX_FALLBACK = 300;

    private final OrganizationAnswerStyleRepository styles;

    public AnswerStyleService(OrganizationAnswerStyleRepository styles) {
        this.styles = styles;
    }

    /**
     * The style that applies to this org — always an answer, never an empty Optional.
     *
     * <p>An org with no row is not a broken org; it is the majority of them, and it gets
     * {@link AnswerStyleProfile#defaults()}, which is the wording this product shipped with.
     */
    @Transactional(readOnly = true)
    public AnswerStyleProfile profileFor(UUID orgId) {
        return styles.findById(orgId).map(OrganizationAnswerStyle::toProfile)
                .orElseGet(AnswerStyleProfile::defaults);
    }

    @Transactional(readOnly = true)
    public AnswerStyleView view(UUID orgId) {
        return AnswerStyleView.of(profileFor(orgId));
    }

    /**
     * Save the whole form. Creates the row on first save; bumps {@code version} on every one.
     *
     * <p>The version is what a draft's provenance records, so it advances even for a save that
     * changes nothing — 「누가 언제 저장했는가」 is part of the audit, and a version that only moved on
     * a detected difference would make two drafts with the same identity readable as the same
     * wording when one of them predated a save nobody can now see.
     */
    @Transactional
    public AnswerStyleView save(UUID orgId, AnswerStyleRequest request, UUID actorUserId) {
        AnswerStyleRequest form = request == null
                ? new AnswerStyleRequest(null, null, null, null, null, null, null, null, null)
                : request;

        String greeting = StylePhrases.line("첫 인사", form.greeting(), MAX_GREETING);
        String closing = StylePhrases.line("끝 인사", form.closing(), MAX_CLOSING);
        String address = StylePhrases.line("고객 호칭", form.customerAddress(), MAX_ADDRESS);
        String fallback = StylePhrases.text("답을 모를 때 사용할 문구", form.unknownFallbackTemplate(),
                MAX_FALLBACK);
        List<String> required = StylePhrases.validate("꼭 포함할 표현", form.requiredPhrases(),
                StylePhrases.MAX_REQUIRED);
        List<String> forbidden = StylePhrases.validate("사용하지 않을 표현", form.forbiddenPhrases(),
                StylePhrases.MAX_FORBIDDEN);

        refuseFactualRequirements(required);
        refuseUnsafe(greeting, closing, address, fallback, required, forbidden);

        OrganizationAnswerStyle row = styles.findById(orgId).orElseGet(() -> {
            OrganizationAnswerStyle fresh = new OrganizationAnswerStyle();
            fresh.setOrgId(orgId);
            fresh.setVersion(0);
            return fresh;
        });
        row.setTone(form.tone() == null ? AnswerTone.POLITE : form.tone());
        row.setLengthPreference(form.lengthPreference() == null
                ? AnswerLength.NORMAL : form.lengthPreference());
        row.setEmojiPolicy(form.emojiPolicy() == null ? EmojiPolicy.NONE : form.emojiPolicy());
        row.setGreeting(greeting);
        row.setClosing(closing);
        row.setCustomerAddress(address);
        row.setRequiredPhrases(StylePhrases.format(required));
        row.setForbiddenPhrases(StylePhrases.format(forbidden));
        row.setUnknownFallback(fallback);
        row.setVersion(row.getVersion() + 1);
        row.setUpdatedBy(actorUserId);
        return AnswerStyleView.of(styles.save(row).toProfile());
    }

    /**
     * A required phrase may describe manner; it may not assert a fact.
     *
     * <p>Refused with the word that made it a claim, so the message is actionable rather than a
     * verdict: a seller told 「'발송' 때문입니다」 can move that sentence to 운영 정책, which is where it
     * becomes evidence a reply may quote when it applies.
     */
    private static void refuseFactualRequirements(List<String> required) {
        List<String> refused = new ArrayList<>();
        for (String phrase : required) {
            String marker = StylePhrases.factMarker(phrase);
            if (marker != null) {
                refused.add("\"" + phrase + "\" (\"" + marker + "\")");
            }
        }
        if (!refused.isEmpty()) {
            throw ApiException.badRequest("「꼭 포함할 표현」에는 사실을 단정하는 문장을 넣을 수 없습니다: "
                    + String.join(", ", refused)
                    + ". 배송·환불·재고처럼 실제 사실에 해당하는 내용은 운영 정책 / 답변 기준에 등록하시면, "
                    + "해당하는 문의에서 근거로 인용됩니다.");
        }
    }

    /** Every seller-typed field, through the floor, reported together. */
    private static void refuseUnsafe(String greeting, String closing, String address, String fallback,
                                     List<String> required, List<String> forbidden) {
        Map<String, String> fields = new LinkedHashMap<>();
        fields.put("첫 인사", greeting);
        fields.put("끝 인사", closing);
        fields.put("고객 호칭", address);
        fields.put("답을 모를 때 사용할 문구", fallback);
        int i = 1;
        for (String phrase : required) {
            fields.put("꼭 포함할 표현 " + i++, phrase);
        }
        i = 1;
        for (String phrase : forbidden) {
            fields.put("사용하지 않을 표현 " + i++, phrase);
        }
        List<AnswerStyleSafetyFloor.Violation> violations = AnswerStyleSafetyFloor.checkAll(fields);
        if (!violations.isEmpty()) {
            throw ApiException.badRequest(violations.stream()
                    .map(AnswerStyleSafetyFloor.Violation::messageKo)
                    .reduce((a, b) -> a + " " + b).orElse("저장할 수 없습니다."));
        }
    }
}
