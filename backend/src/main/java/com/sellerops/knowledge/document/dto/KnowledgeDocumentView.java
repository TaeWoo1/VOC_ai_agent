package com.sellerops.knowledge.document.dto;

import java.time.Instant;
import java.util.UUID;

/**
 * One piece of material the seller handed over, as they see it on the 자료 list.
 *
 * <p>Three questions and no more, because those are the three a person can answer about a file: what
 * is it, where does it apply, is it current. {@code passages} is here for one honest reason — a
 * document that produced no passages cannot ground anything, and a list that showed it as normal would
 * be hiding that — but it is a count, not an invitation to review chunks.
 *
 * @param sourceId    the knowledge source this document became; what retire/restore addresses
 * @param scope       {@code PRODUCT} or {@code ORG}
 * @param productName the product's display name, or null for an org-wide document
 * @param fileName    the file the seller uploaded, verbatim — the provenance a citation can print
 * @param kind        the source/knowledge type this was filed under
 * @param active      whether it still grounds new answers
 */
public record KnowledgeDocumentView(UUID sourceId, String scope, UUID productId, String productName,
                                    String fileName, String title, String kind, boolean active,
                                    int passages, String uploadedBy, Instant uploadedAt) {
}
