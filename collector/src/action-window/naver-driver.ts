/**
 * **NAVER pilot channel driver — FIXTURE-ONLY (R4, G1-ratified, D-021).**
 *
 * The first channel-shaped `ProbeDriver`: it composes the existing READ-ONLY NAVER seams — the pure
 * session-verdict classifier, the export-target readiness gate, the no-click export-layout planner,
 * and the pure export-candidate finder — over the synthetic NAVER-shaped fixture
 * (`./naver-fixture.ts`). Upstream stages (prepare/locate/highlight/observe/verify) are real
 * compositions of those seams; the downstream stages (detect/validate/ingest) remain SYNTHETIC in
 * this slice — no real download, no quarantine save, no ingestion.
 *
 * HARD BOUNDARIES (enforced by source-guard + privacy tests):
 *   - No live contact: no browser, no network, no fs — the driver only reads the fixture object.
 *   - No click path: the user acts; the driver observes a REPORTED action (`completeUserAction`,
 *     test-only, mirroring `SyntheticProbeDriver`). `runExport` / any click-capable NAVER code is
 *     never imported.
 *   - Sanitized outputs only: counts, booleans, fixed enums, and opaque 16-hex signatures. Raw
 *     candidate identity (element id / wording keyword) is one-way hashed into the target signature
 *     and never leaves this module.
 *
 * Fail-closed mapping (already-reserved contract codes only):
 *   - session verdict RECONNECT_REQUIRED → `SESSION_EXPIRED`
 *   - session verdict ACCOUNT_LOGIN_REQUIRED / AUTH_CHALLENGE_REQUIRED → `LOGIN_REQUIRED`
 *   - session verdict UNKNOWN, or readiness HALT (empty / ambiguous / range) → `UNSUPPORTED_STATE`
 *     (the EMPTY-vs-UNKNOWN distinction is preserved in the driver-local diagnostic, not the wire)
 *   - 0 / many / non-sync layout at locate → engine fails `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`
 *   - post-action target identity change → `verify` reports drift → engine fails `UI_DRIFT`
 */
import { createHash } from "node:crypto";
import { classifySessionVerdict, type SessionVerdict } from "../naver/session-verdict";
import { planExportAction } from "../naver/export-classify";
import { evaluateExportTargetReadiness, type ExportTargetReadiness } from "../naver/export-target-readiness";
import { findExportCandidates } from "../naver/review-export";
import { artifactRefFor } from "./artifact";
import type {
  ArtifactValidateResult,
  DownloadDetectResult,
  IngestResult,
  LocateResult,
  SurfaceBlockerCode,
  SurfaceProbeResult,
  VerifyResult,
} from "./engine";
import type { ProbeDriver } from "./session";
import { NaverReviewExportSurfaceFixture, type NaverFixtureMode } from "./naver-fixture";

/** Sanitized semantic channel code for NAVER runs (contract `SEMANTIC_CODE`, never a title). */
export const NAVER_CHANNEL_CODE = "naver";
/** Dotted semantic copy key for NAVER runs — FE owns the final copy. */
export const NAVER_RUN_COPY_KEY = "actionWindow.run.naver";
/** Deterministic synthetic artifact ref for the (still synthetic) downstream chain. */
export const NAVER_FIXTURE_ARTIFACT_REF = artifactRefFor(["aw-naver-fixture-artifact"]);

type ExportCandidate = ReturnType<typeof findExportCandidates>[number];

/**
 * One-way 16-hex signature of the single located export control, following the collector's
 * deterministic-ID convention (SHA-256 over the JSON array form). The candidate's raw identity
 * (element id, wording keyword) feeds the hash and can never be recovered from it.
 */
function targetSigFor(c: ExportCandidate): string {
  const parts = ["aw-naver-fixture-target", c.tag, c.keyword, c.id ?? "", String(c.dataExportReview), String(c.inText), String(c.inAriaLabel), String(c.inTitle)];
  return createHash("sha256").update(JSON.stringify(parts)).digest("hex").slice(0, 16);
}

function surfaceBlockerFor(verdict: SessionVerdict): SurfaceBlockerCode {
  switch (verdict) {
    case "RECONNECT_REQUIRED":
      return "SESSION_EXPIRED";
    case "ACCOUNT_LOGIN_REQUIRED":
    case "AUTH_CHALLENGE_REQUIRED":
      return "LOGIN_REQUIRED";
    default:
      return "UNSUPPORTED_STATE";
  }
}

/**
 * TEST-VISIBLE sanitized diagnostic of the last `prepareSurface` — fixed enums only. It preserves
 * the readiness distinction the wire deliberately flattens (benign EXPORT_TARGET_EMPTY vs the
 * conservative EXPORT_TARGET_UNKNOWN halt). Never transported, never persisted, never logged.
 */
export interface NaverPrepareDiagnostic {
  verdict: SessionVerdict;
  readinessDecision?: ExportTargetReadiness["decision"];
  readinessState?: Extract<ExportTargetReadiness, { decision: "HALT" }>["state"];
  readinessReason?: ExportTargetReadiness["reason"];
}

export interface NaverFixtureDriverOptions {
  /** Synthetic downstream overrides (this slice never detects/saves/ingests anything real). */
  downstream?: {
    detect?: DownloadDetectResult;
    validate?: ArtifactValidateResult;
    ingest?: IngestResult;
  };
}

export class NaverFixtureProbeDriver implements ProbeDriver {
  readonly fixture: NaverReviewExportSurfaceFixture;
  /** TEST-VISIBLE call counters — prove the downstream never runs unless verify succeeded. */
  readonly downstreamCalls = { detect: 0, validate: 0, ingest: 0 };

  private readonly detectResult: DownloadDetectResult;
  private readonly validateResult: ArtifactValidateResult;
  private readonly ingestOutcome: IngestResult;
  private lastDiagnostic: NaverPrepareDiagnostic | null = null;

  private userActionResolve: ((observed: boolean) => void) | null = null;
  private pendingUserAction: boolean | null = null;

  constructor(mode: NaverFixtureMode, opts: NaverFixtureDriverOptions = {}) {
    this.fixture = new NaverReviewExportSurfaceFixture(mode);
    this.detectResult = opts.downstream?.detect ?? { detected: true, artifactRef: NAVER_FIXTURE_ARTIFACT_REF };
    this.validateResult = opts.downstream?.validate ?? { valid: true };
    this.ingestOutcome = opts.downstream?.ingest ?? { ok: true, processed: 1 };
  }

  /** Sanitized enums describing the last surface probe (test introspection only). */
  prepareDiagnostic(): NaverPrepareDiagnostic | null {
    return this.lastDiagnostic;
  }

  /**
   * Session verdict first (reconnect/login interstitials fail closed with their semantic code),
   * then the export-target readiness gate (zero exportable rows / ambiguous result halts BEFORE the
   * human checkpoint — the live false-alert finding, re-authored as a fail-closed probe).
   */
  prepareSurface(): Promise<SurfaceProbeResult> {
    const verdict = classifySessionVerdict(this.fixture.sessionSignals());
    if (verdict !== "LOGGED_IN") {
      this.lastDiagnostic = { verdict };
      return Promise.resolve({ ok: false, blockerCode: surfaceBlockerFor(verdict) });
    }
    const readiness = evaluateExportTargetReadiness(this.fixture.html());
    this.lastDiagnostic = {
      verdict,
      readinessDecision: readiness.decision,
      readinessReason: readiness.reason,
      ...(readiness.decision === "HALT" ? { readinessState: readiness.state } : {}),
    };
    if (readiness.decision !== "READY") {
      return Promise.resolve({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    }
    return Promise.resolve({ ok: true });
  }

  /**
   * The no-click layout planner decides whether this is the supported user-direct SYNC surface (an
   * async job affordance wins and is NOT supported); the pure candidate finder then feeds the
   * engine's fail-closed 0/1/many logic. The single candidate's identity is one-way hashed.
   */
  locate(): Promise<LocateResult> {
    const html = this.fixture.html();
    if (planExportAction(html).layout !== "SYNC_DOWNLOAD") return Promise.resolve({ count: 0 });
    const candidates = findExportCandidates(html);
    if (candidates.length !== 1) return Promise.resolve({ count: candidates.length });
    return Promise.resolve({ count: 1, sig: targetSigFor(candidates[0]!) });
  }

  /** No DOM to spotlight in the data fixture — the highlight is a no-op rest point. */
  highlight(): Promise<void> {
    return Promise.resolve();
  }

  armObserve(): Promise<void> {
    return Promise.resolve();
  }

  /** Resolves only when TEST code reports the user's action (mirrors `SyntheticProbeDriver`). */
  waitForUserAction(): Promise<boolean> {
    if (this.pendingUserAction !== null) {
      const v = this.pendingUserAction;
      this.pendingUserAction = null;
      return Promise.resolve(v);
    }
    return new Promise((resolve) => {
      this.userActionResolve = resolve;
    });
  }

  /**
   * Re-locate the target on the CURRENT (post-action) surface: a vanished or identity-changed
   * control is UI drift; an unchanged target without the expected completion signal is simply
   * not-verified (back to the checkpoint — never a false completion).
   */
  verify(expectedSig: string): Promise<VerifyResult> {
    const candidates = findExportCandidates(this.fixture.html());
    if (candidates.length !== 1 || targetSigFor(candidates[0]!) !== expectedSig) {
      return Promise.resolve({ verified: false, drift: true });
    }
    return Promise.resolve({ verified: this.fixture.completionSignalPresent(), drift: false });
  }

  /* ── downstream: SYNTHETIC in this slice (no real download, no quarantine save, no ingest) ── */
  detectDownload(): Promise<DownloadDetectResult> {
    this.downstreamCalls.detect += 1;
    return Promise.resolve(this.detectResult);
  }
  validateArtifact(_artifactRef: string): Promise<ArtifactValidateResult> {
    this.downstreamCalls.validate += 1;
    return Promise.resolve(this.validateResult);
  }
  ingest(_artifactRef: string): Promise<IngestResult> {
    this.downstreamCalls.ingest += 1;
    return Promise.resolve(this.ingestOutcome);
  }

  cleanup(): Promise<void> {
    this.userActionResolve = null;
    this.pendingUserAction = null;
    return Promise.resolve();
  }

  /**
   * TEST-ONLY: report that the user acted on (or did not act on) the target. On a real action the
   * fixture transitions exactly as the platform page would after the user's own click — the driver
   * still only observes.
   */
  completeUserAction(observed = true): void {
    if (observed) this.fixture.applyUserAction();
    if (this.userActionResolve) {
      const resolve = this.userActionResolve;
      this.userActionResolve = null;
      resolve(observed);
    } else {
      this.pendingUserAction = observed;
    }
  }
}
