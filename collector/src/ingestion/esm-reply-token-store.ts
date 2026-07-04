/**
 * **Encrypted reply-token store seam** (pure, offline) — keyed by `connectionId + sellerId + messageNo`.
 *
 * The ESM Trading CS reply token is a per-inquiry, secret-adjacent value the Cloud API executor needs at
 * reply time. It is stored HERE, scoped to a single (tenant connection × seller × inquiry), and NEVER placed
 * in an ingestion envelope, WorkItem, log, or audit. The production store is **encrypted at rest** behind
 * this seam; {@link InMemoryEsmReplyTokenStore} is the offline test/dev implementation only.
 *
 * The key namespaces by BOTH `connectionId` and `sellerId`, so one tenant can never read another tenant's
 * token — even for the same `messageNo`. No HTTP, no filesystem, no wall clock.
 */

/** The store key: one tenant connection × seller × one inquiry message. */
export interface EsmReplyTokenKey {
  connectionId: string;
  sellerId: string;
  messageNo: string;
}

/** Canonical, length-delimited (netstring) key over (connectionId, sellerId, messageNo). */
export function replyTokenKey(key: EsmReplyTokenKey): string {
  return [key.connectionId, key.sellerId, key.messageNo].map((v) => `${v.length}:${v},`).join("");
}

/**
 * The reply-token store seam. Production encrypts at rest; this repo ships only the seam + an in-memory fake.
 * Values are opaque tokens — the store is the ONLY place a reply token lives.
 */
export interface EsmReplyTokenStore {
  put(key: EsmReplyTokenKey, token: string): Promise<void>;
  get(key: EsmReplyTokenKey): Promise<string | null>;
}

/** Offline in-memory store — for tests/dev only. NOT encrypted; the production seam impl is separate. */
export class InMemoryEsmReplyTokenStore implements EsmReplyTokenStore {
  private readonly tokens = new Map<string, string>();

  async put(key: EsmReplyTokenKey, token: string): Promise<void> {
    this.tokens.set(replyTokenKey(key), token);
  }

  async get(key: EsmReplyTokenKey): Promise<string | null> {
    return this.tokens.get(replyTokenKey(key)) ?? null;
  }
}
