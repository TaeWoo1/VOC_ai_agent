/**
 * **Execution Provider — the seam at which HOW a server-authorized review-export segment is carried becomes
 * replaceable** (Aside Acquisition Track M1, `docs/aside_execution_provider_v1.md`).
 *
 * ## Where the seam is, and why it is not lower
 *
 * `ImportSegmentHost` resolves a launch ref against the SERVER, decides whether the segment is hostable, and
 * consults the acquisition admission gate. Everything up to that decision is domain/security state — the ticket,
 * the org fence behind it, the account slot, the channel — and no provider may bypass it. What comes AFTER the
 * `HOST_SEGMENT` decision is "carry this authorized segment to a terminal outcome", and that is the one thing
 * two very different executors can both do:
 *
 *  - `LOCAL_HELPER` — the existing guided Action Window run: `ImportSegmentEngine` + `ImportSegmentSession` +
 *    an `ImportProbeDriver`. The SELLER performs every marketplace action; the runtime observes, validates the
 *    file they downloaded, and ingests it through the launch ref. Wrapped here UNCHANGED (`local-helper-execution`).
 *  - `ASIDE` — a deterministic export workflow executed by the Aside browser on the seller's PC, whose download
 *    lands on the host filesystem; the Runner then reads that file, hashes it, and ingests it through the SAME
 *    launch-ref endpoint (`../../aside/aside-execution-provider`).
 *
 * The seam deliberately sits ABOVE `ImportProbeDriver`. That interface is "the seller clicks, we observe" — it has
 * no click/fill/submit method by construction (its first invariant) — so an executor that performs the actions
 * itself cannot implement it without either lying (no-op half its methods) or breaking the Action Window pattern.
 * And it sits BELOW the host, because the host's ticket handling is exactly what must NOT change per provider.
 *
 * ## What a provider may and may not do
 *
 * A provider receives an identity-free {@link SegmentExecutionRequest} — no launch ref, no org, no token. The
 * ingest authorization (`importRef`) travels only in the {@link SegmentExecutionContext} the HOST hands to the
 * provider's carrier layer, and a provider's *executor* (the thing that drives a browser) never sees it. A
 * provider does not parse, normalize, dedup, or decide anything about reviews: it produces an outcome, and the
 * existing backend ingestion spine does the rest.
 *
 * ## The wire is unchanged
 *
 * `CollectionMethod` stays `SELLER_CENTER_EXPORT` for both providers (PD-3). The provider kind is an execution
 * axis recorded in the outcome and the log, not a new provenance value and not a schema change.
 */
import type { RunStatus } from "../../../../contracts/action-window/v2/index";
import type { AwClientFrame, AwServerTransport } from "../../../../contracts/action-window/v2/transport";
import type { ScopeEvidenceWire } from "../scope-evidence";
import type { ImportBlockerCode } from "./import-engine";
import type { RequiredRange } from "./import-driver";
import type { ImportSegmentSession } from "./import-session";

/** The execution axis (PD-3). `MANUAL` is not a provider — it is the FE upload fallback and never reaches here. */
export const EXECUTION_PROVIDER_KINDS = ["LOCAL_HELPER", "ASIDE"] as const;
export type ExecutionProviderKind = (typeof EXECUTION_PROVIDER_KINDS)[number];

/** The production default. Never changed by configuration silently — see `config.ts` `executionProvider`. */
export const DEFAULT_EXECUTION_PROVIDER: ExecutionProviderKind = "LOCAL_HELPER";

export function isExecutionProviderKind(value: unknown): value is ExecutionProviderKind {
  return typeof value === "string" && (EXECUTION_PROVIDER_KINDS as readonly string[]).includes(value);
}

/**
 * Which deterministic workflow, at which version, carried the run. Part of the run-scoped approval identity
 * (PD-7: organization · channel · store account · period · **workflow/version** · single-use run). The first
 * four are bound server-side by the launch ref; this is the axis the ticket does not yet carry.
 */
export interface ExecutionWorkflowRef {
  /** Semantic id, e.g. `naver-review-export`. Never a URL, never a selector. */
  id: string;
  version: number;
}

/**
 * One server-authorized segment the host has decided to carry. Identity-free by construction — everything here
 * is either Runtime-minted (`runId`), a sanitized enum (`channelCode`), an opaque server surrogate
 * (`accountSlot`), or the window the server resolved (`required`). There is no field for a launch ref, an org,
 * a token, or a store name, so a provider cannot be handed one by accident.
 */
export interface SegmentExecutionRequest {
  /** Runtime-assigned opaque run identity (`run_<hex>`). One execution = one run. */
  runId: string;
  /** Semantic channel code (`naver`). */
  channelCode: string;
  /** Opaque, server-owned per-account slot. Empty on a legacy server. */
  accountSlot: string;
  /** The window this segment must cover, resolved server-side. */
  required: RequiredRange;
}

/**
 * What the HOST hands to a provider so the carried run can publish and ingest. The `importRef` is the ingest
 * authorization: the carrier layer of a provider may use it (through the injected ingest capability), an
 * executor never receives it.
 */
export interface SegmentExecutionContext {
  transport: AwServerTransport;
  /** Opaque 16-hex single-use ingest authorization. Never persisted, never logged, never sent to an executor. */
  importRef: string;
  /** The `START_RUN` that caused this segment to be hosted — replayed into an interactive session. */
  startFrame: AwClientFrame;
  persistDir?: string;
  now?: () => string;
}

/**
 * Failure codes a provider may report — the engine's existing taxonomy (reused, not copied) plus the
 * provider-neutral additions `docs/review_acquisition_aside_v2.md` §10 names. Raw messages, URLs, selectors and
 * paths never ride on a code.
 */
export type ExecutionFailureCode =
  | ImportBlockerCode
  /** login / MFA / CAPTCHA / re-auth — any of them. A person authenticates; nothing bypasses (PD-2). */
  | "AUTH_REQUIRED"
  /** The observed store identity is not the expected one (PD-4). */
  | "STORE_MISMATCH"
  /** No usable store identity evidence — never treated as success (PD-4). */
  | "STORE_UNRESOLVED"
  /** The workflow declared a range read-back and it could not be read. */
  | "SCOPE_UNREADABLE"
  /** The executor produced a file the Runner could not take custody of (missing, unreadable, unstable). */
  | "TRANSFER_FAILED"
  /** The executor (Aside daemon/browser/CLI) is not running or not installed. */
  | "PROVIDER_UNAVAILABLE"
  /** The executor refused on its own policy/permission grounds. */
  | "PROVIDER_REFUSED"
  /** The executor did not answer within its bounded window. */
  | "PROVIDER_TIMEOUT"
  /** The seller (or the host) stopped the run. Not a fault: the same segment can be started again. */
  | "CANCELLED";

/** Where in a provider's own choreography a failure was raised. Coarse and closed — never a selector or a URL. */
export type ExecutionStage =
  | "PREPARE"
  | "AUTH"
  | "IDENTITY"
  | "NAVIGATE"
  /** Reading what the surface printed — the acquisition lane's own work (Coupang WING 리뷰 목록). */
  | "READ"
  | "SCOPE"
  | "EXPORT"
  | "DOWNLOAD"
  | "TRANSFER"
  | "VALIDATE"
  | "INGEST"
  | "CLEANUP"
  | "EXECUTOR";

export interface ExecutionFailure {
  code: ExecutionFailureCode;
  stage: ExecutionStage;
  /** Whether a retry on the SAME segment and ticket is meaningful (a login, a re-check) or not (a fault). */
  recoverable: boolean;
}

/** Sanitized facts observed about one execution. Every leaf is a number, an ISO instant, or a closed enum. */
export interface ExecutionObservation {
  startedAt: string;
  completedAt: string;
  durationMs: number;
  /** The executor's own version tag, when it has one (e.g. the Aside CLI version). */
  executorVersion?: string;
  /** Browser major version observed by the executor, when known. */
  browserMajor?: number;
  /** SHA-256 hex of the artifact the Runner took custody of, when there was one. */
  artifactSha256?: string;
  artifactBytes?: number;
  /** Store identity verdict, when the workflow asserted one. */
  identity?: StoreIdentityVerdict;
  /** Model/LLM calls made on the normal path. Structurally 0 for the deterministic Aside path. */
  llmCalls?: number;
}

export type SegmentExecutionOutcome =
  | {
      ok: true;
      provider: ExecutionProviderKind;
      runId: string;
      workflow: ExecutionWorkflowRef | null;
      /** Opaque 16-hex artifact reference (the engine's own shape). */
      artifactRef: string;
      /** How the run's scope was established — the value the backend records on the attempt. */
      scopeEvidence: ScopeEvidenceWire;
      /** Rows the backend reported processed. 0 is a legitimate all-duplicates completion. */
      processed: number;
      observed: ExecutionObservation;
    }
  | {
      ok: false;
      provider: ExecutionProviderKind;
      runId: string;
      workflow: ExecutionWorkflowRef | null;
      failure: ExecutionFailure;
      observed: ExecutionObservation | null;
    };

/**
 * A carried segment, as the HOST sees it. The host keeps exactly one of these per hosted ref and needs three
 * things from it: is the run over (slot release), the interactive session if there is one (the LOCAL_HELPER
 * frontend attaches to it), and a way to let go of it when the next segment arrives.
 */
export interface HostedSegmentRun {
  readonly runId: string;
  readonly provider: ExecutionProviderKind;
  /** The hosted run's sanitized status — the ONE enum a host reads to answer "is this segment over?". */
  runStatus(): RunStatus;
  /** The interactive session, when the provider has one (LOCAL_HELPER). `null` for a deterministic provider. */
  session(): ImportSegmentSession | null;
  /** Release the run's transport subscription / watchers. Idempotent. */
  detach(): void;
  /** Resolves with the terminal outcome. Never rejects — a fault is an `ok: false` outcome. */
  settled(): Promise<SegmentExecutionOutcome>;
}

export interface SegmentExecutionProvider {
  readonly kind: ExecutionProviderKind;
  /**
   * Start carrying the segment. Returns promptly with the run handle; the run itself proceeds asynchronously
   * (an interactive run for as long as the seller takes, a deterministic run for as long as the workflow takes).
   * Must not throw: an executor that cannot even start reports it through the handle's outcome.
   */
  start(request: SegmentExecutionRequest, ctx: SegmentExecutionContext): HostedSegmentRun;
}

/* ── store identity seam (PD-4) ─────────────────────────────────────────────── */

/**
 * The three answers a store-identity comparison can give. Only `MATCH` may proceed. `UNRESOLVED` is not a
 * weaker `MATCH` — "we could not read it" and "it is the wrong store" lead to different repairs, but neither
 * leads to an ingest.
 */
export type StoreIdentityVerdict = "MATCH" | "MISMATCH" | "UNRESOLVED";

/** What the run expects to find. Bound by the provider from server-owned facts; never invented in the runtime. */
export interface StoreIdentityExpectation {
  /** Closed vocabulary of where the identity lives. `FIXTURE_MARKER` is the local test surface's own. */
  kind: "FIXTURE_MARKER" | "CHANNEL_NATIVE_ID";
  /** The expected value. Compared, never logged, never emitted. */
  expected: string;
}

/**
 * Pure comparison. Whitespace-trimmed exact match; anything else is a mismatch; nothing observed is
 * `UNRESOLVED`. Empty-string expectations are `UNRESOLVED` too — an expectation that matches everything is
 * not an expectation.
 */
export function storeIdentityVerdict(expected: string | null | undefined, observed: string | null | undefined): StoreIdentityVerdict {
  const want = (expected ?? "").trim();
  const got = (observed ?? "").trim();
  if (want.length === 0 || got.length === 0) return "UNRESOLVED";
  return want === got ? "MATCH" : "MISMATCH";
}
