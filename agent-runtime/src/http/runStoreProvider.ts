/**
 * Run-store provider — resolves the three durable stores PER TENANT, and FAILS CLOSED in production.
 *
 * Tenant scoping: the runtime holds no org (the backend derives it from the JWT), so the HTTP layer
 * resolves the caller's org via {@link IdentitySpringClient} and asks this provider for that org's
 * stores by an opaque scope key. Each scope gets its own file subtree / in-memory map, so one
 * operator can never read, shadow, or collide with another org's run — even with a client-supplied
 * `threadId`. The scope key is a one-way fingerprint (never the raw org id on disk or in a log).
 *
 * Production fail-closed: the file/in-memory stores are single-instance (a file store is unsafe
 * behind more than one replica; the in-memory store loses paused runs on restart), so booting with
 * `APP_ENV=production` on either is a hard error. A production-grade multi-instance store is future
 * work; this class is the seam it slots behind (add a `RunStoreKind`, branch in `build`).
 */
import { createHash } from "node:crypto";
import { join } from "node:path";
import { FileRunStore, InMemoryRunStore } from "../checkpoint/RunStore";
import type { RunStore } from "../checkpoint/RunStore";
import { FileReviewRunStore, InMemoryReviewRunStore } from "../checkpoint/ReviewRunStore";
import type { ReviewRunStore } from "../checkpoint/ReviewRunStore";
import { FileIssueRunStore, InMemoryIssueRunStore } from "../checkpoint/IssueRunStore";
import type { IssueRunStore } from "../checkpoint/IssueRunStore";
import type { RuntimeConfig } from "./config";

export class ProductionStoreNotConfiguredError extends Error {
  constructor(kind: string) {
    super(
      `refusing to boot: run-store kind "${kind}" is single-instance and is not permitted with ` +
        `APP_ENV=production. Configure a durable multi-instance store before running in production.`,
    );
    this.name = "ProductionStoreNotConfiguredError";
  }
}

export interface RunStores {
  readonly inquiry: RunStore;
  readonly review: ReviewRunStore;
  readonly issue: IssueRunStore;
}

/** Opaque, filename-safe, one-way scope key for an org id — never the raw id on disk or in a log. */
export function scopeFor(orgId: string): string {
  return createHash("sha256").update(`agent-runtime-tenant/v1:${orgId}`).digest("hex").slice(0, 32);
}

/**
 * Builds and caches per-tenant {@link RunStores}. Constructing it performs the production
 * fail-closed check ONCE (the store kind is a process property, independent of tenant).
 */
export class RunStoreProvider {
  readonly kind: string;
  readonly durable: boolean;
  readonly multiInstanceSafe: boolean;
  private readonly config: RuntimeConfig;
  private readonly cache = new Map<string, RunStores>();

  constructor(config: RuntimeConfig) {
    if (config.env === "production" && (config.runStoreKind === "file" || config.runStoreKind === "memory")) {
      throw new ProductionStoreNotConfiguredError(config.runStoreKind);
    }
    this.config = config;
    this.kind = config.runStoreKind;
    this.durable = config.runStoreKind === "file";
    this.multiInstanceSafe = false;
  }

  /** The three stores for one tenant scope, created on first use and cached thereafter. */
  storesFor(scope: string): RunStores {
    const existing = this.cache.get(scope);
    if (existing) return existing;
    const stores = this.build(scope);
    this.cache.set(scope, stores);
    return stores;
  }

  private build(scope: string): RunStores {
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
