package com.sellerops.attention.reply;

import java.util.UUID;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.stereotype.Component;

/**
 * Deterministic, keyword-and-rating review reply suggester — the rule baseline, NOT AI and
 * not coupled to the item-analysis subsystem (it shares no code or storage with it). Its
 * output derives only from the review's redacted body and its own star rating.
 *
 * <p>Provenance is honest: {@code providerKind=RULE_BASED}. A future AI adapter implementing
 * {@link ReviewReplyProposalProvider} would report its own kind/name/version and would be
 * selected by the same flag this bean is gated on.
 *
 * <p><b>Rating decides first, keywords second — reversed for one commit, then measured back.</b>
 * A rating of {@value #POSITIVE_MIN_RATING} or above takes {@link ReviewReplyTemplateKey#POSITIVE}
 * whatever words appear. On 2026-09-03 that was flipped so a named issue would outrank the star,
 * because a ★4 review that plainly describes a problem should not be answered as praise. Run against
 * this repository's real NAVER corpus (4,455 rows) the flip moved <b>1,153</b> reviews off the
 * rating template and <b>1,098 of them were ★5</b> — 「배송 빨라요」 redirected into an apology for
 * late delivery, in public, against the 55 complaints it was meant to catch. It was reverted.
 *
 * <p><b>The reason is structural, and it is the thing to remember: these keywords detect a TOPIC,
 * not a polarity.</b> 「배송 빨라요」 and 「배송 늦어요」 are the same word to this table. Until
 * something can tell them apart, a topic word must not outrank a star — and adding a sentiment
 * heuristic here would be the AI this provider is defined as not being.
 *
 * <p>So the ★4 complaint the words cannot see is answered with a NEUTRAL default and the seller's
 * own edit, not with a confident apology to everyone who mentioned 배송. That is why
 * {@link ReviewReplyTemplateKey#POSITIVE}'s wording thanks the customer and asserts nothing about
 * how pleased they were, and why {@link ReviewReplyTemplateService} exists: reviewnary's defaults
 * are the fallback, and the company's own wording is the answer.
 *
 * <p>An unrated review (null rating — the source carried none) takes the keyword path: with no
 * rating there is no evidence of praise, and the keywords are the only signal there is.
 *
 * <p><b>The choice moved out; the decision did not</b> (Review Reply Template Settings v1). The
 * categories, keywords, order and shipped wording now live in {@link ReviewReplyTemplateKey}, and
 * {@link ReviewReplyTemplateService} answers with an organization's own text where it has one. What
 * this class decides — rating first, then keywords in order, then the fallback — is unchanged, and an
 * org with no settings gets the same bytes it got before the table existed.
 *
 * <p><b>A template is a whole reply, never a slot for a fact.</b> The seller supplies wording; nothing
 * here retrieves a product detail, a policy, a cause or a remedy to splice into it, and the defaults
 * promise no refund, exchange, discount or delivery date — a rule engine cannot know whether the
 * seller intends any of those, and a promise the seller has not agreed to is the one output here that
 * could do real damage once it is public. None of them blames the customer. The operator supplies
 * every specific.
 */
@Component
@ConditionalOnProperty(name = "sellerops.reply.review.provider", havingValue = "rule_based",
        matchIfMissing = true)
public class RuleBasedReviewReplyProvider implements ReviewReplyProposalProvider {

    static final String KIND = "RULE_BASED";
    static final String NAME = "review-reply-template";
    static final String VERSION = "templates-v1";

    /**
     * Reported instead of {@link #VERSION} when the body came from the organization's own settings.
     * Provenance only: it travels in the suggestion view, is never persisted, and binds nothing — the
     * draft's version, fingerprint and approval contract are untouched by it.
     */
    static final String ORG_VERSION = "templates-v1+org";

    /** At or above this rating a review reads as praise; below it, the keywords decide. */
    static final int POSITIVE_MIN_RATING = 4;

    static final String POSITIVE_CATEGORY = "positive_reply";
    static final String DEFAULT_CATEGORY = "general_reply";

    /**
     * Optional on purpose. Resolved lazily so this provider is constructible — and byte-identical to
     * the wording it shipped with — in a context that has no template storage at all, which is what
     * {@code RuleBasedReviewReplyProviderTest}'s bean-condition assertions run in.
     */
    private final ObjectProvider<ReviewReplyTemplateService> templates;

    @Autowired
    public RuleBasedReviewReplyProvider(ObjectProvider<ReviewReplyTemplateService> templates) {
        this.templates = templates;
    }

    /** Defaults only — no org settings are reachable. Used where no template storage is wired. */
    public RuleBasedReviewReplyProvider() {
        this(null);
    }

    @Override
    public Suggestion suggest(ReviewReplyContext context) {
        return suggestion(context.orgId(), keyFor(context));
    }

    /**
     * Which template this review takes. Rating first, then the keyword members in their declared
     * order, then the fallback — the selection this class has made since it was written, and the one
     * the 2026-09-03 measurement restored.
     */
    public static ReviewReplyTemplateKey keyFor(ReviewReplyContext context) {
        Integer rating = context.rating();
        if (rating != null && rating >= POSITIVE_MIN_RATING) {
            return ReviewReplyTemplateKey.POSITIVE;
        }
        String haystack = context.redactedBody() == null ? "" : context.redactedBody();
        for (ReviewReplyTemplateKey key : ReviewReplyTemplateKey.KEYWORD_ORDER) {
            for (String keyword : key.keywords()) {
                if (haystack.contains(keyword)) {
                    return key;
                }
            }
        }
        return ReviewReplyTemplateKey.GENERAL;
    }

    private Suggestion suggestion(UUID orgId, ReviewReplyTemplateKey key) {
        ReviewReplyTemplateService service = templates == null ? null : templates.getIfAvailable();
        if (service == null || orgId == null) {
            return new Suggestion(key.defaultBody(), key.category(), KIND, NAME, VERSION);
        }
        // Provenance is the ROW, not a string comparison: a company may save wording identical to the
        // shipped default, and reporting that as reviewnary's own would be wrong about where it came
        // from. One read answers both questions.
        ReviewReplyTemplateService.Resolved resolved = service.resolve(orgId, key);
        return new Suggestion(resolved.body(), key.category(), KIND, NAME,
                resolved.customized() ? ORG_VERSION : VERSION);
    }
}
