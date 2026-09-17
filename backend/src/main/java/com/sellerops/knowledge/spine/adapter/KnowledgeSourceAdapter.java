package com.sellerops.knowledge.spine.adapter;

import com.sellerops.knowledge.spine.KnowledgeEntry;
import java.util.List;
import java.util.UUID;

/**
 * <b>One raw source, read as company knowledge.</b>
 *
 * <p>The contract every adapter keeps, and the one {@code KnowledgeSpineTest} checks against all of them:
 * <ul>
 *   <li>It reads rows of {@code orgId} and no other organisation.</li>
 *   <li>With {@code productId == null} it returns ORG-scope entries only.</li>
 *   <li>With a product it returns ORG-scope entries plus that product's PRODUCT-scope entries — never a row bound
 *       to another product. The caller has already proved the product belongs to the organisation.</li>
 *   <li>It writes nothing, calls no model and reaches no marketplace.</li>
 * </ul>
 */
public interface KnowledgeSourceAdapter {

    List<Indexed> read(UUID orgId, UUID productId);

    /**
     * An entry plus what it is matched on.
     *
     * <p>{@code searchable} is already {@code KnowledgeText.normalize}d, and it may hold more than the entry shows:
     * a remembered answer is matched on the topic signature of the question it answered, and a review decision on
     * the review it was about. That text is used to find the entry and then dropped — it is never returned.
     */
    record Indexed(KnowledgeEntry entry, String searchable) {
    }
}
