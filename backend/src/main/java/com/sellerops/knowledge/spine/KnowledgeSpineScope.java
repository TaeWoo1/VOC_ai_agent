package com.sellerops.knowledge.spine;

/**
 * <b>Where a piece of knowledge holds.</b>
 *
 * <p>Two values, because the raw sources today carry two: the company, and one product. A CHANNEL scope is not
 * declared until a source states something true of one channel only — an entry still records the channel it
 * came from ({@link KnowledgeEntry#channelCode()}), and that is a fact about origin, not a narrower scope.
 *
 * <p><b>The fence.</b> A query about product A reads ORG entries and A's PRODUCT entries, and nothing bound to
 * any other product. A past answer whose product was never known is ORG — it never named a product it could be
 * wrong about — the same rule {@code AnswerMemoryService} already applies.
 */
public enum KnowledgeSpineScope {
    ORG,
    PRODUCT
}
