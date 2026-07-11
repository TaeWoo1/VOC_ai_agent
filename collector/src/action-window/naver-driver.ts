/**
 * **NAVER pilot channel driver — FIXTURE-ONLY (R4, G1-ratified, D-021).**
 *
 * The first channel-shaped `ProbeDriver`: it composes the existing READ-ONLY NAVER seams — the pure
 * session-verdict classifier, the export-target readiness gate, the no-click export-layout planner,
 * and the pure export-candidate finder — over the synthetic NAVER-shaped fixture
 * (`./naver-fixture.ts`). Upstream stages (prepare/locate/highlight/observe/verify) are real
 * compositions of those seams. Downstream, `downstream.real` opts into the REAL detect + validate
 * chain against the fixture's byte-carrying artifact: detect consumes the artifact the user's
 * action produced (absence → the timeout shape) and reports a nonce-seeded opaque 16-hex
 * `artifactRef` (the artifact's filename never influences the ref); validate runs the ratified
 * quarantine posture (`./quarantine.ts`: temporary save → extension + OOXML magic sniff → DELETE,
 * fail-closed when the delete fails). Ingest is real when `downstream.real.ingest` is configured: the
 * validated bytes are handed to an INJECTED upload callback (`AwIngestUploadFn`) that reaches the
 * existing `/api/uploads` path outside this module — the driver stays network-free (it never imports
 * `../upload`); only the sanitized `{ ok, processed }` crosses back. Absent that callback, ingest is
 * SYNTHETIC (a call counter) exactly as before.
 *
 * HARD BOUNDARIES (enforced by source-guard + privacy tests):
 *   - No live contact: no browser, no network, no direct fs — the driver reads the fixture object;
 *     only the quarantine module (injectable io) persists the temporary validation file.
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
import { createHash, randomUUID } from "node:crypto";
import { classifySessionVerdict, type SessionVerdict } from "../naver/session-verdict";
import { planExportAction } from "../naver/export-classify";
import { evaluateExportTargetReadiness, type ExportTargetReadiness } from "../naver/export-target-readiness";
import { findExportCandidates } from "../naver/review-export";
import { artifactRefFor } from "./artifact";
import { quarantineValidateBytes, sweepQuarantine, type QuarantineIo, type QuarantineVerdict } from "./quarantine";
import { naverSurfaceBlockerFor } from "./naver-session-precondition";
import type { AwIngestUploadFn } from "./ingest-handoff";
import type {
  ArtifactValidateResult,
  DownloadDetectResult,
  IngestResult,
  LocateResult,
  SurfaceProbeResult,
  VerifyResult,
} from "./engine";
import type { ProbeDriver } from "./session";
import {
  NaverReviewExportSurfaceFixture,
  type NaverFixtureDownload,
  type NaverFixtureDownloadShape,
  type NaverFixtureMode,
} from "./naver-fixture";

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

/** Opt-in REAL detect + quarantine-validate (+ optional real ingest handoff) configuration. */
export interface NaverRealDownstreamOptions {
  /** The gitignored quarantine directory for the temporary validation save. */
  quarantineDir: string;
  /** Injectable quarantine filesystem (tests exercise cleanup-failure shapes through it). */
  io?: QuarantineIo;
  headBytes?: number;
  /**
   * Opt-in real ingest handoff. When set, `ingest()` hands the validated bytes to this INJECTED
   * upload callback (which reaches `/api/uploads` outside this module) instead of returning a
   * synthetic result. The driver never imports the upload client — the capability is injected.
   */
  ingest?: { upload: AwIngestUploadFn };
}

export interface NaverFixtureDriverOptions {
  /** The artifact shape the user's action produces (forwarded to the fixture). */
  downloadShape?: NaverFixtureDownloadShape;
  downstream?: {
    /** Synthetic overrides — used only when `real` is NOT configured. */
    detect?: DownloadDetectResult;
    validate?: ArtifactValidateResult;
    ingest?: IngestResult;
    /** Opt-in REAL detect + quarantine validate over the fixture artifact. */
    real?: NaverRealDownstreamOptions;
  };
}

export class NaverFixtureProbeDriver implements ProbeDriver {
  readonly fixture: NaverReviewExportSurfaceFixture;
  /** TEST-VISIBLE call counters — prove the downstream never runs unless verify succeeded. */
  readonly downstreamCalls = { detect: 0, validate: 0, ingest: 0 };

  private readonly detectResult: DownloadDetectResult;
  private readonly validateResult: ArtifactValidateResult;
  private readonly ingestOutcome: IngestResult;
  private readonly real: NaverRealDownstreamOptions | undefined;
  private lastDiagnostic: NaverPrepareDiagnostic | null = null;
  private retainedDownload: NaverFixtureDownload | null = null;
  private lastQuarantineVerdict: QuarantineVerdict | null = null;

  private userActionResolve: ((observed: boolean) => void) | null = null;
  private pendingUserAction: boolean | null = null;

  constructor(mode: NaverFixtureMode, opts: NaverFixtureDriverOptions = {}) {
    this.fixture = new NaverReviewExportSurfaceFixture(mode, opts.downloadShape ?? "xlsx-valid");
    this.detectResult = opts.downstream?.detect ?? { detected: true, artifactRef: NAVER_FIXTURE_ARTIFACT_REF };
    this.validateResult = opts.downstream?.validate ?? { valid: true };
    this.ingestOutcome = opts.downstream?.ingest ?? { ok: true, processed: 1 };
    this.real = opts.downstream?.real;
  }

  /** Sanitized enums describing the last surface probe (test introspection only). */
  prepareDiagnostic(): NaverPrepareDiagnostic | null {
    return this.lastDiagnostic;
  }

  /** Sanitized booleans of the last quarantine validation (test introspection only — never wired). */
  lastQuarantine(): QuarantineVerdict | null {
    return this.lastQuarantineVerdict;
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
      return Promise.resolve({ ok: false, blockerCode: naverSurfaceBlockerFor(verdict) });
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

  /* ── downstream: REAL detect + quarantine validate when `downstream.real` is set (opt-in);
        synthetic results otherwise. Ingest stays SYNTHETIC in this slice — no backend handoff. ── */

  /**
   * REAL path: consume the artifact the user's action produced. Absence is the offline model of
   * DOWNLOAD_TIMEOUT. The emitted ref is seeded from a detection-local NONCE only — the artifact's
   * filename never influences it and never leaves the driver.
   */
  detectDownload(): Promise<DownloadDetectResult> {
    this.downstreamCalls.detect += 1;
    if (!this.real) return Promise.resolve(this.detectResult);
    const pending = this.fixture.takePendingDownload();
    if (!pending) return Promise.resolve({ detected: false });
    this.retainedDownload = pending;
    return Promise.resolve({ detected: true, artifactRef: artifactRefFor(["aw-naver-download", randomUUID()]) });
  }

  /**
   * REAL path: the ratified quarantine posture over the retained artifact — temporary save,
   * extension + OOXML magic sniff, then DELETE; a failed delete fails closed (verdict invalid).
   * Only the sanitized boolean crosses back to the engine.
   */
  async validateArtifact(artifactRef: string): Promise<ArtifactValidateResult> {
    this.downstreamCalls.validate += 1;
    if (!this.real) return this.validateResult;
    const retained = this.retainedDownload;
    // Keep the bytes for the ingest handoff when a real upload is configured; otherwise consume now
    // (byte-identical to the validate-only slice — the retained artifact is single-use).
    if (!this.real.ingest) this.retainedDownload = null;
    if (!retained) return { valid: false };
    const verdict = await quarantineValidateBytes(retained, {
      dir: this.real.quarantineDir,
      artifactRef,
      ...(this.real.io ? { io: this.real.io } : {}),
      ...(this.real.headBytes !== undefined ? { headBytes: this.real.headBytes } : {}),
    });
    this.lastQuarantineVerdict = verdict;
    return { valid: verdict.valid };
  }

  /**
   * REAL path (when `downstream.real.ingest` is set): hand the validated bytes to the injected upload
   * callback under the opaque `artifactRef` — the platform's suggested filename is never passed. Only
   * the sanitized `{ ok, processed }` crosses back; a non-`ok` outcome fails the run closed
   * (`UNSUPPORTED_STATE`, per the engine). Absent the callback, ingest stays SYNTHETIC.
   */
  async ingest(artifactRef: string): Promise<IngestResult> {
    this.downstreamCalls.ingest += 1;
    const upload = this.real?.ingest?.upload;
    if (!upload) return this.ingestOutcome;
    const retained = this.retainedDownload;
    this.retainedDownload = null;
    if (!retained) return { ok: false, processed: 0 };
    const outcome = await upload({ bytes: () => retained.bytes(), artifactRef });
    return { ok: outcome.ok, processed: outcome.processed };
  }

  cleanup(): Promise<void> {
    this.userActionResolve = null;
    this.pendingUserAction = null;
    this.retainedDownload = null;
    // Crash-window hygiene: nothing this driver quarantined may outlive the run.
    if (this.real) sweepQuarantine(this.real.quarantineDir, this.real.io ?? undefined);
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
