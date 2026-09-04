package com.sellerops.opportunity;

import com.sellerops.knowledge.KnowledgeText;
import com.sellerops.knowledge.org.OrgKnowledgeSource;
import com.sellerops.knowledge.org.OrgKnowledgeSourceRepository;
import com.sellerops.knowledge.org.OrgKnowledgeType;
import com.sellerops.product.library.ProductKnowledgeSource;
import com.sellerops.product.library.ProductKnowledgeSourceRepository;
import com.sellerops.reviewissue.IssueVocabulary;
import java.util.ArrayList;
import java.util.List;
import java.util.UUID;
import org.springframework.stereotype.Component;
import org.springframework.transaction.annotation.Transactional;

/**
 * Reads the seller's active knowledge and answers {@link KnowledgeMention} for one aspect.
 *
 * <p>Read-only, deterministic, and scoped exactly like the library screens: a product check reads that
 * product's active sources (through the same repository read the library uses, so the data-origin
 * filter applies), an org check reads the company's active rules. Excerpts are the seller's own
 * sentences, bounded.
 */
@Component
public class KnowledgeMentionCheck {

    /** How many of the seller's sentences a draft may carry — a scaffold, not a reprint. */
    static final int EXCERPT_LIMIT = 3;
    static final int EXCERPT_CHARS = 200;

    private final ProductKnowledgeSourceRepository productSources;
    private final OrgKnowledgeSourceRepository orgSources;

    public KnowledgeMentionCheck(ProductKnowledgeSourceRepository productSources,
                                 OrgKnowledgeSourceRepository orgSources) {
        this.productSources = productSources;
        this.orgSources = orgSources;
    }

    @Transactional(readOnly = true)
    public KnowledgeMention product(UUID orgId, UUID productId, String aspect) {
        List<ProductKnowledgeSource> active = productSources
                .findAllByOrgIdAndProductIdOrderByCreatedAtAsc(orgId, productId).stream()
                .filter(ProductKnowledgeSource::isActive)
                .toList();
        List<String> keywords = IssueVocabulary.keywordsOf(aspect);
        int mentions = 0;
        List<String> excerpts = new ArrayList<>();
        for (ProductKnowledgeSource source : active) {
            if (mentions(source.getTitle(), source.getBody(), keywords, excerpts)) {
                mentions++;
            }
        }
        return new KnowledgeMention(active.size(), mentions, List.copyOf(excerpts));
    }

    /**
     * The company's rules, for an ORG-scoped aspect. A rule filed under the aspect's own type counts as
     * a mention even when its body never repeats the word — a seller who titled a rule 「배송」 has
     * written about shipping.
     */
    /**
     * The words a company rule about a topic is written with — beside the extractor's aspect words, so
     * a 교환·반품 rule counts for a 「배송 파손」 issue even though no review said 교환. Closed and small.
     */
    private static final java.util.Map<OrgKnowledgeType, List<String>> TYPE_WORDS = java.util.Map.of(
            OrgKnowledgeType.SHIPPING_POLICY, List.of("배송", "출고", "발송"),
            OrgKnowledgeType.EXCHANGE_REFUND_POLICY, List.of("교환", "반품", "환불"));

    @Transactional(readOnly = true)
    public KnowledgeMention org(UUID orgId, String aspect, OrgKnowledgeType type) {
        List<OrgKnowledgeSource> active = orgSources.findAllByOrgIdOrderByCreatedAtAsc(orgId).stream()
                .filter(OrgKnowledgeSource::isActive)
                .toList();
        List<String> keywords = new ArrayList<>(IssueVocabulary.keywordsOf(aspect));
        if (type != null) {
            keywords.addAll(TYPE_WORDS.getOrDefault(type, List.of()));
        }
        int mentions = 0;
        List<String> excerpts = new ArrayList<>();
        for (OrgKnowledgeSource source : active) {
            boolean typed = type != null && type == source.getKnowledgeType();
            boolean named = mentions(source.getTitle(), source.getBody(), keywords, excerpts);
            if (typed && !named && excerpts.size() < EXCERPT_LIMIT) {
                excerpts.add(bound(firstSentence(source.getBody())));
            }
            if (typed || named) {
                mentions++;
            }
        }
        return new KnowledgeMention(active.size(), mentions, List.copyOf(excerpts));
    }

    /** True when title or body names any keyword; collects the naming sentences while there is room. */
    static boolean mentions(String title, String body, List<String> keywords, List<String> excerpts) {
        if (keywords.isEmpty()) {
            return false;
        }
        String normalizedTitle = KnowledgeText.normalize(title);
        boolean hit = keywords.stream().anyMatch(k -> normalizedTitle.contains(KnowledgeText.normalize(k)));
        for (String sentence : KnowledgeText.sentences(body)) {
            String normalized = KnowledgeText.normalize(sentence);
            if (keywords.stream().anyMatch(k -> normalized.contains(KnowledgeText.normalize(k)))) {
                hit = true;
                if (excerpts.size() < EXCERPT_LIMIT) {
                    excerpts.add(bound(sentence));
                }
            }
        }
        return hit;
    }

    private static String firstSentence(String body) {
        List<String> sentences = KnowledgeText.sentences(body);
        return sentences.isEmpty() ? "" : sentences.get(0);
    }

    private static String bound(String text) {
        String s = text == null ? "" : text.strip();
        return s.length() <= EXCERPT_CHARS ? s : s.substring(0, EXCERPT_CHARS - 1) + "…";
    }
}
