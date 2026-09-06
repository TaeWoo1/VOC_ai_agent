/**
 * <b>The durable execution cursor — and the list of what it is allowed to be.</b>
 *
 * AOP Execution Closure v1. A procedure can now stop for a person and continue in a different process,
 * so where it stopped has to survive that process. What survives is a CURSOR and nothing else:
 *
 * <pre>
 *   conversationId · procedureId + version · current step · object refs · draftId · approvalId · terminal
 * </pre>
 *
 * <b>Business truth is not here.</b> The draft body, the evidence, the approval record, the seller's
 * knowledge and every marketplace outcome stay in the backend database, which has owned them since
 * before this file existed. A checkpoint that copied one would be a second source of truth that a
 * resume can find disagreeing with the first, with nobody to say which is right — and the cheapest way
 * to guarantee it never happens is for the shape to have nowhere to put it. {@link AopCheckpoint} is
 * that shape: ids, closed tokens and a step name.
 *
 * <b>Why not LangGraph's own checkpointer.</b> `MemorySaver` snapshots the whole graph state, and the
 * repository's neighbouring {@code RunStore} records the reason that is refused here: the graph state
 * of a real turn holds seller-owned content. This store persists the four fields a resume needs and
 * re-reads everything else from the system of record — the same discipline, one layer up.
 *
 * <b>`claim` is the exactly-once gate</b>, and it is the same contract {@code RunStore.claim} states:
 * a second resume of the same stopped procedure must not run the side effect again.
 */
import { existsSync, mkdirSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join } from "node:path";
import type { AbsenceReason, ProcedureId } from "../operator/procedure/Procedure";
import type { InterruptKind, TerminalKind } from "./ProcedureDefinition";
import type { ProcedureRefs } from "./ProcedureState";

/** The ONLY fields persisted. No body, no evidence, no approval record, no token. */
export interface AopCheckpoint {
  readonly threadId: string;
  readonly conversationId: string;
  readonly procedureId: ProcedureId;
  /** The exact shape that was running — a resume against a different one is a different procedure. */
  readonly procedureVersion: string;
  /** Where it stopped. The step the next run continues after. */
  readonly step: string;
  readonly stepTrail: readonly string[];
  /** Database keys only. */
  readonly refs: ProcedureRefs;
  /** The append-only draft version this cursor was standing on, by NUMBER — never its text. */
  readonly draftId: string | null;
  /** The standing approval this cursor was waiting on, by id — never its decision. */
  readonly approvalId: string | null;
  readonly terminal: TerminalKind | null;
  readonly absence: AbsenceReason | null;
  readonly interrupt: InterruptKind | null;
  readonly updatedAt: string;
}

export interface ClaimResult {
  readonly outcome: "CLAIMED" | "ALREADY_DONE" | "CONFLICT";
}

export interface AopCheckpointStore {
  save(checkpoint: AopCheckpoint): Promise<void>;
  load(threadId: string): Promise<AopCheckpoint | null>;
  delete(threadId: string): Promise<void>;
  /** Acquire the exactly-once right to continue this stopped procedure. */
  claim(threadId: string): Promise<ClaimResult>;
}

/** Fields that may never appear in a persisted cursor, whatever a caller passes. */
const FORBIDDEN = [
  "body", "text", "message", "details", "title", "draft", "content", "quote", "writer",
  "email", "phone", "address", "token", "evidence", "passage",
];

/**
 * Strip a checkpoint to its declared shape.
 *
 * A whitelist rather than a scrub: a field nobody declared does not travel, so adding one is an edit
 * to this file rather than a value that quietly appears in a store.
 */
export function sanitize(checkpoint: AopCheckpoint): AopCheckpoint {
  const refs: ProcedureRefs = {
    ...(checkpoint.refs.workItemId != null ? { workItemId: checkpoint.refs.workItemId } : {}),
    ...(checkpoint.refs.inquiryId != null ? { inquiryId: checkpoint.refs.inquiryId } : {}),
    ...(checkpoint.refs.reviewId != null ? { reviewId: checkpoint.refs.reviewId } : {}),
    ...(checkpoint.refs.productId != null ? { productId: checkpoint.refs.productId } : {}),
    ...(checkpoint.refs.issueId != null ? { issueId: checkpoint.refs.issueId } : {}),
    ...(checkpoint.refs.candidateId != null ? { candidateId: checkpoint.refs.candidateId } : {}),
    ...(checkpoint.refs.channelCode != null ? { channelCode: checkpoint.refs.channelCode } : {}),
    ...(checkpoint.refs.draftVersion != null ? { draftVersion: checkpoint.refs.draftVersion } : {}),
  };
  return {
    threadId: checkpoint.threadId, conversationId: checkpoint.conversationId,
    procedureId: checkpoint.procedureId, procedureVersion: checkpoint.procedureVersion,
    step: checkpoint.step, stepTrail: [...checkpoint.stepTrail], refs,
    draftId: checkpoint.draftId, approvalId: checkpoint.approvalId,
    terminal: checkpoint.terminal, absence: checkpoint.absence, interrupt: checkpoint.interrupt,
    updatedAt: checkpoint.updatedAt,
  };
}

/** Every key a sanitized cursor may carry — the assertion a test makes against a real write. */
export const CHECKPOINT_KEYS = [
  "threadId", "conversationId", "procedureId", "procedureVersion", "step", "stepTrail", "refs",
  "draftId", "approvalId", "terminal", "absence", "interrupt", "updatedAt",
] as const;

export function forbiddenKeysIn(value: unknown, path = ""): string[] {
  if (value == null || typeof value !== "object") return [];
  const bad: string[] = [];
  for (const [key, inner] of Object.entries(value as Record<string, unknown>)) {
    if (FORBIDDEN.some((f) => key.toLowerCase() === f)) bad.push(`${path}${key}`);
    bad.push(...forbiddenKeysIn(inner, `${path}${key}.`));
  }
  return bad;
}

/**
 * Same-process store. Lost on restart — use the file store to prove restart-resume, and the
 * backend-owned one (`SpringAopCheckpointStore`) for anything a container replacement can touch.
 *
 * <b>A saved cursor is claimable again.</b> Writing the cursor is what says the procedure stopped for
 * a person; holding the previous claim past that point would make the SECOND pause unresumable
 * forever. The backend row gets this for free (a claim moves it to RESUMING and the next save moves
 * it back to WAITING_HUMAN); these two do it by hand so all three stores mean the same thing.
 */
export class MemoryAopCheckpointStore implements AopCheckpointStore {
  private readonly byThread = new Map<string, AopCheckpoint>();
  private readonly claimed = new Set<string>();

  async save(checkpoint: AopCheckpoint): Promise<void> {
    this.byThread.set(checkpoint.threadId, sanitize(checkpoint));
    this.claimed.delete(checkpoint.threadId);
  }

  async load(threadId: string): Promise<AopCheckpoint | null> {
    return this.byThread.get(threadId) ?? null;
  }

  async delete(threadId: string): Promise<void> {
    this.byThread.delete(threadId);
    this.claimed.delete(threadId);
  }

  async claim(threadId: string): Promise<ClaimResult> {
    const found = this.byThread.get(threadId);
    if (!found) return { outcome: "ALREADY_DONE" };
    if (found.terminal && found.terminal !== "WAITING_HUMAN") return { outcome: "ALREADY_DONE" };
    if (this.claimed.has(threadId)) return { outcome: "CONFLICT" };
    this.claimed.add(threadId);
    return { outcome: "CLAIMED" };
  }
}

/**
 * File-backed: survives the process, which is what a restart proof needs — and nothing more.
 *
 * <b>Single instance only.</b> The `.claim` lock is `existsSync` then `writeFileSync`, which is not
 * atomic, and the directory goes wherever the container goes. That is why production resolves the
 * backend-owned store instead (Agent Runtime Production Closure v1 §1) and why `APP_ENV=production`
 * refuses to boot on this kind at all.
 */
export class FileAopCheckpointStore implements AopCheckpointStore {
  private readonly dir: string;

  constructor(dir: string) {
    this.dir = dir;
    mkdirSync(dir, { recursive: true });
  }

  /** The thread id is never a file name: it can carry a conversation id, so it is hashed. */
  private pathOf(threadId: string): string {
    return join(this.dir, `${createHash("sha256").update(threadId).digest("hex").slice(0, 32)}.json`);
  }

  async save(checkpoint: AopCheckpoint): Promise<void> {
    const path = this.pathOf(checkpoint.threadId);
    writeFileSync(path, JSON.stringify(sanitize(checkpoint)), "utf8");
    const lock = `${path}.claim`;
    if (existsSync(lock)) rmSync(lock);
  }

  async load(threadId: string): Promise<AopCheckpoint | null> {
    const path = this.pathOf(threadId);
    if (!existsSync(path)) return null;
    return JSON.parse(readFileSync(path, "utf8")) as AopCheckpoint;
  }

  async delete(threadId: string): Promise<void> {
    const path = this.pathOf(threadId);
    if (existsSync(path)) rmSync(path);
    const lock = `${path}.claim`;
    if (existsSync(lock)) rmSync(lock);
  }

  async claim(threadId: string): Promise<ClaimResult> {
    const found = await this.load(threadId);
    if (!found) return { outcome: "ALREADY_DONE" };
    if (found.terminal && found.terminal !== "WAITING_HUMAN") return { outcome: "ALREADY_DONE" };
    const lock = `${this.pathOf(threadId)}.claim`;
    if (existsSync(lock)) return { outcome: "CONFLICT" };
    writeFileSync(lock, "1", "utf8");
    return { outcome: "CLAIMED" };
  }

  /** For tests and for a store that has to be emptied between runs. */
  clear(): void {
    if (!existsSync(this.dir)) return;
    for (const name of readdirSync(this.dir)) rmSync(join(this.dir, name));
  }
}
