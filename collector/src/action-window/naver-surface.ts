/**
 * **Shared NAVER export-surface decision core (R4, pure, offline).**
 *
 * The channel-specific, browser-free DECISIONS the NAVER Action Window drivers make about a
 * review-export surface — session precondition, target locate, and post-action verify — factored out
 * of `./naver-driver.ts` so BOTH the fixture driver and the live driver
 * (`./naver-live-driver.ts`) compute them from ONE source and can never disagree on what a usable
 * session, a single located target, or a verified transition is.
 *
 * The two drivers differ ONLY in how they obtain the surface inputs:
 *   - the fixture driver reads a pure data fixture (`fixture.sessionSignals()` / `fixture.html()`);
 *   - the live driver reads the real page (`page.url()` + `page.content()`), classifying the session
 *     through the SAME read-only §8-4 seam (`sessionVerdictFromContent`).
 * Once the `SessionVerdict` + rendered HTML are in hand, every decision below is identical.
 *
 * PURITY: string-in / structured-out only. No browser, no network, no fs, no click path. Every value
 * returned is a boolean, a fixed enum, a coarse bucket, or an opaque 16-hex signature — a candidate's
 * raw identity (element id / wording keyword) is one-way hashed into the signature and never leaves.
 *
 * Fail-closed mapping (already-reserved contract codes only):
 *   - session verdict RECONNECT_REQUIRED → `SESSION_EXPIRED`
 *   - session verdict ACCOUNT_LOGIN_REQUIRED / AUTH_CHALLENGE_REQUIRED → `LOGIN_REQUIRED`
 *   - session verdict UNKNOWN, or readiness HALT (empty / ambiguous / range) → `UNSUPPORTED_STATE`
 *     (the EMPTY-vs-UNKNOWN distinction is preserved in the driver-local diagnostic, not the wire)
 *   - 0 / many / non-sync layout at locate → engine fails `TARGET_NOT_FOUND` / `TARGET_AMBIGUOUS`
 *   - post-action target identity change → verify reports drift → engine fails `UI_DRIFT`
 */
import { createHash } from "node:crypto";
import type { SessionVerdict } from "../naver/session-verdict";
import { planExportAction } from "../naver/export-classify";
import { evaluateExportTargetReadiness, type ExportTargetReadiness } from "../naver/export-target-readiness";
import { findExportCandidates } from "../naver/review-export";
import { naverSurfaceBlockerFor } from "./naver-session-precondition";
import type { LocateResult, SurfaceProbeResult, VerifyResult } from "./engine";

/** Sanitized semantic channel code for NAVER runs (contract `SEMANTIC_CODE`, never a title). */
export const NAVER_CHANNEL_CODE = "naver";
/** Dotted semantic copy key for NAVER runs — FE owns the final copy. */
export const NAVER_RUN_COPY_KEY = "actionWindow.run.naver";

/** A single actionable export control, as returned by the pure candidate finder. */
export type ExportCandidate = ReturnType<typeof findExportCandidates>[number];

/**
 * One-way 16-hex signature of the single located export control, following the collector's
 * deterministic-ID convention (SHA-256 over the JSON array form). The candidate's raw identity
 * (element id, wording keyword) feeds the hash and can never be recovered from it. The `"…fixture…"`
 * seed prefix is an OPAQUE hash input kept verbatim from the original fixture driver so signatures
 * stay stable across the extraction — it is never a semantic claim and never leaves this module.
 */
export function targetSigFor(c: ExportCandidate): string {
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

/**
 * Session verdict first (reconnect/login interstitials fail closed with their semantic code), then
 * the export-target readiness gate (zero exportable rows / ambiguous result halts BEFORE the human
 * checkpoint — the live false-alert finding, re-authored as a fail-closed probe). Returns both the
 * wire `SurfaceProbeResult` and the driver-local diagnostic (fixed enums only).
 */
export function naverSurfaceDecision(
  verdict: SessionVerdict,
  html: string,
): { result: SurfaceProbeResult; diagnostic: NaverPrepareDiagnostic } {
  if (verdict !== "LOGGED_IN") {
    return { result: { ok: false, blockerCode: naverSurfaceBlockerFor(verdict) }, diagnostic: { verdict } };
  }
  const readiness = evaluateExportTargetReadiness(html);
  const diagnostic: NaverPrepareDiagnostic = {
    verdict,
    readinessDecision: readiness.decision,
    readinessReason: readiness.reason,
    ...(readiness.decision === "HALT" ? { readinessState: readiness.state } : {}),
  };
  if (readiness.decision !== "READY") {
    return { result: { ok: false, blockerCode: "UNSUPPORTED_STATE" }, diagnostic };
  }
  return { result: { ok: true }, diagnostic };
}

/**
 * The no-click layout planner decides whether this is the supported user-direct SYNC surface (an
 * async job affordance wins and is NOT supported); the pure candidate finder then feeds the engine's
 * fail-closed 0/1/many logic. The single candidate's identity is one-way hashed.
 */
export function naverLocateDecision(html: string): LocateResult {
  if (planExportAction(html).layout !== "SYNC_DOWNLOAD") return { count: 0 };
  const candidates = findExportCandidates(html);
  if (candidates.length !== 1) return { count: candidates.length };
  return { count: 1, sig: targetSigFor(candidates[0]!) };
}

/**
 * Re-locate the target on the CURRENT (post-action) surface: a vanished or identity-changed control
 * is UI drift; an unchanged target is verified iff the caller-supplied completion signal is present
 * (never a false completion). The completion signal is a surface concept the caller owns — the
 * fixture reads its oracle; the live driver, which has no proven post-action DOM completion marker
 * yet, passes a conservative value (see `./naver-live-driver.ts`).
 */
export function naverVerifyDecision(html: string, expectedSig: string, completionSignalPresent: boolean): VerifyResult {
  const candidates = findExportCandidates(html);
  if (candidates.length !== 1 || targetSigFor(candidates[0]!) !== expectedSig) {
    return { verified: false, drift: true };
  }
  return { verified: completionSignalPresent, drift: false };
}
