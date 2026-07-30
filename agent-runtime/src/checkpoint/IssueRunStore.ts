/**
 * Durable run store for the issue-memory subgraph — sibling of the inquiry {@link RunStore} and
 * the review {@link ReviewRunStore}.
 *
 * This subgraph has no human checkpoint, so there is no paused run to resume across a restart. The
 * store exists only to make the "same request → same brief, even after a process restart" property
 * observable: a run persists its DONE brief here, and a fresh process re-running the same request
 * can be checked against the stored brief for equality. The payload is the composed brief itself,
 * which is already sanitized (ids, closed-vocabulary labels, counts, enums, dates) — no review
 * body, no quote, no operator note, no token.
 */
import { mkdirSync, readFileSync, writeFileSync, existsSync, rmSync } from "node:fs";
import { join } from "node:path";
import type { IssueOperationsBrief } from "../state/IssueAgentState";

export interface IssueRunSnapshot {
  readonly threadId: string;
  readonly status: "DONE";
  readonly referenceDate: string | null;
  readonly brief: IssueOperationsBrief;
  readonly trail: string[];
}

export interface IssueRunStore {
  save(snapshot: IssueRunSnapshot): Promise<void>;
  load(threadId: string): Promise<IssueRunSnapshot | null>;
  delete(threadId: string): Promise<void>;
}

/** Same-process store. Lost on restart — inject a durable impl to observe restart determinism. */
export class InMemoryIssueRunStore implements IssueRunStore {
  private readonly byThread = new Map<string, IssueRunSnapshot>();

  async save(snapshot: IssueRunSnapshot): Promise<void> {
    this.byThread.set(snapshot.threadId, snapshot);
  }
  async load(threadId: string): Promise<IssueRunSnapshot | null> {
    return this.byThread.get(threadId) ?? null;
  }
  async delete(threadId: string): Promise<void> {
    this.byThread.delete(threadId);
  }
}

/** File-backed durable store: one JSON file per thread. Survives a restart. */
export class FileIssueRunStore implements IssueRunStore {
  constructor(private readonly dir: string) {
    mkdirSync(dir, { recursive: true });
  }

  private path(threadId: string): string {
    const safe = threadId.replace(/[^a-zA-Z0-9._-]/g, "_");
    return join(this.dir, `${safe}.json`);
  }

  async save(snapshot: IssueRunSnapshot): Promise<void> {
    writeFileSync(this.path(snapshot.threadId), JSON.stringify(snapshot, null, 2), "utf8");
  }
  async load(threadId: string): Promise<IssueRunSnapshot | null> {
    const p = this.path(threadId);
    if (!existsSync(p)) return null;
    return JSON.parse(readFileSync(p, "utf8")) as IssueRunSnapshot;
  }
  async delete(threadId: string): Promise<void> {
    const p = this.path(threadId);
    if (existsSync(p)) rmSync(p);
  }
}
