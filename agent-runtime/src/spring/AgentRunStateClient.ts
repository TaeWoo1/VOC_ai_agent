/**
 * HTTP adapter to the backend's durable run-state surface (`/api/agent-run-store`) — the ONLY way the
 * Agent Runtime touches run state in production. It holds NO database handle and NO credential beyond
 * the per-request operator bearer it forwards; the backend derives the org from that token and scopes
 * every row, so tenant isolation is enforced there, not here.
 *
 * Optimistic concurrency is threaded WITHOUT changing the (save/load/delete/claim) store interfaces:
 * this client remembers the last version it observed for each thread (per request — a client is built
 * fresh per request) and sends it as the expected version on the next write. A write whose expected
 * version no longer matches is a 409, surfaced as {@link StaleRunVersionError} (fail closed). Reads
 * never cache their RESULT (only the version), so a re-read after a claim reflects the bumped version.
 */
import { SpringApiError } from "./SpringClient";

/** A stored run row as the backend returns it. `snapshot` is the sanitized snapshot the typed store owns. */
export interface AgentRunStateRecord {
  readonly threadId: string;
  readonly domain: string;
  readonly status: string;
  readonly version: number;
  readonly snapshot: unknown;
}

export type ClaimOutcome = "CLAIMED" | "ALREADY_DONE" | "CONFLICT";

/** A version-guarded write lost the race (backend 409). Callers must fail closed, never overwrite. */
export class StaleRunVersionError extends Error {
  constructor(message: string) {
    super(message);
    this.name = "StaleRunVersionError";
  }
}

/**
 * The seam the Spring-backed stores depend on. {@link HttpAgentRunStateClient} is the production
 * implementation; tests inject a fake with the same CAS/claim semantics to prove concurrency offline.
 */
export interface AgentRunStateClient {
  get(threadId: string): Promise<AgentRunStateRecord | null>;
  put(input: {
    readonly threadId: string;
    readonly domain: string;
    readonly status: string;
    readonly snapshot: unknown;
  }): Promise<AgentRunStateRecord>;
  claim(threadId: string): Promise<ClaimOutcome>;
  delete(threadId: string): Promise<void>;
}

export interface AgentRunStateClientOptions {
  readonly baseUrl: string;
  readonly token: string;
  readonly fetchImpl?: typeof fetch;
}

export class HttpAgentRunStateClient implements AgentRunStateClient {
  private readonly baseUrl: string;
  private readonly token: string;
  private readonly fetchImpl: typeof fetch;
  /** Last observed version per thread (this request only). Absent ⇒ the next write is an insert. */
  private readonly versions = new Map<string, number>();

  constructor(opts: AgentRunStateClientOptions) {
    this.baseUrl = opts.baseUrl.replace(/\/+$/, "");
    this.token = opts.token;
    this.fetchImpl = opts.fetchImpl ?? fetch;
  }

  async get(threadId: string): Promise<AgentRunStateRecord | null> {
    const { status, json } = await this.send("GET", this.path(threadId));
    if (status === 404) return null;
    if (status < 200 || status >= 300) throw this.apiError(status, "GET", threadId);
    const record = json as AgentRunStateRecord;
    this.versions.set(threadId, record.version);
    return record;
  }

  /**
   * Upsert: insert when no version is known for this thread (a fresh run), otherwise a version-guarded
   * update. A 409 (unique collision on insert, or a stale expected version on update) is a lost race.
   */
  async put(input: {
    readonly threadId: string;
    readonly domain: string;
    readonly status: string;
    readonly snapshot: unknown;
  }): Promise<AgentRunStateRecord> {
    const expected = this.versions.get(input.threadId);
    const body = {
      domain: input.domain,
      status: input.status,
      version: expected ?? null,
      snapshot: input.snapshot,
    };
    const { status, json } = await this.send("PUT", this.path(input.threadId), body);
    if (status === 409) {
      throw new StaleRunVersionError(`run-state write rejected (stale version) for thread ${input.threadId}`);
    }
    if (status < 200 || status >= 300) throw this.apiError(status, "PUT", input.threadId);
    const record = json as AgentRunStateRecord;
    this.versions.set(input.threadId, record.version);
    return record;
  }

  /**
   * Claim the exactly-once right to resume. The backend transitions the run out of the claimable state
   * (a real lock), so no expected version is sent — the outcome (CLAIMED / ALREADY_DONE / CONFLICT) is
   * authoritative. Caches the returned version for the subsequent finalize write. A vanished thread
   * (404) fails closed to CONFLICT.
   */
  async claim(threadId: string): Promise<ClaimOutcome> {
    const { status, json } = await this.send("POST", `${this.path(threadId)}/claim`);
    if (status === 404) return "CONFLICT";
    if (status < 200 || status >= 300) throw this.apiError(status, "POST", threadId);
    const body = json as { outcome: ClaimOutcome; version: number };
    this.versions.set(threadId, body.version);
    return body.outcome;
  }

  async delete(threadId: string): Promise<void> {
    const { status } = await this.send("DELETE", this.path(threadId));
    if (status !== 404 && (status < 200 || status >= 300)) throw this.apiError(status, "DELETE", threadId);
    this.versions.delete(threadId);
  }

  private path(threadId: string): string {
    return `/api/agent-run-store/${encodeURIComponent(threadId)}`;
  }

  private apiError(status: number, method: string, threadId: string): SpringApiError {
    // Never echo a response body — status + coarse label only (the label carries no content).
    return new SpringApiError(status, `HTTP_${status}`, `run-state request failed (${method} ${this.path(threadId)})`);
  }

  private async send(
    method: string,
    path: string,
    body?: unknown,
  ): Promise<{ status: number; json: unknown }> {
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      method,
      headers: {
        Authorization: `Bearer ${this.token}`,
        ...(body !== undefined ? { "Content-Type": "application/json" } : {}),
      },
      body: body !== undefined ? JSON.stringify(body) : undefined,
    });
    const text = await res.text();
    // A well-behaved backend returns JSON, but a proxy/gateway 5xx may return HTML. Never let a parse
    // failure escape as a raw SyntaxError (which would collapse to a 500) — a non-JSON body simply has
    // no json, and the caller's status check turns a non-2xx into a SpringApiError (→ 4xx passthrough /
    // 5xx→502).
    let json: unknown = null;
    if (text.length > 0) {
      try {
        json = JSON.parse(text) as unknown;
      } catch {
        json = null;
      }
    }
    return { status: res.status, json };
  }
}
