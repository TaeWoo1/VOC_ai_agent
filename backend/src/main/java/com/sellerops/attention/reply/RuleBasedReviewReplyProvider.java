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
 * <p><b>Rating decides first, keywords second — and the tradeoff is real, so it is stated
 * rather than buried.</b> A 5★ review saying "배송 빨라요" contains a delivery keyword; running
 * keywords first would answer praise with an apology for late delivery, which is worse than
 * useless in a public reply. So a rating of {@value #POSITIVE_MIN_RATING} or above takes the
 * positive template regardless of what words appear. The cost: a 4★ review that praises the
 * product but mentions one late delivery also gets the positive template, and the operator has
 * to add the apology themselves. That is the right side to err on — a suggestion that is
 * merely incomplete is edited in seconds, while one that apologises to a happy customer has to
 * be noticed first, and the operator might not notice.
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
     * order, then the fallback — the selection this class has always made.
     */
    static ReviewReplyTemplateKey keyFor(ReviewReplyContext context) {
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
        String body = service.bodyFor(orgId, key);
        boolean fromOrg = !body.equals(key.defaultBody());
        return new Suggestion(body, key.category(), KIND, NAME, fromOrg ? ORG_VERSION : VERSION);
    }
}
