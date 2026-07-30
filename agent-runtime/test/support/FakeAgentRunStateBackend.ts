/**
 * An in-memory stand-in for the backend's `/api/agent-run-store` surface, emulated at the HTTP layer
 * so the REAL {@link HttpAgentRunStateClient} (and the real Spring-backed stores + service) can be
 * exercised offline. It reproduces the backend's contract exactly: org-scoped rows keyed by
 * (org, threadId), an optimistic-lock `version`, insert-if-absent semantics, a version-guarded update,
 * and a claim that bumps the version only while AWAITING_APPROVAL.
 *
 * Concurrency fidelity: each route handler runs to completion synchronously (no internal await), so a
 * claim/update is an atomic compare-and-swap even when two client requests are in flight — which is
 * what makes the exactly-once proof meaningful. The org is derived from the bearer via {@link tokenOrg}
 * (mirroring the backend deriving it from the JWT), never from the request body.
 */
interface Row {
  domain: string;
  status: string;
  version: number;
  snapshot: unknown;
}

export class FakeAgentRunStateBackend {
  /** Shared across all clients: keyed by `${orgId}::${threadId}`. */
  private readonly rows = new Map<string, Row>();
  /** Test-controlled token → org mapping (the backend would derive this from the JWT). */
  private readonly tokenOrg: Map<string, string>;

  constructor(tokenOrg: Record<string, string>) {
    this.tokenOrg = new Map(Object.entries(tokenOrg));
  }

  /** A `fetch` implementation to hand to {@link HttpAgentRunStateClient} as `fetchImpl`. */
  fetch = async (input: string | URL | Request, init?: RequestInit): Promise<Response> => {
    const url = new URL(typeof input === "string" ? input : input.toString());
    const method = (init?.method ?? "GET").toUpperCase();
    const org = this.orgFromAuth(init);
    if (!org) return this.json(401, { error: { code: "UNAUTHORIZED", message: "no org" } });

    const match = url.pathname.match(/^\/api\/agent-run-store\/([^/]+?)(\/claim)?$/);
    if (!match) return this.json(404, { error: { code: "NOT_FOUND", message: "no route" } });
    const threadId = decodeURIComponent(match[1]!);
    const isClaim = match[2] === "/claim";
    const body = init?.body ? (JSON.parse(init.body as string) as Record<string, unknown>) : {};
    const key = `${org}::${threadId}`;

    if (isClaim && method === "POST") return this.claim(key);
    if (method === "GET") return this.get(key, threadId);
    if (method === "PUT") return this.put(key, threadId, body);
    if (method === "DELETE") {
      this.rows.delete(key);
      return new Response(null, { status: 204 });
    }
    return this.json(405, { error: { code: "METHOD", message: "unsupported" } });
  };

  /** Direct read for assertions (bypasses the client). */
  peek(orgId: string, threadId: string): Row | undefined {
    return this.rows.get(`${orgId}::${threadId}`);
  }

  private get(key: string, threadId: string): Response {
    const row = this.rows.get(key);
    if (!row) return this.json(404, { error: { code: "NOT_FOUND", message: "absent" } });
    return this.json(200, this.view(threadId, row));
  }

  private put(key: string, threadId: string, body: Record<string, unknown>): Response {
    const domain = body["domain"] as string;
    const status = body["status"] as string;
    const snapshot = body["snapshot"];
    const expected = body["version"] as number | null | undefined;

    if (expected === null || expected === undefined) {
      if (this.rows.has(key)) return this.json(409, { error: { code: "CONFLICT", message: "exists" } });
      const row: Row = { domain, status, version: 1, snapshot };
      this.rows.set(key, row);
      return this.json(200, this.view(threadId, row));
    }
    const row = this.rows.get(key);
    if (!row || row.version !== expected) {
      return this.json(409, { error: { code: "CONFLICT", message: "stale" } });
    }
    row.domain = domain;
    row.status = status;
    row.snapshot = snapshot;
    row.version += 1;
    return this.json(200, this.view(threadId, row));
  }

  private claim(key: string): Response {
    const row = this.rows.get(key);
    if (!row) return this.json(404, { error: { code: "NOT_FOUND", message: "absent" } });
    // The claim is a status transition (AWAITING → RESUMING), not a version bump, so a staggered
    // second claimer that reads the post-claim row sees RESUMING and is refused. (Lease-based
    // re-claim of a crashed RESUMING is a backend-only concern, exercised in AgentRunStoreServiceTest;
    // this fake keeps RESUMING held, which is exactly the exactly-once case the runtime relies on.)
    if (row.status === "AWAITING_APPROVAL") {
      row.status = "RESUMING";
      row.version += 1; // atomic transition + version bump
      return this.json(200, { outcome: "CLAIMED", version: row.version, snapshot: row.snapshot });
    }
    if (row.status === "DONE") {
      return this.json(200, { outcome: "ALREADY_DONE", version: row.version, snapshot: row.snapshot });
    }
    return this.json(200, { outcome: "CONFLICT", version: row.version, snapshot: null });
  }

  private view(threadId: string, row: Row): unknown {
    return { threadId, domain: row.domain, status: row.status, version: row.version, snapshot: row.snapshot };
  }

  private orgFromAuth(init?: RequestInit): string | null {
    const headers = (init?.headers ?? {}) as Record<string, string>;
    const auth = headers["Authorization"] ?? headers["authorization"] ?? "";
    const token = auth.startsWith("Bearer ") ? auth.slice("Bearer ".length) : "";
    return this.tokenOrg.get(token) ?? null;
  }

  private json(status: number, payload: unknown): Response {
    return new Response(JSON.stringify(payload), {
      status,
      headers: { "Content-Type": "application/json" },
    });
  }
}
