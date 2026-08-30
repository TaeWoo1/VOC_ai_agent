/**
 * Knowledge Capture v1 — the ONE place the conversation lane writes a captured fact.
 *
 * The write goes through the seller's own knowledge seams (`POST /api/org-knowledge/sources`,
 * `POST /api/products/{id}/knowledge/sources`) — the same requests the settings and product screens
 * make, so provenance is `SELLER_ENTERED_KNOWLEDGE` by construction and no second repository exists.
 * `conversationWriteFence.test.ts` pins this file as the only caller of the two `create*` methods.
 *
 * It is called only after a fingerprint-bound 「저장하고 계속」 and it writes exactly the candidate that
 * fingerprint names. It never resumes anything itself; the service does, once.
 */
import type { SpringClient } from "../spring/SpringClient";
import type { PendingKnowledgeCapture } from "./contract";

export type KnowledgeWriteClient = Pick<SpringClient, "createOrgKnowledge" | "createProductKnowledgeSource">;

export class KnowledgeCaptureWriter {
  constructor(private readonly client: KnowledgeWriteClient) {}

  async write(pending: PendingKnowledgeCapture): Promise<{ readonly id: string }> {
    const candidate = pending.candidate;
    if (!candidate) throw new Error("no candidate to write");
    if (pending.scope === "ORG") {
      const saved = await this.client.createOrgKnowledge({ knowledgeType: pending.knowledgeType, title: candidate.title, body: candidate.content, sourceUrl: null });
      return { id: saved.id };
    }
    if (!pending.productId) throw new Error("a product fact needs its product");
    const saved = await this.client.createProductKnowledgeSource(pending.productId, {
      sourceType: pending.knowledgeType === "POLICY" ? "POLICY" : "DESCRIPTION",
      title: candidate.title, body: candidate.content, sourceUrl: null, variantId: pending.variantId,
    });
    return { id: saved.id };
  }
}
