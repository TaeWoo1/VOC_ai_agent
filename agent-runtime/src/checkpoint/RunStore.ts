/**
 * Durable run store — the checkpoint that survives a process restart.
 *
 * LangGraph's in-memory checkpointer resumes a run WITHIN a process, but it snapshots the
 * whole graph state — which includes seller-owned content (inquiry body, draft comments).
 * That content must never be persisted. So durable persistence is a SEPARATE, deliberately
 * minimal store: it keeps only a **sanitized** snapshot — ids, phase, a coarse category,
 * the step trail, and the sanitized outcome — and NOTHING that could carry PII, a token,
 * or a credential. Domain data is not replicated; on restart the runtime re-fetches detail
 * from the backend (the system of record) and regenerates the draft deterministically.
 *
 * `RunStore` is an abstraction with two implementations here — in-memory (default, for the
 * same-process path and tests) and file-backed (survives restart) — and a production store
 * (e.g. Postgres) can be swapped in behind the same interface.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { RunOutcome } from "../state/AgentState";

export type RunStatus = "AWAITING_APPROVAL" | "DONE";

/**
 * The ONLY fields persisted. No title/body/comments/candidate, no token, no credential.
 * `approvedFingerprint` inside `outcome` is a one-way content hash, not content.
 */
export interface RunSnapshot {
  readonly threadId: string;
  readonly status: RunStatus;
  readonly inquiryId: string;
  readonly workItemId: string;
  readonly phase: string;
  readonly priorityBucket: string;
  readonly category: string;
  readonly trail: string[];
  readonly outcome?: RunOutcome | null;
}

export interface RunStore {
  save(snapshot: RunSnapshot): Promise<void>;
  load(threadId: string): Promise<RunSnapshot | null>;
  delete(threadId: string): Promise<void>;
}

/** Same-process store. Lost on restart — use a durable impl to prove restart-resume. */
export class InMemoryRunStore implements RunStore {
  private readonly byThread = new Map<string, RunSnapshot>();

  async save(snapshot: RunSnapshot): Promise<void> {
    this.byThread.set(snapshot.threadId, snapshot);
  }
  async load(threadId: string): Promise<RunSnapshot | null> {
    return this.byThread.get(threadId) ?? null;
  }
  async delete(threadId: string): Promise<void> {
    this.byThread.delete(threadId);
  }
}

/**
 * File-backed durable store: one JSON file per thread under a directory. Survives a
 * process restart, which is what makes the restart-resume proof real. Production would
 * swap a transactional store; this is the simplest durable, dependency-free impl.
 */
export class FileRunStore implements RunStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(threadId: string): string {
    // Thread ids are synthetic run ids (safe filename chars); guard anyway.
    const safe = threadId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.dir, `${safe}.json`);
  }

  async save(snapshot: RunSnapshot): Promise<void> {
    writeFileSync(this.path(snapshot.threadId), JSON.stringify(snapshot, null, 2), "utf8");
  }
  async load(threadId: string): Promise<RunSnapshot | null> {
    const p = this.path(threadId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as RunSnapshot;
  }
  async delete(threadId: string): Promise<void> {
    const p = this.path(threadId);
    if (existsSync(p)) rmSync(p);
  }
}
