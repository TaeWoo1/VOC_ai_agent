/**
 * Run-store provider — resolves the three durable stores PER REQUEST, and FAILS CLOSED in production
 * unless the backend-owned store is configured.
 *
 * Two production-relevant properties:
 *
 * 1. **Tenant scoping.** The runtime holds no org (the backend derives it from the JWT). For the
 *    `spring` store, org isolation is enforced entirely at the backend (every row is org-scoped by the
 *    forwarded token), so the store is built from the token alone. For the local `file`/`memory` stores
 *    there is no backend to scope, so the HTTP layer resolves the caller's org and this provider keys
 *    each org's stores by a one-way scope fingerprint (never the raw org id on disk or in a log).
 *
 * 2. **Production fail-closed.** Only the `spring` store is durable AND safe behind more than one
 *    replica; `file` is single-instance and `memory` loses paused runs on restart, so booting with
 *    `APP_ENV=production` on either is a hard error before any port opens.
 *
 * The `spring` store is built fresh per request (it carries the request's bearer and the backend is the
 * durable system of record, so there is nothing to cache in-process); `file`/`memory` stores are cached
 * per scope so a paused run written by one request is visible to the next.
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { FileRunStore, InMemoryRunStore } from "../checkpoint/RunStore";
import { FileReviewRunStore, InMemoryReviewRunStore } from "../checkpoint/ReviewRunStore";
import type { ReviewRunStore } from "../checkpoint/ReviewRunStore";
import type { RunStore } from "../checkpoint/RunStore";
import { FileIssueRunStore, InMemoryIssueRunStore } from "../checkpoint/IssueRunStore";
import type { IssueRunStore } from "../checkpoint/IssueRunStore";
import { SpringIssueRunStore, SpringReviewRunStore, SpringRunStore } from "./springStores";
import { HttpAgentRunStateClient } from "../spring/AgentRunStateClient";
import type { AgentRunStateClient } from "../spring/AgentRunStateClient";
import type { RuntimeConfig } from "./config";

export class ProductionStoreNotConfiguredError extends Error {
  constructor(kind: string) {
    super(
      `refusing to boot: run-store kind "${kind}" may not be used with APP_ENV=production. Only the ` +
        `backend-owned "spring" store is durable and multi-instance-safe; configure ` +
        `AGENT_RUNTIME_RUNSTORE_KIND=spring before running in production.`,
    );
    this.name = "ProductionStoreNotConfiguredError";
  }
}

export interface RunStores {
  readonly inquiry: RunStore;
  readonly review: ReviewRunStore;
  readonly issue: IssueRunStore;
}

/** Context a request carries for store resolution: the token (spring) and the org scope (file/memory). */
export interface RequestStoreContext {
  readonly token: string;
  readonly scope: string;
}

/** Builds an {@link AgentRunStateClient} for one forwarded operator token. Injectable for tests. */
export type AgentRunStateClientFactory = (token: string) => AgentRunStateClient;

/** Opaque, filename-safe, one-way scope key for an org id — never the raw id on disk or in a log. */
export function scopeFor(orgId: string): string {
  return createHash("sha256").update(`agent-runtime-tenant/v1:${orgId}`).digest("hex").slice(0, 32);
}

export class RunStoreProvider {
  readonly kind: string;
  readonly durable: boolean;
  readonly multiInstanceSafe: boolean;
  private readonly config: RuntimeConfig;
  private readonly clientFactory: AgentRunStateClientFactory;
  private readonly scopeCache = new Map<string, RunStores>();

  constructor(config: RuntimeConfig, clientFactory?: AgentRunStateClientFactory) {
    if (config.env === "production" && config.runStoreKind !== "spring") {
      throw new ProductionStoreNotConfiguredError(config.runStoreKind);
    }
    this.config = config;
    this.kind = config.runStoreKind;
    this.durable = config.runStoreKind !== "memory";
    this.multiInstanceSafe = config.runStoreKind === "spring";
    this.clientFactory =
      clientFactory ?? ((token) => new HttpAgentRunStateClient({ baseUrl: config.backendBaseUrl, token }));
  }

  /** The three stores for one request. Spring: token-bound + fresh. File/memory: scope-keyed + cached. */
  storesForRequest(ctx: RequestStoreContext): RunStores {
    if (this.config.runStoreKind === "spring") {
      const client = this.clientFactory(ctx.token);
      return {
        inquiry: new SpringRunStore(client),
        review: new SpringReviewRunStore(client),
        issue: new SpringIssueRunStore(client),
      };
    }
    return this.storesForScope(ctx.scope);
  }

  private storesForScope(scope: string): RunStores {
    const existing = this.scopeCache.get(scope);
    if (existing) return existing;
    const stores = this.buildLocal(scope);
    this.scopeCache.set(scope, stores);
    return stores;
  }

  private buildLocal(scope: string): RunStores {
    if (this.config.runStoreKind === "memory") {
      return {
        inquiry: new InMemoryRunStore(),
        review: new InMemoryReviewRunStore(),
        issue: new InMemoryIssueRunStore(),
      };
    }
    const dir = join(this.config.runStoreDir, scope);
    return {
      inquiry: new FileRunStore(join(dir, "inquiry")),
      review: new FileReviewRunStore(join(dir, "review")),
      issue: new FileIssueRunStore(join(dir, "issue")),
    };
  }
}
