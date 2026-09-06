/**
 * Where a conversation lives between turns — three stores behind one interface, chosen the same way
 * the run stores are (`http/runStoreProvider.ts`): backend-owned in production, file or memory locally.
 *
 * <b>What is stored is the persistable form and nothing else.</b> `persistableTurn` has already
 * stripped every transient field (a review preview, an inquiry title, a draft body, the full operator
 * answer) before a view reaches `save`; the stores never see them. A store that received a customer
 * sentence would be a store that could leak one, so the boundary is upstream of every store.
 *
 * <b>The backend store has no list call, so the list is an index snapshot.</b> One row under the
 * reserved thread id `conversation-index` carries the most recent ids (bounded), and `list` reads
 * those rows back one by one. Bounded on purpose: a seller's 「지난 대화」 is a short list, and an
 * unbounded index would be a second, growing copy of every conversation's identity.
 */
import { existsSync, mkdirSync, readdirSync, readFileSync, rmSync, statSync, writeFileSync } from "node:fs";
import { join } from "node:path";
import type { AgentRunStateClient } from "../spring/AgentRunStateClient";
import { StaleRunVersionError } from "../spring/AgentRunStateClient";
import { boundedTurns } from "./contract";
import type { ConversationSummary, ConversationView, TurnView } from "./contract";

export interface ConversationStore {
  load(id: string): Promise<ConversationView | null>;
  save(view: ConversationView): Promise<void>;
  list(limit: number): Promise<ConversationSummary[]>;
}

export const CONVERSATION_DOMAIN = "CONVERSATION";
const INDEX_THREAD = "conversation-index";
const INDEX_MAX = 50;

export function summaryOf(view: ConversationView): ConversationSummary {
  const first = view.turns.find((t) => t.role === "USER" && typeof t.text === "string" && t.text.length > 0);
  const headline = first?.text ? first.text.slice(0, 80) : null;
  return {
    conversationId: view.conversationId,
    createdAt: view.createdAt,
    updatedAt: view.updatedAt,
    turnCount: view.turns.length,
    headline,
  };
}

function storageStatus(view: ConversationView): "OPEN" | "WAITING_HUMAN" {
  return view.pendingHumanAction ? "WAITING_HUMAN" : "OPEN";
}

function byUpdated(a: ConversationSummary, b: ConversationSummary): number {
  return b.updatedAt.localeCompare(a.updatedAt);
}

export class MemoryConversationStore implements ConversationStore {
  private readonly byId = new Map<string, ConversationView>();

  async load(id: string): Promise<ConversationView | null> {
    return this.byId.get(id) ?? null;
  }
  async save(view: ConversationView): Promise<void> {
    this.byId.set(view.conversationId, view);
  }
  async list(limit: number): Promise<ConversationSummary[]> {
    return [...this.byId.values()].map(summaryOf).sort(byUpdated).slice(0, limit);
  }
}

export class FileConversationStore implements ConversationStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(id: string): string {
    return join(this.dir, `${id.replace(/[^a-zA-Z0-9._-]/g, "_")}.json`);
  }

  async load(id: string): Promise<ConversationView | null> {
    const p = this.path(id);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as ConversationView;
  }
  async save(view: ConversationView): Promise<void> {
    writeFileSync(this.path(view.conversationId), JSON.stringify(view, null, 2), "utf8");
  }
  async list(limit: number): Promise<ConversationSummary[]> {
    const rows: ConversationSummary[] = [];
    for (const entry of readdirSync(this.dir)) {
      const full = join(this.dir, entry);
      if (!entry.endsWith(".json") || !statSync(full).isFile()) continue;
      try {
        rows.push(summaryOf(JSON.parse(readFileSync(full, "utf8")) as ConversationView));
      } catch {
        // An unreadable file is not a conversation. Left in place; never deleted by a list.
      }
    }
    return rows.sort(byUpdated).slice(0, limit);
  }
  /** Test helper. */
  async delete(id: string): Promise<void> {
    const p = this.path(id);
    if (existsSync(p)) rmSync(p);
  }
}

export class SpringConversationStore implements ConversationStore {
  constructor(private readonly client: AgentRunStateClient) {}

  async load(id: string): Promise<ConversationView | null> {
    const record = await this.client.get(id);
    if (!record || record.domain !== CONVERSATION_DOMAIN) return null;
    return record.snapshot as ConversationView;
  }

  /**
   * <b>Save, and lose no turn to a concurrent one</b> (Agent Runtime Production Closure v1 §2).
   *
   * Nothing serialises two turns of one conversation — not in this process, and by construction not
   * across replicas. The row has an optimistic-lock version, but <b>this store defeats it</b>: the read
   * that teaches the client the current version happens inside the save, so the write that follows is
   * conditional on a version one round-trip old. A turn built on a view someone else has since added to
   * would therefore have OVERWRITTEN them, silently, without ever seeing a 409.
   *
   * So the merge is not the 409 handler — it is the ordinary path. The read this save needs anyway is
   * also the read that says what is currently stored, and a transcript is append-only, so keeping both
   * is unambiguous: their turns stay, ours follow, identity is the turn id, and the bound is the one
   * `persistableTurn` already applies. When the transcript has not moved, the merge is the identity and
   * the write is byte-for-byte what it was before.
   *
   * The continuation fields (working set, pending action, active task) are last-write-wins, which is
   * what two turns arriving in either order would have produced anyway. A genuinely lost guarded write
   * is retried ONCE against a fresh read; a second loss is sustained contention, and a write loop is
   * worse than a failed turn.
   */
  async save(view: ConversationView): Promise<void> {
    const stored = await this.load(view.conversationId);
    try {
      await this.put(stored ? mergeTurns(stored, view) : view);
    } catch (err) {
      if (!(err instanceof StaleRunVersionError)) throw err;
      const current = await this.load(view.conversationId);
      await this.put(current ? mergeTurns(current, view) : view);
    }
    await this.touchIndex(view.conversationId);
  }

  private async put(view: ConversationView): Promise<void> {
    await this.client.put({
      threadId: view.conversationId, domain: CONVERSATION_DOMAIN, status: storageStatus(view), snapshot: view,
    });
  }

  async list(limit: number): Promise<ConversationSummary[]> {
    const ids = await this.readIndex();
    const rows: ConversationSummary[] = [];
    for (const id of ids.slice(0, Math.max(limit, 0))) {
      const view = await this.load(id);
      if (view) rows.push(summaryOf(view));
    }
    return rows.sort(byUpdated).slice(0, limit);
  }

  private async readIndex(): Promise<string[]> {
    const record = await this.client.get(INDEX_THREAD);
    if (!record || record.domain !== CONVERSATION_DOMAIN) return [];
    const snapshot = record.snapshot as { ids?: unknown } | null;
    return Array.isArray(snapshot?.ids) ? snapshot!.ids.filter((v): v is string => typeof v === "string") : [];
  }

  /**
   * <b>The index is a convenience, and it must never fail a saved turn.</b>
   *
   * One row per ORG holds it, so ANY two conversations saving at the same moment contend for it — far
   * likelier than two turns of one conversation. Before this, that collision threw after the
   * conversation itself had already been written: the seller's answer was safely stored and their turn
   * failed anyway. A lost touch costs a place in 「지난 대화」 until the next save, which is the smaller
   * of the two wrongs.
   */
  private async touchIndex(id: string): Promise<void> {
    try {
      const ids = [id, ...(await this.readIndex()).filter((v) => v !== id)].slice(0, INDEX_MAX);
      await this.client.put({ threadId: INDEX_THREAD, domain: CONVERSATION_DOMAIN, status: "OPEN", snapshot: { ids } });
    } catch (err) {
      if (!(err instanceof StaleRunVersionError)) throw err;
    }
  }
}

/**
 * The stored conversation plus whatever this save adds — turns by identity, continuation from the
 * newer write. Used only on a lost optimistic write; a transcript is append-only, so no turn that
 * exists on either side is dropped.
 */
function mergeTurns(stored: ConversationView, incoming: ConversationView): ConversationView {
  const seen = new Set(stored.turns.map((t: TurnView) => t.turnId));
  return {
    ...incoming,
    turns: boundedTurns([...stored.turns, ...incoming.turns.filter((t) => !seen.has(t.turnId))]),
  };
}
