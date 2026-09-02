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
 * <p><b>An issue signal decides first, the rating second — and this was reversed once, on
 * purpose.</b> Until 2026-09-03 the rating won: a review of {@value #POSITIVE_MIN_RATING} stars or
 * more took the positive template whatever words it contained. That protected a 5★ "배송 빨라요"
 * from being answered with an apology, and it cost the case the product is actually for — a 4★
 * review that plainly names a problem was answered with 「좋은 후기를 남겨주셔서 감사합니다」.
 * Product-owner decision (Template Settings v1 closure): the problem outranks the star.
 *
 * <p><b>What that costs, measured rather than guessed.</b> On this repository's real NAVER corpus
 * (4,455 rows) the reversal moves <b>1,153</b> reviews off the positive template, and
 * <b>1,098 of them are 5★</b> — overwhelmingly praise that merely names a topic word, not the 55
 * four-star complaints the change was made for. A keyword list cannot tell 「배송 빨라요」 from
 * 「배송 늦어요」, and this class deliberately does not try: a sentiment classifier here would be
 * the AI this provider is defined as not being.
 *
 * <p>So the lever is the seller's, and it is the one this package built. A company whose reviews
 * are mostly praise sets its 배송 template to wording that reads correctly either way — that is
 * what {@link ReviewReplyTemplateService} is for, and it is why reviewnary's own defaults are a
 * fallback rather than the answer. The operator still edits every draft before it is approved.
 *
 * <p>An unrated review (null rating — the source carried none) reaches the rating step with no
 * evidence of praise and falls to {@link ReviewReplyTemplateKey#GENERAL}.
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
     * Which template this review takes: the keyword members in their declared order, first hit wins;
     * then, only if none matched, the rating; then the fallback.
     *
     * <p>The keyword pass is unchanged from the day it was written — same words, same precedence.
     * All that moved is where the rating is asked, and the class note above says what that costs.
     */
    static ReviewReplyTemplateKey keyFor(ReviewReplyContext context) {
        String haystack = context.redactedBody() == null ? "" : context.redactedBody();
        for (ReviewReplyTemplateKey key : ReviewReplyTemplateKey.KEYWORD_ORDER) {
            for (String keyword : key.keywords()) {
                if (haystack.contains(keyword)) {
                    return key;
                }
            }
        }
        Integer rating = context.rating();
        return rating != null && rating >= POSITIVE_MIN_RATING
                ? ReviewReplyTemplateKey.POSITIVE
                : ReviewReplyTemplateKey.GENERAL;
    }

    private Suggestion suggestion(UUID orgId, ReviewReplyTemplateKey key) {
        ReviewReplyTemplateService service = templates == null ? null : templates.getIfAvailable();
        if (service == null || orgId == null) {
            return new Suggestion(key.defaultBody(), key.category(), KIND, NAME, VERSION);
        }
        String body = service.bodyFor(orgId, key);
        boolean fromOrg = !body.equals(key.defaultBody());
        return new Suggestion(body, key.category(), KIND, NAME, fromOrg ? ORG_VERSION : VERSION);
    }
}
