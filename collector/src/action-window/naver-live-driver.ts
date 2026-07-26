/**
 * **NAVER pilot channel driver — LIVE surface core (R4, fixture-first, NOT yet live-verified).**
 *
 * The live sibling of `./naver-driver.ts` (`NaverFixtureProbeDriver`): a `ProbeDriver` that drives the
 * Action Window loop over a REAL Playwright `Page` the seller navigated to, instead of a data fixture.
 * It composes the SAME channel decisions as the fixture driver (from `./naver-surface.ts`, so the two
 * can never disagree) and the SAME generic real-page seams the browser driver already uses
 * (overlay / observer / read-only download detection / quarantine), differing only in how it obtains
 * the surface: it reads `page.url()` + `page.content()` and classifies the session through the
 * read-only §8-4 seam (`sessionVerdictFromContent`) — never `setContent`, never a fixture.
 *
 * SCOPE OF THIS SLICE: the driver CORE, exercised against synthetic / fixture pages only. It is wired
 * to no live NAVER entrypoint (there is deliberately no live CLI here) and has NOT been run against a
 * real marketplace. The one genuinely live-DOM-dependent seam — binding the located export control so
 * the generic overlay/observer attach to it (`markExportTarget`) — applies the CONFIRMED sync export
 * wording rule in-page, but its behavior on real NAVER markup is a live-run finding (§6): it is proven
 * here only against synthetic pages, and any string/DOM disagreement fails closed.
 *
 * HARD BOUNDARIES (enforced by source-guard + privacy tests):
 *   - No target click: the SELLER acts. There is NO `simulateUserAction` hook and no target-click
 *     dispatch anywhere in this module — it only arms observation and reacts to a reported action.
 *   - No legacy capture path: it never imports `runExport` / `review-export`'s capture / the legacy
 *     `capture-export-same-session` trigger path.
 *   - Network-free: it never imports `../upload`; the ingest capability is INJECTED (`AwIngestUploadFn`).
 *   - fs only via quarantine: the driver holds the detected bytes in memory and hands them to the
 *     quarantine module (the ONLY sanctioned fs/validation owner); it writes no files itself.
 *   - Sanitized outputs only: counts, booleans, fixed enums, opaque 16-hex refs. No selector, URL,
 *     path, filename, page content, cookie, or token ever leaves this module.
 */
import { randomUUID } from "node:crypto";
import type { Download, Frame, Page } from "playwright";
import { artifactRefFor } from "./artifact";
import { artifactParseVerdict, type ArtifactParseVerdict } from "./artifact-parse";
import {
  quarantineValidateBytes,
  sweepQuarantine,
  type ByteDownloadLike,
  type QuarantineIo,
  type QuarantineVerdict,
} from "./quarantine";
import { mountOverlay, unmountOverlay } from "./overlay";
import { armObserver, disarmObserver, waitForUserAction } from "./observer";
import { STEP_PLAN, TOTAL_STEPS } from "./stages";
import { sessionVerdictFromContent } from "../naver/session-check";
import { settleExportSurface } from "../naver/export-surface-settle";
import {
  naverLocateDecision,
  naverSurfaceDecision,
  naverVerifyDecision,
  type NaverPrepareDiagnostic,
} from "./naver-surface";
import { selectedRangeFromValues } from "../naver/export-click-signals";
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

/**
 * The export-wording keywords the in-page target tagger matches on an element's accessible name.
 * Kept INLINE (not imported from the click-path module `review-export.ts`) so this driver's imports
 * stay clean for the source guard; a test asserts it stays equal to that module's
 * `EXPORT_WORDING_KEYWORDS`, so the two can never drift.
 */
export const EXPORT_TARGET_KEYWORDS: readonly string[] = ["엑셀", "다운로드", "내려받기", "excel", "download", "xlsx", "csv"];

/**
 * CONTEXT wording that marks a dialog as the review-export consent/notice dialog. Run 7 attempt 6
 * (dispatch §21) failed closed with `checkpoints:0` AGAIN despite #350: the live second control is a
 * GENERIC `확인`/`동의` whose export meaning lives in the surrounding modal body, not in the button
 * text — so own-wording matching (`EXPORT_TARGET_KEYWORDS` on the control) can never find it, and bare
 * global `확인` matching is unsafe. The contextual path (`markContinuationTarget` path B) requires the
 * dialog BODY to carry export meaning. Deliberately the export/Excel/download words ONLY — NOT the bare
 * review noun `리뷰`, which every review-management surface carries (a `리뷰 삭제` confirm dialog must not
 * read as an export dialog). A control is eligible only when it sits inside such a dialog — never on
 * wording alone, and the dialog scope is the INNERMOST cancel-enclosing container so page chrome (the
 * export toolbar, the page heading) can never satisfy the context at the body level.
 */
export const EXPORT_CONTEXT_KEYWORDS: readonly string[] = [...EXPORT_TARGET_KEYWORDS];

/**
 * GENERIC primary-action wording for the consent dialog's confirm/agree control — matched ONLY inside a
 * confirmed export-context dialog (never globally). These have no export meaning of their own; the
 * dialog context is what makes exactly one of them the export continuation.
 */
export const PRIMARY_ACTION_KEYWORDS: readonly string[] = ["확인", "동의", "ok", "confirm", "agree"];

/**
 * CANCEL/dismiss wording. Two jobs: it is excluded from primary-action candidates (a `취소`/`닫기` is
 * never the continuation), and a confirm+cancel pair inside a container is one of the signals that the
 * container is a dialog (alongside `role=dialog`/`aria-modal`).
 */
export const CANCEL_ACTION_KEYWORDS: readonly string[] = ["취소", "cancel", "닫기", "close", "아니오"];

/**
 * Sanitized phase describing the export-consent-dialog search on the last continuation poll (enum only,
 * no content — safe to log/introspect). Distinguishes the operator-requested diagnostics:
 *   - `"matched"`                  an export-context dialog with exactly one primary action was tagged;
 *   - `"export-dialog-no-action"`  an export-context dialog was found but it had no UNIQUE primary
 *                                  action (0, or ≥2 → ambiguous fail-closed) — attempt 6's live symptom;
 *   - `"no-export-dialog"`         NO export-context dialog was found in the CURRENT frame (the signal
 *                                  that the modal may be cross-frame — iframe traversal stays a separate,
 *                                  evidence-gated change, NOT done here);
 *   - `"none"`                     the dialog path was not the decider (an own-wording control matched,
 *                                  or nothing relevant appeared — e.g. the direct-download shape).
 */
export type DialogDiscoveryPhase = "none" | "matched" | "export-dialog-no-action" | "no-export-dialog";

/**
 * Operator-legible overlay labels for the headed live run, keyed by the step's semantic `copyKey`.
 *
 * The headed live/CLI run has NO product FE, so the only thing in the real Chrome window is the
 * overlay badge — which otherwise shows the raw dotted `copyKey`. This map gives the seated operator
 * a readable line AT the highlight, echoing the established Run-4 two-step finding (click the control,
 * then confirm the NAVER dialog per this run's scope). It is a diagnostic aid on a dev-only overlay,
 * NOT the product FE's localized copy, and it introduces no contract/STEP_PLAN change. An unmapped
 * key ⇒ the badge falls back to the `copyKey` (overlay default).
 */
const OPERATOR_STEP_LABELS: Readonly<Record<string, string>> = {
  "actionWindow.step.userTargetAction":
    "리뷰 내보내기 버튼을 클릭하세요. NAVER 확인창이 뜨면 이번 실행 범위 안에서 확인하세요.",
};

/**
 * Overlay label for the CONSENT checkpoint. In the normal NAVER review-export flow the export click
 * raises ONE in-page consent/notice dialog; the seller clicks its confirm/agree control and the
 * browser download then begins AUTOMATICALLY — it is NOT a separate "download button". This label
 * highlights that one consent/confirm control and tells the seller the download follows on its own.
 * (The engine can raise further checkpoints as a DEFENSIVE fallback — see `MAX_CONTINUATION_CHECKPOINTS`
 * — but one consent step is the expected choreography.) Dev-overlay copy only, like `OPERATOR_STEP_LABELS`.
 */
const CONTINUATION_STEP_LABEL =
  "NAVER 동의·확인 창이 나타났어요. 창의 확인·동의 버튼을 직접 클릭하시면 다운로드가 자동으로 시작됩니다.";

/**
 * DEFENSIVE upper bound on post-export consent/continuation checkpoints — NOT the choreography. The
 * NORMAL export flow is exactly ONE checkpoint: the export click raises a single in-page consent/notice
 * dialog, the seller confirms it, and the download begins automatically. This ceiling only guards a
 * pathological surface that keeps interposing further export-related controls without ever delivering a
 * download; hitting it fails closed like any other undetected download.
 */
const MAX_CONTINUATION_CHECKPOINTS = 3;

/**
 * OPERATOR-LOCAL export-scope read-back (never logged, never transported — see `readExportScope`).
 * The seller's own selected range/filters, reflected to their own console so they can confirm the
 * scope that will actually export.
 */
export interface ExportScopeReadback {
  /** Selected date/range control values, verbatim, for local operator display only. */
  rangeValues: string[];
  /** Active filter labels (chosen <select> option text, checked radio/checkbox labels). */
  filterLabels: string[];
}

/** Sanitized, TEST-VISIBLE record of the continuation checkpoints one detection pass walked. */
export interface ContinuationDiagnostic {
  /** How many continuation controls were highlighted (0 = the Run-4 direct-download shape). */
  checkpoints: number;
  /** The operator acted on the last highlighted continuation control. */
  observedLast: boolean;
  /** More than one candidate control appeared at once → failed closed on ambiguity. */
  ambiguous: boolean;
  /**
   * Sanitized export-consent-dialog search phase from the last poll (enum only). Lets a failed-closed
   * run distinguish "an export dialog was there but its action wasn't unique" from "no export dialog in
   * this frame at all" — the two cases the operator asked to tell apart after attempt 6.
   */
  dialog: DialogDiscoveryPhase;
}

/**
 * DEV-ONLY sanitized structural fingerprint of ONE eligible continuation candidate (the live-debug
 * sprint, 2026-07-24). Carries a synthetic local label and coarse structural buckets ONLY — never the
 * control's text, attributes, value, URL, or any user data. Safe to log and to show the operator.
 */
export interface CandidateLabel {
  /** Synthetic local identifier for the seated operator (`A1`, `A2`, `B1`…). Not derived from content. */
  label: string;
  /**
   * Which discovery path surfaced it: `"A"` own-wording, `"B"` generic-primary-in-export-dialog. Named
   * `via` (not `path`) deliberately — a `path` key is a prohibited-field name (URL/filesystem leakage).
   */
  via: "A" | "B";
  /** Coarse element-kind bucket — never the tag's text/attributes. */
  tagBucket: "button" | "anchor" | "role-button" | "input" | "roleless" | "other";
  /** Interactable (visible + enabled) at inspection time. */
  enabled: boolean;
  /** Sits inside a detected export-context dialog scope. */
  inExportDialog: boolean;
}

/**
 * DEV-ONLY sanitized inspection of the continuation candidates present on the failed poll (live-debug
 * sprint). Counts + per-candidate structural buckets ONLY — the operator-requested diagnostics. No raw
 * page text, attributes carrying user data, URLs, or content ever appear here.
 */
export interface CandidateInspection {
  /** Distinct export-context dialog scopes detected (outer, non-nested). */
  dialogCount: number;
  /** Path-A (own-wording) candidate count. */
  pathACount: number;
  /** Path-B (generic-primary-in-dialog) candidate count. */
  pathBCount: number;
  /** Candidates surfaced by BOTH paths (same element) — the a∩b overlap. */
  overlapCount: number;
  /** Per-candidate sanitized fingerprints, each with its overlaid label. */
  candidates: CandidateLabel[];
}

export interface NaverLiveProbeDriverOptions {
  /** The gitignored quarantine directory for the temporary validation save. */
  quarantineDir: string;
  /**
   * INJECTED ingest capability — the driver never imports `../upload`. Required on the live path: a
   * synthetic completion is never fabricated. Tests inject a fake returning `{ ok, processed }`.
   */
  ingest: AwIngestUploadFn;
  /** Injectable quarantine filesystem (tests exercise cleanup-failure shapes through it). */
  io?: QuarantineIo;
  headBytes?: number;
  observeTimeoutMs?: number;
  downloadTimeoutMs?: number;
  guidanceEnabled?: boolean;
  /**
   * Bounded window to let the review grid render before readiness is decided (§8-11 render-timing
   * fix). `prepareSurface` re-reads the resolved surface read-only until rows render or an explicit
   * empty/range marker appears; a bare empty container / ambiguous surface polls to this timeout and
   * then fails closed honestly. Defaults to `DEFAULT_READINESS_SETTLE_TIMEOUT_MS`.
   */
  readinessSettleTimeoutMs?: number;
  /** Poll cadence for the readiness settle. Defaults to `DEFAULT_READINESS_SETTLE_INTERVAL_MS`. */
  readinessSettleIntervalMs?: number;
  /** Injectable sleep for the readiness settle — hermetic tests pass an instant resolver. */
  sleepFn?: (ms: number) => Promise<void>;
  /**
   * Bounded window for the OPERATOR to act on a highlighted continuation checkpoint (the NAVER-native
   * follow-up notification/dialog observed on Run 7 attempt 2 — see `detectDownload`). Defaults to
   * `observeTimeoutMs`: it is the same kind of wait as the first human step, a seated human acting on
   * a highlighted control.
   */
  continuationObserveTimeoutMs?: number;
  /** Poll cadence for continuation-checkpoint appearance during the download race. Default 500 ms. */
  continuationPollMs?: number;
  /**
   * DEV-ONLY live-debug switch (the seated NAVER live-debug sprint, 2026-07-24). Default `false` ⇒ the
   * production continuation path is byte-for-byte unchanged. When `true`, a fail-closed continuation
   * outcome additionally overlays SANITIZED candidate labels (`A1`/`B1`…) and records structural buckets
   * via `inspectContinuationCandidates`, so a seated operator can name the real consent control. It never
   * changes what is clicked (the driver still never clicks) and never relaxes fail-closed by itself.
   */
  liveDebug?: boolean;
  /**
   * DEV-ONLY disambiguation hint (only consulted when `liveDebug`). A sanitized label such as `"B2"` the
   * operator identified as the real consent action. When set, `markContinuationTarget` HIGHLIGHTS the
   * candidate carrying that label instead of failing closed on ambiguity — the operator still performs the
   * click. An unresolvable/duplicate label falls through to the unchanged fail-closed decision. Never a
   * bare page match: the label only ever selects among the same Path-A/Path-B candidates.
   */
  continuationSelectLabel?: string;
}

/** Some bundlers inject `__name(...)` into serialized evaluate bodies — a harmless identity shim. */
const NAME_SHIM = "globalThis.__name = globalThis.__name || function (f) { return f; };";

/** Default bounded window / cadence for the readiness settle (live path; tests override to instant). */
export const DEFAULT_READINESS_SETTLE_TIMEOUT_MS = 8_000;
export const DEFAULT_READINESS_SETTLE_INTERVAL_MS = 500;

export class NaverLiveProbeDriver implements ProbeDriver {
  private readonly page: Page;
  private readonly opts: NaverLiveProbeDriverOptions;

  /** TEST-VISIBLE sanitized diagnostic of the last `prepareSurface` (fixed enums only, never wired). */
  private lastDiagnostic: NaverPrepareDiagnostic | null = null;
  /** TEST-VISIBLE booleans of the last quarantine validation (never wired). */
  private lastQuarantineVerdict: QuarantineVerdict | null = null;
  /** TEST-VISIBLE booleans of the last artifact parse check (never wired to transport/persistence). */
  private lastParseVerdict: ArtifactParseVerdict | null = null;
  /** TEST-VISIBLE sanitized record of the continuation checkpoints the last detection pass walked. */
  private lastContinuationDiagnostic: ContinuationDiagnostic | null = null;
  /** DEV-ONLY sanitized inspection of the candidates on the last fail-closed continuation poll. */
  private lastInspectionResult: CandidateInspection | null = null;
  /** Armed BEFORE the user acts (a download can fire the instant they click); resolved lazily. */
  private pendingDownload: Promise<Download | null> | null = null;
  /** The detected artifact buffered in memory (bytes re-readable for validate + ingest). */
  private retained: ByteDownloadLike | null = null;
  /**
   * The frame that actually hosts the export surface, resolved once in `prepareSurface`. NAVER's
   * review-management grid + export control can render inside a child frame (iframe/SPA) rather than the
   * top document — the Run-1 fail-closed (`UNSUPPORTED_STATE`) finding. All surface work (readiness read,
   * locate, tag, overlay, observer, verify) runs against THIS context; download detection stays
   * page-level (a download event is delivered to the page regardless of the originating frame). `null`
   * until `prepareSurface` runs → the getter falls back to the main frame, so a surface entirely in the
   * top document behaves exactly as before.
   */
  private surfaceFrame: Frame | null = null;

  constructor(page: Page, opts: NaverLiveProbeDriverOptions) {
    this.page = page;
    this.opts = opts;
  }

  /**
   * The execution context for all surface work: the resolved export-hosting frame, or the top document
   * (main frame) before/without resolution. `Page | Frame` because the overlay/observer seams accept
   * either; the fallback keeps the top-document path byte-for-byte identical to the pre-frame behavior.
   */
  private ctx(): Page | Frame {
    return this.surfaceFrame ?? this.page.mainFrame();
  }

  /**
   * The resolved surface context, for a driver that COMPOSES this one.
   *
   * Exposed because the import driver needs the same context for its own targets (the date inputs and the
   * apply control), and the first live run failed precisely because it read the top document instead: the
   * review surface is frame-hosted, so `page.content()` reported zero date inputs on a page that has them.
   * Sharing the resolution is also what stops locate and read-back from ever disagreeing about which
   * document they are looking at.
   *
   * Only meaningful after {@link prepareSurface} has run; before that it is the top document.
   */
  surfaceContext(): Page | Frame {
    return this.ctx();
  }

  /**
   * The top-level PAGE, whatever frame {@link surfaceContext} currently resolves to.
   *
   * Exposed for one purpose: lifecycle events belong to the page, not to a frame. The import driver listens for
   * `load` so it can re-draw its guidance panel after a navigation erases it — the login the run itself asked for
   * is the navigation that does this (see `naver-live-import-driver.keepPanelAcrossNavigation`).
   */
  surfacePage(): Page {
    return this.page;
  }

  /**
   * Whether a CHILD frame was resolved, as opposed to falling back to the top document.
   *
   * A diagnostic distinction that matters: "we looked in the right frame and found nothing" and "we never
   * left the top document" have the same symptom — a zero count — and completely different fixes.
   *
   * ⚠ Compared against the main frame, NOT against null. `resolveSurfaceFrame` assigns the MAIN frame as
   * its preference-3 fallback when nothing frame-hosts the surface, so a null check reports `true` for the
   * top document and the flag says the opposite of the truth. The first version of this accessor did
   * exactly that, and it made the second live run's log unreadable — a lying diagnostic is worse than none.
   */
  surfaceFrameResolved(): boolean {
    return this.surfaceFrame !== null && this.surfaceFrame !== this.page.mainFrame();
  }

  /**
   * How many child frames the page has, for the same diagnostic question. Structural: a count, never a URL
   * or a host — `iframePresent` alone cannot distinguish "the surface is in one of three frames we scored"
   * from "there is one unrelated analytics iframe".
   */
  childFrameCount(): number {
    return Math.max(0, this.page.frames().length - 1);
  }

  /**
   * Pick the frame that hosts the export surface. Scores the top document + every child frame with the
   * SAME shared decisions used downstream (`naverSurfaceDecision` for session+readiness, `naverLocateDecision`
   * for the single export control), so the choice can never disagree with what `prepareSurface`/`locate`
   * then decide. Preference: (1) a fully actionable frame (surface OK *and* exactly one export control),
   * else (2) any frame exposing exactly one export control (readiness may legitimately HALT there — an
   * honest empty), else (3) the top document — preserving today's diagnostics when nothing frame-hosts the
   * surface. A frame whose content can't be read (detached/racing) is skipped, never fatal. NO click, NO
   * navigation — read-only `content()` per frame.
   */
  private async resolveSurfaceFrame(
    verdict: Parameters<typeof naverSurfaceDecision>[0],
    topHtml: string,
  ): Promise<{ frame: Frame; html: string }> {
    const scored: Array<{ frame: Frame; html: string; ok: boolean; count: number }> = [];
    for (const frame of this.page.frames()) {
      let html: string;
      try {
        html = await frame.content();
      } catch {
        continue; // detached / cross-navigating frame — not a usable surface
      }
      scored.push({
        frame,
        html,
        ok: naverSurfaceDecision(verdict, html).result.ok === true,
        count: naverLocateDecision(html).count,
      });
    }
    return (
      scored.find((s) => s.ok && s.count === 1) ??
      scored.find((s) => s.count === 1) ??
      scored[0] ?? { frame: this.page.mainFrame(), html: topHtml }
    );
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
   * Sanitized booleans of the last artifact parse check (test introspection only — never wired).
   * `dataRowPresent` is the observed, non-gating signal: an empty-but-valid export reads `false`
   * here and still completes the run.
   */
  lastParse(): ArtifactParseVerdict | null {
    return this.lastParseVerdict;
  }

  /**
   * Read the REAL page as the seller left it and decide the precondition through the SAME §8-4 seam
   * the read-only probe uses (`sessionVerdictFromContent`) + the shared surface decision. No
   * `setContent`, no navigation, no click — a non-usable session or a not-ready export surface fails
   * closed with its reserved contract code BEFORE any surface work.
   */
  async prepareSurface(): Promise<SurfaceProbeResult> {
    // Session is a page-level property (login / reconnect / auth interstitials replace the whole page),
    // so the verdict is read from the top document — the exact §8-4 seam already proven live.
    const topHtml = await this.page.content();
    const verdict = sessionVerdictFromContent(topHtml, this.page.url());
    // Readiness + the export control can live in a child frame, so decide the surface on the frame that
    // hosts it (falling back to the top document). The chosen frame is cached for locate/highlight/verify.
    const { frame, html } = await this.resolveSurfaceFrame(verdict, topHtml);
    this.surfaceFrame = frame;
    // §8-11 render-timing fix: on a usable session, the review grid can render client-side AFTER we
    // reach the surface, so a single-shot read can see empty. Re-read the resolved frame read-only
    // until rows render (READY) or an explicit empty/range marker appears, within a bounded window;
    // a still-hydrating (bare empty container / ambiguous) surface polls to timeout and then fails
    // closed on that last observation. Non-usable sessions never hydrate into a surface — decide now.
    const surfaceHtml = verdict === "LOGGED_IN" ? await this.settleSurface(frame) : html;
    const { result, diagnostic } = naverSurfaceDecision(verdict, surfaceHtml);
    // D-025's "different detector": the pure decision above reads the serialized `value` ATTRIBUTE and is
    // structurally blind to an SPA picker whose selected range lives on the IDL PROPERTY. Overlay a
    // best-effort live `.value` read so the next click run emits BOTH signals and its falsifier becomes
    // discriminating. Observation only — never gates, and undefined on any read failure.
    if (verdict === "LOGGED_IN") {
      diagnostic.selectedRangePresentLive = await this.readSelectedRangeLive(frame);
    }
    this.lastDiagnostic = diagnostic;
    return result;
  }

  /**
   * Best-effort IDL-property read of the date/range controls' live `.value` (selector mirrors
   * `FILLED_DATE_INPUT_RE`'s targeting). The raw values are read in-page and reduced to a boolean here;
   * they NEVER leave this method — not logged, not persisted (strictly less exposure than the serialized
   * HTML already crossing this boundary via `page.content()`). Any failure — a navigating frame, no
   * control present — yields `undefined`, never a throw and never a halt (§8-23 posture).
   */
  private async readSelectedRangeLive(frame: Frame): Promise<boolean | undefined> {
    try {
      const values = await frame.evaluate(() =>
        Array.from(
          document.querySelectorAll(
            'input[type="date"], input[class*="date"], input[class*="calendar"], input[class*="picker"]',
          ),
        ).map((el) => (el as HTMLInputElement).value ?? ""),
      );
      return selectedRangeFromValues(values);
    } catch {
      return undefined;
    }
  }

  /**
   * OPERATOR-LOCAL export-scope read-back (Run 7 attempt-3 finding: the operator confirmed §8 on a
   * view that differed from the range that actually exported). Reads the selected date/range control
   * values and any active filter labels from the export surface so the CLI can show the seller the
   * scope that WILL export — letting them confirm the real range, not merely a review visible
   * elsewhere on the page.
   *
   * ⚠ **This is the ONE place raw selected values are surfaced, and ONLY to the seated operator's own
   * console (stderr).** The values NEVER reach `log()`, the persisted run, or any Aw wire message —
   * they are the operator's own filter selection reflected back to them locally, categorically
   * distinct from anything crossing the sanitization boundary (§3). The caller must print, never log.
   * Any read failure yields an empty read-back rather than a throw (§8-23 posture).
   */
  async readExportScope(): Promise<ExportScopeReadback> {
    try {
      return await this.ctx().evaluate(() => {
        const rangeValues = Array.from(
          document.querySelectorAll(
            'input[type="date"], input[class*="date"], input[class*="calendar"], input[class*="picker"]',
          ),
        )
          .map((el) => (el as HTMLInputElement).value ?? "")
          .filter((v) => v.trim() !== "");
        const filterLabels: string[] = [];
        // Active <select> choices (the chosen option text) and checked radios/checkboxes' labels.
        for (const sel of Array.from(document.querySelectorAll("select"))) {
          const s = sel as HTMLSelectElement;
          const opt = s.selectedOptions[0];
          if (opt && opt.textContent && opt.textContent.trim() !== "") filterLabels.push(opt.textContent.trim());
        }
        for (const el of Array.from(document.querySelectorAll('input[type="radio"]:checked, input[type="checkbox"]:checked'))) {
          const label = (el as HTMLInputElement).labels?.[0]?.textContent?.trim();
          if (label) filterLabels.push(label);
        }
        return { rangeValues, filterLabels };
      });
    } catch {
      return { rangeValues: [], filterLabels: [] };
    }
  }

  /** Read-only bounded poll for the export grid to render before readiness is decided (§8-11). */
  private async settleSurface(frame: Frame): Promise<string> {
    const settled = await settleExportSurface({
      timeoutMs: this.opts.readinessSettleTimeoutMs ?? DEFAULT_READINESS_SETTLE_TIMEOUT_MS,
      intervalMs: this.opts.readinessSettleIntervalMs ?? DEFAULT_READINESS_SETTLE_INTERVAL_MS,
      readHtml: () => frame.content(),
      ...(this.opts.sleepFn ? { sleepFn: this.opts.sleepFn } : {}),
    });
    return settled.html;
  }

  /**
   * Locate over the LIVE content via the shared no-click decision (0/1/many → engine fail-closed),
   * then — only for the single-candidate case — bind that control in-page so the generic overlay /
   * observer can attach. The in-page tag count is cross-checked against the string decision; any
   * disagreement fails closed (returns the divergent count, no tag left behind).
   */
  async locate(): Promise<LocateResult> {
    const decision = naverLocateDecision(await this.ctx().content());
    if (decision.count !== 1) return decision;
    await this.ctx().evaluate(NAME_SHIM);
    const tagged = await this.markExportTarget();
    if (tagged !== 1) return { count: tagged };
    return decision;
  }

  /** Spotlight the bound target (pointer-events:none overlay — it can never intercept the click). */
  async highlight(): Promise<void> {
    await this.ctx().evaluate(NAME_SHIM);
    const humanStep = STEP_PLAN[1]!;
    await mountOverlay(this.ctx(), {
      stepNumber: humanStep.stepNumber,
      totalSteps: TOTAL_STEPS,
      copyKey: humanStep.copyKey,
      label: OPERATOR_STEP_LABELS[humanStep.copyKey],
      guidanceEnabled: this.opts.guidanceEnabled ?? true,
    });
  }

  /** Arm the read-only download listener EARLY (a sync export fires on click) + the click observer. */
  async armObserve(): Promise<void> {
    if (!this.pendingDownload) {
      // timeout: 0 disables Playwright's own timeout; detectDownload() races the deadline instead.
      // Download detection stays PAGE-level: the event is delivered to the page no matter which frame
      // originated it, so a control in a child frame still yields the download here.
      this.pendingDownload = this.page.waitForEvent("download", { timeout: 0 }).catch(() => null);
    }
    await this.ctx().evaluate(NAME_SHIM);
    await armObserver(this.ctx());
  }

  /** Wait for the SELLER's own action on the target — the driver NEVER clicks or simulates it. */
  waitForUserAction(): Promise<boolean> {
    return waitForUserAction(this.ctx(), { timeoutMs: this.opts.observeTimeoutMs ?? 15_000 });
  }

  /**
   * Re-locate over the current content and confirm the target did not drift. There is NO proven
   * post-action DOM completion marker for live NAVER yet (a live-run finding, §6); the observed user
   * action plus a non-drifted target authorize proceeding to READ-ONLY download detection, which is
   * the actual artifact evidence and fails closed (`DOWNLOAD_TIMEOUT`) when the action produced none.
   */
  async verify(expectedSig: string): Promise<VerifyResult> {
    return naverVerifyDecision(await this.ctx().content(), expectedSig, true);
  }

  /**
   * READ-ONLY download detection for the normal NAVER export choreography, with a defensive fallback.
   *
   * NORMAL FLOW — two seller clicks in total: the seller clicks the export control; NAVER raises ONE
   * in-page consent/notice dialog; the driver detects that single consent/confirm control, re-tags and
   * HIGHLIGHTS it, and WAITS for the seller's own click on it — it never clicks; the seller confirms,
   * and the browser download then begins AUTOMATICALLY, which the armed listener detects. That is the
   * whole expected path: exactly ONE consent checkpoint after the export click, then the download.
   *
   * Two variants the same loop absorbs: (a) the Run-4 shape, where the confirm fires the download with
   * no separately-highlightable control — the armed download simply wins the race, ZERO checkpoints;
   * and (b) a DEFENSIVE fallback — only if after the consent NO download follows AND another clearly
   * export-related control appears is it highlighted as a further checkpoint, up to
   * `MAX_CONTINUATION_CHECKPOINTS`. That guards a pathological surface; it is NOT the tutorial flow.
   *
   * While the race waits, the driver polls read-only for a NEW single wording-matched control (the
   * original stays excluded by identity). Bounded everywhere: ≥2 simultaneous candidates → ambiguous →
   * fail closed; no action inside the continuation observe window → fail closed; more than
   * `MAX_CONTINUATION_CHECKPOINTS` → fail closed; and absence of both a download and a control at any
   * deadline → the unchanged `DOWNLOAD_TIMEOUT` shape.
   *
   * A detected download is buffered into memory (bytes re-readable for validate + ingest), the
   * browser's own copy is dropped, and only a nonce-seeded opaque 16-hex ref is emitted — the
   * filename / path / URL never influence the ref or leave this scope.
   */
  async detectDownload(): Promise<DownloadDetectResult> {
    const timeoutMs = this.opts.downloadTimeoutMs ?? 15_000;
    const armed = this.pendingDownload ?? this.page.waitForEvent("download", { timeout: 0 }).catch(() => null);
    this.pendingDownload = armed;
    const diagnostic: ContinuationDiagnostic = { checkpoints: 0, observedLast: false, ambiguous: false, dialog: "none" };
    this.lastContinuationDiagnostic = diagnostic;
    this.lastInspectionResult = null; // DEV: fresh per attempt
    try {
      for (let checkpoint = 0; checkpoint <= MAX_CONTINUATION_CHECKPOINTS; checkpoint += 1) {
        const outcome = await this.raceDownloadOrContinuation(armed, timeoutMs);
        if (outcome.kind === "download") return await this.bufferDetected(outcome.download);
        if (outcome.kind === "timeout") {
          diagnostic.dialog = outcome.dialog; // WHY no control was found this frame (sanitized enum)
          if (this.opts.liveDebug) await this.captureInspection();
          return { detected: false };
        }
        if (outcome.kind === "ambiguous") {
          diagnostic.ambiguous = true;
          diagnostic.dialog = outcome.dialog;
          if (this.opts.liveDebug) await this.captureInspection(); // DEV: label the candidates for the operator
          return { detected: false }; // fail closed: 2+ candidate controls is ambiguity, never a guess
        }
        // outcome.kind === "continuation": exactly ONE new control is now the tagged target.
        diagnostic.checkpoints = checkpoint + 1;
        diagnostic.dialog = outcome.dialog;
        diagnostic.observedLast = false;
        const humanStep = STEP_PLAN[1]!;
        await mountOverlay(this.ctx(), {
          stepNumber: humanStep.stepNumber,
          totalSteps: TOTAL_STEPS,
          copyKey: humanStep.copyKey,
          label: CONTINUATION_STEP_LABEL,
          guidanceEnabled: this.opts.guidanceEnabled ?? true,
        });
        await this.ctx().evaluate(NAME_SHIM);
        await armObserver(this.ctx());
        const observed = await waitForUserAction(this.ctx(), {
          timeoutMs: this.opts.continuationObserveTimeoutMs ?? this.opts.observeTimeoutMs ?? 15_000,
        });
        diagnostic.observedLast = observed;
        if (!observed) return { detected: false }; // fail closed: the checkpoint was never acted on
        // Loop: the action either fires the download (next race wins) or raises the NEXT checkpoint.
      }
      return { detected: false }; // fail closed: checkpoint cap reached without a download
    } finally {
      this.pendingDownload = null;
    }
  }

  /**
   * Race the armed download against the deadline while polling read-only for a NEW continuation
   * control. Iteration-count accounting (the sentinel-wait convention): `deadlineMs` is spent in
   * `pollMs` slices, so the budget never depends on a wall-clock read.
   */
  private async raceDownloadOrContinuation(
    armed: Promise<Download | null>,
    deadlineMs: number,
  ): Promise<
    | { kind: "download"; download: Download }
    | { kind: "timeout"; dialog: DialogDiscoveryPhase }
    | { kind: "ambiguous"; dialog: DialogDiscoveryPhase }
    | { kind: "continuation"; dialog: DialogDiscoveryPhase }
  > {
    const pollMs = this.opts.continuationPollMs ?? 500;
    const sleep = this.opts.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxChecks = Math.max(1, Math.ceil(deadlineMs / pollMs));
    const TICK = Symbol("tick");
    let lastDialog: DialogDiscoveryPhase = "none"; // the most recent poll's dialog phase, for the timeout shape
    for (let i = 0; i < maxChecks; i += 1) {
      const winner = await Promise.race([armed, sleep(pollMs).then(() => TICK as typeof TICK)]);
      if (winner !== TICK) {
        // The armed promise settled: a download, or null (page/context gone) → the timeout shape.
        return winner ? { kind: "download", download: winner as Download } : { kind: "timeout", dialog: lastDialog };
      }
      const { count, dialog } = await this.markContinuationTarget().catch(() => ({ count: 0, dialog: "none" as const }));
      lastDialog = dialog;
      if (count === 1) return { kind: "continuation", dialog };
      if (count >= 2) return { kind: "ambiguous", dialog };
    }
    return { kind: "timeout", dialog: lastDialog };
  }

  /** Buffer a detected download into memory and emit the opaque ref (shared detection tail). */
  private async bufferDetected(download: Download): Promise<DownloadDetectResult> {
    const filename = download.suggestedFilename();
    const bytes = await bufferDownload(download);
    // We hold the bytes in memory; the browser's own temp copy is no longer needed.
    await download.delete().catch(() => {});
    this.retained = { suggestedFilename: () => filename, bytes: () => bytes };
    return { detected: true, artifactRef: artifactRefFor(["aw-naver-live-download", randomUUID()]) };
  }

  /**
   * Sanitized record of the continuation checkpoints the last `detectDownload` walked
   * (test introspection + CLI logging only — never wired to transport/persistence).
   */
  lastContinuation(): ContinuationDiagnostic | null {
    return this.lastContinuationDiagnostic;
  }

  /**
   * DEV-ONLY sanitized inspection of the continuation candidates on the last fail-closed poll (null
   * until a `liveDebug` run inspects one). CLI logging + test introspection only — never transported.
   */
  lastInspection(): CandidateInspection | null {
    return this.lastInspectionResult;
  }

  /**
   * Validate the buffered artifact: the ratified quarantine posture (temporary save → extension +
   * OOXML magic sniff → DELETE; a failed delete fails closed) AND the parse gate. The bytes are
   * RETAINED for the ingest handoff; only the sanitized boolean crosses back to the engine.
   *
   * **Why the parse gate is here and not at the ingest handoff.** The quarantine sniff reads ZIP
   * magic plus the `[Content_Types].xml` entry NAME in the head — a payload can satisfy both and not
   * be a workbook. Refusing such an artifact at the *handoff* would surface as `INGEST_FAILED`,
   * whose seller-facing copy says storage failed and to retry later: both false, and the retry is
   * useless. Refusing it HERE surfaces as `ARTIFACT_INVALID` — "받은 파일을 확인할 수 없어요 /
   * 다시 내려받아 주세요" — which is true and actionable.
   *
   * ⚠ `dataRowPresent` does NOT participate. A valid workbook carrying only a header row is a
   * legitimate seller outcome (an export of a quiet range), and a real one has been observed; failing
   * the run on it would tell a seller their correct export was broken.
   */
  async validateArtifact(artifactRef: string): Promise<ArtifactValidateResult> {
    const retained = this.retained;
    if (!retained) return { valid: false };
    const verdict = await quarantineValidateBytes(retained, {
      dir: this.opts.quarantineDir,
      artifactRef,
      ...(this.opts.io ? { io: this.opts.io } : {}),
      ...(this.opts.headBytes !== undefined ? { headBytes: this.opts.headBytes } : {}),
    });
    this.lastQuarantineVerdict = verdict;
    const parse = artifactParseVerdict(retained.bytes());
    this.lastParseVerdict = parse;
    return { valid: verdict.valid && parse.parseOk };
  }

  /**
   * Hand the validated bytes to the INJECTED upload callback under the opaque `artifactRef` (the
   * platform's suggested filename is never passed). Only the sanitized `{ ok, processed }` crosses
   * back; a non-`ok` outcome fails the run closed (`INGEST_FAILED`, per the engine).
   */
  async ingest(artifactRef: string): Promise<IngestResult> {
    const retained = this.retained;
    this.retained = null;
    if (!retained) return { ok: false, processed: 0 };
    const outcome = await this.opts.ingest({ bytes: () => retained.bytes(), artifactRef });
    return { ok: outcome.ok, processed: outcome.processed };
  }

  /** Tear down overlay/observer, drop any retained/late download, sweep quarantine, untag. Idempotent. */
  async cleanup(): Promise<void> {
    this.retained = null;
    const pending = this.pendingDownload;
    this.pendingDownload = null;
    if (pending) {
      void pending.then((late) => (late ? late.delete().catch(() => {}) : undefined)).catch(() => {});
    }
    // Crash-window hygiene: nothing this driver quarantined may outlive the run.
    sweepQuarantine(this.opts.quarantineDir, this.opts.io ?? undefined);
    // Tear the overlay/observer/tag down in the SAME frame they were mounted in.
    const ctx = this.ctx();
    await unmountOverlay(ctx).catch(() => {});
    await disarmObserver(ctx).catch(() => {});
    await this.unmarkExportTarget().catch(() => {});
    this.surfaceFrame = null;
  }

  /**
   * In-page: bind the single actionable export control with `data-aw-target` so the generic overlay /
   * observer attach to it. Applies the confirmed export-wording rule (interactive, visible + enabled,
   * accessible-name keyword match) and tags AT MOST one; returns how many it matched so `locate` can
   * cross-check against the string decision and fail closed on disagreement. Read-only annotation
   * only — it NEVER clicks. Proven against synthetic pages; real-NAVER behavior is a live-run finding.
   */
  private markExportTarget(): Promise<number> {
    return this.ctx().evaluate((keywords: readonly string[]) => {
      const w = window as unknown as { getComputedStyle(e: Element): CSSStyleDeclaration };
      document.querySelectorAll("[data-aw-target]").forEach((el) => {
        el.removeAttribute("data-aw-target");
        el.removeAttribute("data-aw-role");
        el.removeAttribute("data-aw-label");
      });
      const kws = keywords.map((k) => k.toLowerCase());
      const visibleEnabled = (el: Element): boolean => {
        const style = w.getComputedStyle(el);
        if (style.display === "none" || style.visibility === "hidden") return false;
        if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
        if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false;
        if (el.getAttribute("type") === "hidden") return false;
        return true;
      };
      const accessibleName = (el: Element): string => {
        const text = el.textContent ?? "";
        const value = el.getAttribute("value") ?? "";
        const aria = el.getAttribute("aria-label") ?? "";
        const title = el.getAttribute("title") ?? "";
        return `${text} ${value} ${aria} ${title}`.toLowerCase();
      };
      const selector = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
      const matches = Array.from(document.querySelectorAll(selector)).filter(
        (el) => visibleEnabled(el) && kws.some((k) => accessibleName(el).includes(k)),
      );
      if (matches.length === 1) {
        const el = matches[0]!;
        el.setAttribute("data-aw-target", "");
        el.setAttribute("data-aw-role", "primary-action");
        el.setAttribute("data-aw-label", "review-export");
      }
      return matches.length;
    }, this.exportKeywords());
  }

  /**
   * In-page, atomic: find the NEW single continuation control after the export click, by TWO
   * disjoint paths, and (on exactly one combined match) MOVE the tag to it. The CURRENT
   * `[data-aw-target]` and every `data-aw-seen` element are excluded, so the original export control
   * can never be re-matched. Read-only otherwise — it NEVER clicks. Returns `{ count, dialog }`:
   * `count` drives the race (0 keep waiting / 1 tag&continue / ≥2 ambiguous fail-closed); `dialog` is
   * a sanitized enum for the failed-closed diagnosis (see `DialogDiscoveryPhase`).
   *
   *   Path A — OWN-WORDING control (unchanged from #350): a native-or-role-less clickable whose OWN
   *   accessible name carries export wording (`엑셀 다운로드` etc.). Covers the labelled download
   *   button and the attempt-4 role-less clickable.
   *
   *   Path B — CONTEXTUAL DIALOG (Run 7 attempt 6, dispatch §21): a GENERIC `확인`/`동의` control whose
   *   export meaning lives in the SURROUNDING modal, not its text. Eligible ONLY when it sits inside an
   *   export-context dialog — a container that (has `role=dialog`/`alertdialog`/`aria-modal` OR carries
   *   a confirm+cancel footer) AND whose body text has export context. Never bare-`확인` global matching.
   *
   * Fail-closed carries over: ≥2 combined matches → ambiguous; ≥2 distinct export dialogs OR ≥2 primary
   * actions → ambiguous; the cancel control is excluded. Frame scope is the CURRENT frame only — iframe
   * traversal is deliberately NOT added here (a `dialog === "no-export-dialog"` diagnostic is what would
   * later justify it, on evidence).
   */
  private markContinuationTarget(): Promise<{ count: number; dialog: DialogDiscoveryPhase }> {
    return this.ctx().evaluate(
      (kw: {
        own: readonly string[];
        context: readonly string[];
        primary: readonly string[];
        cancel: readonly string[];
        /** DEV-ONLY operator-chosen label (`"B2"`); `null` on the production path — see below. */
        selectLabel: string | null;
      }) => {
        const w = window as unknown as { getComputedStyle(e: Element): CSSStyleDeclaration } & Record<string, unknown>;
        const current = document.querySelector("[data-aw-target]");
        const OWN = kw.own.map((k) => k.toLowerCase());
        const CTX = kw.context.map((k) => k.toLowerCase());
        const PRIMARY = kw.primary.map((k) => k.toLowerCase());
        const CANCEL = kw.cancel.map((k) => k.toLowerCase());
        // Persistent exclusion: `data-aw-seen` stamps every control this run has EVER highlighted, so a
        // checkpoint removed by its own click cannot let the (untagged) original re-match. `cleanup()` unstamps.
        const seen = (el: Element): boolean => el.hasAttribute("data-aw-seen");
        const visibleEnabled = (el: Element): boolean => {
          const style = w.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
          if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false;
          if (el.getAttribute("type") === "hidden") return false;
          return true;
        };
        const accessibleName = (el: Element): string => {
          const text = el.textContent ?? "";
          const value = el.getAttribute("value") ?? "";
          const aria = el.getAttribute("aria-label") ?? "";
          const title = el.getAttribute("title") ?? "";
          return `${text} ${value} ${aria} ${title}`.toLowerCase();
        };
        const nameHas = (el: Element, set: string[]): boolean => {
          const n = accessibleName(el);
          return set.some((k) => n.includes(k));
        };
        // LEADING-boundary match for the GENERIC action keywords (Run 7 attempt-7 live finding): a bare
        // substring made a persistent page button `사업자정보확인` match `확인` and get tagged instead of
        // the consent action. Require the keyword NOT to be preceded by a letter/number, so a prefixed
        // compound (`정보확인`) is excluded while a suffixed action form (`확인하기`, `동의합니다`) still
        // matches. Used for PRIMARY + CANCEL only; own-wording/context stay substring.
        const WORDCHAR = /[\p{L}\p{N}]/u;
        const nameHasWord = (el: Element, set: string[]): boolean => {
          const n = accessibleName(el);
          return set.some((k) => {
            for (let from = 0, idx = n.indexOf(k, from); idx !== -1; from = idx + 1, idx = n.indexOf(k, from)) {
              const before = idx > 0 ? n[idx - 1]! : "";
              if (!before || !WORDCHAR.test(before)) return true;
            }
            return false;
          });
        };
        const ctxHas = (el: Element): boolean => {
          const t = (el.textContent ?? "").toLowerCase();
          return CTX.some((k) => t.includes(k));
        };
        // A role-less clickable is discriminated by an OWN pointer cursor (`cursor` INHERITS, so a bare
        // `=== "pointer"` would also match inheriting children / instructional text — false candidates).
        const NATIVE = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
        const introducesPointer = (el: Element): boolean => {
          if (w.getComputedStyle(el).cursor !== "pointer") return false;
          const parent = el.parentElement;
          return !parent || w.getComputedStyle(parent).cursor !== "pointer";
        };
        const isClickable = (el: Element): boolean => el.matches(NATIVE) || introducesPointer(el);
        const eligible = (el: Element): boolean => el !== current && !seen(el) && visibleEnabled(el);
        const all = Array.from(document.querySelectorAll("*"));

        // -------- Path A: OWN-WORDING controls (preserved #350 behavior) --------
        let aMatches = all.filter((el) => eligible(el) && isClickable(el) && nameHas(el, OWN));
        // Innermost-only: a native control nested in a clickable wrapper collapses to the tightest.
        aMatches = aMatches.filter((el) => !aMatches.some((o) => o !== el && el.contains(o)));

        // -------- Path B: GENERIC primary action inside an export-context dialog --------
        const isDialogRole = (el: Element): boolean => {
          const role = (el.getAttribute("role") ?? "").toLowerCase();
          return role === "dialog" || role === "alertdialog" || el.getAttribute("aria-modal") === "true";
        };
        const cancelCands = all.filter((el) => visibleEnabled(el) && isClickable(el) && nameHasWord(el, CANCEL));
        const primaryCands = all.filter(
          (el) => eligible(el) && isClickable(el) && nameHasWord(el, PRIMARY) && !nameHasWord(el, CANCEL),
        );
        // The dialog SCOPE of a primary action is the INNERMOST ancestor that encloses it AND either is
        // an ARIA dialog OR contains a cancel candidate (a confirm+cancel container) — the confirm+cancel
        // pair is the signal that over-matching the base page can't fake. We stop at that innermost
        // container and require export context ON IT: we never keep climbing to a bigger ancestor, so the
        // page toolbar / heading at <body> level can never promote a non-export dialog. A dialog whose
        // buttons are footer-wrapped WITHOUT context in the footer is reported (no-export-dialog), not
        // force-matched — that is an honest signal to refine on evidence, not a speculative climb.
        // The dialog SCOPE of a primary action (Run 7 attempt-7 live finding — the real NAVER consent
        // modal splits its notice TEXT into `.modal-body` and its buttons into `.modal-footer`, so the
        // innermost cancel-enclosing box `.seller-btn-area` has NO export text). Resolution order:
        //   1) an ARIA dialog ancestor (`role=dialog/alertdialog/aria-modal`) is THE modal boundary —
        //      climb PAST the ctx-less footer to it; context must live anywhere inside it. This is what
        //      real framework modals (angular-ui-bootstrap etc.) expose, and it cannot promote page chrome
        //      because the climb stops AT the dialog element, never at `<body>`.
        //   2) else the innermost cancel-enclosing ancestor, context required ON it (unchanged tight
        //      behavior for a same-container dialog; a role-less footer/body split is NOT force-matched).
        // Bounded to stop before `<body>` so the page toolbar/heading can never become the scope.
        const dialogScopeFor = (node: Element): Element | null => {
          let el: Element | null = node.parentElement;
          let cancelScope: Element | null = null; // innermost cancel-enclosing ancestor (non-ARIA fallback)
          while (el && el !== document.body) {
            const cur = el; // stable capture: the nested closure must not see a reassignable `el`
            if (isDialogRole(cur)) return ctxHas(cur) ? cur : null; // ARIA dialog = the scope boundary
            if (!cancelScope && cancelCands.some((c) => cur.contains(c))) cancelScope = cur;
            el = cur.parentElement;
          }
          return cancelScope && ctxHas(cancelScope) ? cancelScope : null;
        };
        const bMatches: Element[] = [];
        const scopes: Element[] = [];
        for (const p of primaryCands) {
          const s = dialogScopeFor(p);
          if (!s) continue;
          bMatches.push(p);
          if (!scopes.includes(s)) scopes.push(s);
        }

        // Shared tag-move: drop the tag/observer from `current` and stamp it onto `el` (used by the
        // DEV select branch and the production count===1 branch below — identical mechanics).
        const moveTagTo = (el: Element): void => {
          if (current) {
            const handler = w["__aw_observer_handler__"];
            if (typeof handler === "function") current.removeEventListener("click", handler as EventListener);
            current.removeAttribute("data-aw-target");
            current.removeAttribute("data-aw-role");
            current.removeAttribute("data-aw-label");
            current.setAttribute("data-aw-seen", "");
          }
          el.setAttribute("data-aw-target", "");
          el.setAttribute("data-aw-role", "primary-action");
          el.setAttribute("data-aw-label", "review-export-continuation");
          el.setAttribute("data-aw-seen", "");
        };

        // -------- DEV select branch: honor the operator-identified label, else fall through --------
        // Only reachable when the CLI passed a hint (liveDebug). Labels are assigned by path order over
        // the SAME aMatches/bMatches the inspection overlays, so `"B2"` here is the same element the
        // operator saw. It only HIGHLIGHTS that candidate — the operator still clicks. An unresolvable or
        // duplicate label does NOT force a guess: it falls through to the unchanged decision (fail closed).
        if (kw.selectLabel) {
          const m = /^([AB])(\d+)$/.exec(kw.selectLabel);
          if (m) {
            const idx = parseInt(m[2]!, 10) - 1;
            const arr = m[1] === "A" ? aMatches : bMatches;
            const picked = idx >= 0 && idx < arr.length ? arr[idx]! : null;
            if (picked && eligible(picked)) {
              moveTagTo(picked);
              return { count: 1, dialog: "matched" as const };
            }
          }
          // hint unresolvable → do not force; continue to the unchanged production decision.
        }
        // Also count export-context ARIA dialogs that carry NO primary-keyword action at all, so a
        // present-but-actionless dialog is still reported (export-dialog-no-action, not no-export-dialog).
        const ariaExportDialogs = all.filter((el) => visibleEnabled(el) && isDialogRole(el) && ctxHas(el));
        for (const d of ariaExportDialogs) if (!scopes.includes(d)) scopes.push(d);
        const outerScopes = scopes.filter((s) => !scopes.some((o) => o !== s && o.contains(s)));
        const exportDialogFound = outerScopes.length >= 1;
        const multipleDialogs = outerScopes.length >= 2;

        // -------- Combine, decide count + dialog phase --------
        let combined: Element[] = [];
        for (const el of aMatches) if (!combined.includes(el)) combined.push(el);
        for (const el of bMatches) if (!combined.includes(el)) combined.push(el);
        combined = combined.filter((el) => !combined.some((o) => o !== el && el.contains(o)));
        let count = combined.length;
        // Multiple distinct export dialogs fail closed even if only one exposed a unique action.
        if (multipleDialogs && count < 2) count = 2;

        let dialog: "none" | "matched" | "export-dialog-no-action" | "no-export-dialog";
        if (aMatches.length >= 1) dialog = "none"; // own-wording path decided; dialog reasoning moot
        else if (bMatches.length === 1 && !multipleDialogs) dialog = "matched";
        else if (exportDialogFound) dialog = "export-dialog-no-action"; // dialog present, action not unique
        else dialog = "no-export-dialog";

        if (count === 1) {
          if (current) {
            const handler = w["__aw_observer_handler__"];
            if (typeof handler === "function") current.removeEventListener("click", handler as EventListener);
            current.removeAttribute("data-aw-target");
            current.removeAttribute("data-aw-role");
            current.removeAttribute("data-aw-label");
            current.setAttribute("data-aw-seen", "");
          }
          const el = combined[0]!;
          el.setAttribute("data-aw-target", "");
          el.setAttribute("data-aw-role", "primary-action");
          el.setAttribute("data-aw-label", "review-export-continuation");
          el.setAttribute("data-aw-seen", "");
        }
        return { count, dialog };
      },
      {
        own: EXPORT_TARGET_KEYWORDS,
        context: EXPORT_CONTEXT_KEYWORDS,
        primary: PRIMARY_ACTION_KEYWORDS,
        cancel: CANCEL_ACTION_KEYWORDS,
        // DEV-ONLY: null unless a liveDebug run supplied an operator-identified label. Off ⇒ unchanged.
        selectLabel: this.opts.liveDebug ? (this.opts.continuationSelectLabel ?? null) : null,
      },
    );
  }

  /**
   * DEV-ONLY (live-debug sprint): enumerate the SAME Path-A/Path-B continuation candidates
   * `markContinuationTarget` would, overlay a sanitized local label (`A1`/`B1`…) on each so the seated
   * operator can point at the real consent control, and return SANITIZED structural buckets only. It
   * NEVER clicks, NEVER tags a target, and NEVER emits page text/attributes/URLs/content. Labels are
   * assigned by path order over the identical candidate sets, so the labels the operator sees here match
   * the `selectLabel` the matcher will honor next attempt.
   */
  private inspectContinuationCandidates(): Promise<CandidateInspection> {
    return this.ctx().evaluate(
      (kw: { own: readonly string[]; context: readonly string[]; primary: readonly string[]; cancel: readonly string[] }) => {
        const w = window as unknown as { getComputedStyle(e: Element): CSSStyleDeclaration } & Record<string, unknown>;
        const current = document.querySelector("[data-aw-target]");
        const OWN = kw.own.map((k) => k.toLowerCase());
        const CTX = kw.context.map((k) => k.toLowerCase());
        const PRIMARY = kw.primary.map((k) => k.toLowerCase());
        const CANCEL = kw.cancel.map((k) => k.toLowerCase());
        const seen = (el: Element): boolean => el.hasAttribute("data-aw-seen");
        const visibleEnabled = (el: Element): boolean => {
          const style = w.getComputedStyle(el);
          if (style.display === "none" || style.visibility === "hidden") return false;
          if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
          if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false;
          if (el.getAttribute("type") === "hidden") return false;
          return true;
        };
        const accessibleName = (el: Element): string => {
          const text = el.textContent ?? "";
          const value = el.getAttribute("value") ?? "";
          const aria = el.getAttribute("aria-label") ?? "";
          const title = el.getAttribute("title") ?? "";
          return `${text} ${value} ${aria} ${title}`.toLowerCase();
        };
        const nameHas = (el: Element, set: string[]): boolean => set.some((k) => accessibleName(el).includes(k));
        const WORDCHAR = /[\p{L}\p{N}]/u;
        const nameHasWord = (el: Element, set: string[]): boolean => {
          const n = accessibleName(el);
          return set.some((k) => {
            for (let from = 0, idx = n.indexOf(k, from); idx !== -1; from = idx + 1, idx = n.indexOf(k, from)) {
              const before = idx > 0 ? n[idx - 1]! : "";
              if (!before || !WORDCHAR.test(before)) return true;
            }
            return false;
          });
        };
        const ctxHas = (el: Element): boolean => {
          const t = (el.textContent ?? "").toLowerCase();
          return CTX.some((k) => t.includes(k));
        };
        const NATIVE = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
        const introducesPointer = (el: Element): boolean => {
          if (w.getComputedStyle(el).cursor !== "pointer") return false;
          const parent = el.parentElement;
          return !parent || w.getComputedStyle(parent).cursor !== "pointer";
        };
        const isClickable = (el: Element): boolean => el.matches(NATIVE) || introducesPointer(el);
        const eligible = (el: Element): boolean => el !== current && !seen(el) && visibleEnabled(el);
        const all = Array.from(document.querySelectorAll("*"));

        let aMatches = all.filter((el) => eligible(el) && isClickable(el) && nameHas(el, OWN));
        aMatches = aMatches.filter((el) => !aMatches.some((o) => o !== el && el.contains(o)));

        const isDialogRole = (el: Element): boolean => {
          const role = (el.getAttribute("role") ?? "").toLowerCase();
          return role === "dialog" || role === "alertdialog" || el.getAttribute("aria-modal") === "true";
        };
        const cancelCands = all.filter((el) => visibleEnabled(el) && isClickable(el) && nameHasWord(el, CANCEL));
        const primaryCands = all.filter(
          (el) => eligible(el) && isClickable(el) && nameHasWord(el, PRIMARY) && !nameHasWord(el, CANCEL),
        );
        const dialogScopeFor = (node: Element): Element | null => {
          let el: Element | null = node.parentElement;
          let cancelScope: Element | null = null;
          while (el && el !== document.body) {
            const cur = el;
            if (isDialogRole(cur)) return ctxHas(cur) ? cur : null; // ARIA dialog = the scope boundary
            if (!cancelScope && cancelCands.some((c) => cur.contains(c))) cancelScope = cur;
            el = cur.parentElement;
          }
          return cancelScope && ctxHas(cancelScope) ? cancelScope : null;
        };
        const bMatches: Element[] = [];
        const scopes: Element[] = [];
        for (const p of primaryCands) {
          const s = dialogScopeFor(p);
          if (!s) continue;
          bMatches.push(p);
          if (!scopes.includes(s)) scopes.push(s);
        }
        const ariaExportDialogs = all.filter((el) => visibleEnabled(el) && isDialogRole(el) && ctxHas(el));
        for (const d of ariaExportDialogs) if (!scopes.includes(d)) scopes.push(d);
        const outerScopes = scopes.filter((s) => !scopes.some((o) => o !== s && o.contains(s)));

        const tagBucketOf = (el: Element): CandidateLabel["tagBucket"] => {
          const tag = el.tagName.toLowerCase();
          if (tag === "button") return "button";
          if (tag === "a") return "anchor";
          if (tag === "input") return "input";
          if ((el.getAttribute("role") ?? "").toLowerCase() === "button") return "role-button";
          if (el.matches(NATIVE)) return "other";
          return "roleless";
        };
        const inExportDialog = (el: Element): boolean => outerScopes.some((s) => s.contains(el));
        const overlap = aMatches.filter((el) => bMatches.includes(el));

        // Remove any prior labels before overlaying this pass (idempotent).
        document.querySelectorAll(".__aw_cand_label__").forEach((n) => n.remove());
        const candidates: CandidateLabel[] = [];
        const paint = (el: Element, label: string, path: "A" | "B"): void => {
          const r = (el as Element).getBoundingClientRect();
          const badge = document.createElement("div");
          badge.className = "__aw_cand_label__";
          badge.setAttribute("aria-hidden", "true");
          badge.textContent = label; // synthetic identifier only — never page content
          badge.style.cssText = [
            "position:fixed",
            "pointer-events:none",
            "z-index:2147483600",
            `left:${Math.round(r.left)}px`,
            `top:${Math.round(Math.max(0, r.top - 18))}px`,
            `background:${path === "A" ? "#c026d3" : "#059669"}`,
            "color:#fff",
            "font:bold 12px system-ui",
            "padding:1px 6px",
            "border-radius:4px",
            "white-space:nowrap",
          ].join(";");
          document.body.appendChild(badge);
        };
        aMatches.forEach((el, i) => {
          const label = `A${i + 1}`;
          paint(el, label, "A");
          candidates.push({ label, via: "A", tagBucket: tagBucketOf(el), enabled: visibleEnabled(el), inExportDialog: inExportDialog(el) });
        });
        bMatches.forEach((el, i) => {
          const label = `B${i + 1}`;
          paint(el, label, "B");
          candidates.push({ label, via: "B", tagBucket: tagBucketOf(el), enabled: visibleEnabled(el), inExportDialog: true });
        });
        return {
          dialogCount: outerScopes.length,
          pathACount: aMatches.length,
          pathBCount: bMatches.length,
          overlapCount: overlap.length,
          candidates,
        };
      },
      {
        own: EXPORT_TARGET_KEYWORDS,
        context: EXPORT_CONTEXT_KEYWORDS,
        primary: PRIMARY_ACTION_KEYWORDS,
        cancel: CANCEL_ACTION_KEYWORDS,
      },
    );
  }

  /**
   * DEV-ONLY (live-debug sprint): clear the per-attempt debug residue between retries — remove the
   * candidate label badges and every `data-aw-seen`/`data-aw-target`/tag stamp — so the next attempt on
   * the SAME page (reused context + operator's still-selected scope) starts from a clean DOM. Read-only
   * apart from removing the driver's own annotations; never clicks, never touches page content.
   */
  async clearContinuationDebug(): Promise<void> {
    await this.ctx()
      .evaluate(() => {
        document.querySelectorAll(".__aw_cand_label__").forEach((n) => n.remove());
        document.querySelectorAll("[data-aw-seen]").forEach((el) => el.removeAttribute("data-aw-seen"));
        document.querySelectorAll("[data-aw-target]").forEach((el) => {
          el.removeAttribute("data-aw-target");
          el.removeAttribute("data-aw-role");
          el.removeAttribute("data-aw-label");
        });
      })
      .catch(() => {});
  }

  /** DEV-ONLY: overlay + record the sanitized candidate inspection for the seated operator (best-effort). */
  private async captureInspection(): Promise<void> {
    this.lastInspectionResult = await this.inspectContinuationCandidates().catch(() => null);
  }

  /**
   * DEV-ONLY (live-debug sprint): scan EVERY frame (top document + children) for boundary-clean generic
   * action candidates, so a fail-closed run can tell whether the real consent control lives in a DIFFERENT
   * frame than the export surface (`ctx()`). Sanitized COUNTS per frame only — no URLs, text, or content.
   * This is the evidence that would justify (or refute) cross-frame continuation traversal.
   */
  async debugFrameScan(): Promise<Array<{ frame: number; primary: number; cancel: number; exportDialog: number }>> {
    const out: Array<{ frame: number; primary: number; cancel: number; exportDialog: number }> = [];
    const frames = this.page.frames();
    for (let i = 0; i < frames.length; i += 1) {
      const frame = frames[i]!;
      const counts = await frame
        .evaluate(
          (kw: { context: readonly string[]; primary: readonly string[]; cancel: readonly string[] }) => {
            const w = window as unknown as { getComputedStyle(e: Element): CSSStyleDeclaration };
            const CTX = kw.context.map((k) => k.toLowerCase());
            const PRIMARY = kw.primary.map((k) => k.toLowerCase());
            const CANCEL = kw.cancel.map((k) => k.toLowerCase());
            const visibleEnabled = (el: Element): boolean => {
              const s = w.getComputedStyle(el);
              if (s.display === "none" || s.visibility === "hidden") return false;
              if (el.hasAttribute("hidden") || el.getAttribute("aria-hidden") === "true") return false;
              if (el.hasAttribute("disabled") || el.getAttribute("aria-disabled") === "true") return false;
              return true;
            };
            const nameOf = (el: Element): string =>
              `${el.textContent ?? ""} ${el.getAttribute("value") ?? ""} ${el.getAttribute("aria-label") ?? ""} ${el.getAttribute("title") ?? ""}`.toLowerCase();
            const WORDCHAR = /[\p{L}\p{N}]/u;
            const hasWord = (el: Element, set: string[]): boolean => {
              const n = nameOf(el);
              return set.some((k) => {
                for (let from = 0, idx = n.indexOf(k, from); idx !== -1; from = idx + 1, idx = n.indexOf(k, from)) {
                  const b = idx > 0 ? n[idx - 1]! : "";
                  if (!b || !WORDCHAR.test(b)) return true;
                }
                return false;
              });
            };
            const NATIVE = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
            const clickable = (el: Element): boolean => {
              if (el.matches(NATIVE)) return true;
              if (w.getComputedStyle(el).cursor !== "pointer") return false;
              const p = el.parentElement;
              return !p || w.getComputedStyle(p).cursor !== "pointer";
            };
            const isDialog = (el: Element): boolean => {
              const r = (el.getAttribute("role") ?? "").toLowerCase();
              return r === "dialog" || r === "alertdialog" || el.getAttribute("aria-modal") === "true";
            };
            const all = Array.from(document.querySelectorAll("*"));
            const primary = all.filter((el) => visibleEnabled(el) && clickable(el) && hasWord(el, PRIMARY) && !hasWord(el, CANCEL)).length;
            const cancel = all.filter((el) => visibleEnabled(el) && clickable(el) && hasWord(el, CANCEL)).length;
            const exportDialog = all.filter((el) => visibleEnabled(el) && isDialog(el) && CTX.some((k) => (el.textContent ?? "").toLowerCase().includes(k))).length;
            return { primary, cancel, exportDialog };
          },
          { context: EXPORT_CONTEXT_KEYWORDS, primary: PRIMARY_ACTION_KEYWORDS, cancel: CANCEL_ACTION_KEYWORDS },
        )
        .catch(() => ({ primary: -1, cancel: -1, exportDialog: -1 })); // -1 = frame unreadable (detached/cross-origin)
      out.push({ frame: i, ...counts });
    }
    return out;
  }

  private unmarkExportTarget(): Promise<void> {
    return this.ctx()
      .evaluate(() => {
        document.querySelectorAll("[data-aw-target]").forEach((el) => {
          el.removeAttribute("data-aw-target");
          el.removeAttribute("data-aw-role");
          el.removeAttribute("data-aw-label");
        });
        document.querySelectorAll("[data-aw-seen]").forEach((el) => el.removeAttribute("data-aw-seen"));
      })
      .then(() => undefined);
  }

  /** The keyword list handed to the in-page tagger (exposed so a test can assert no drift). */
  private exportKeywords(): readonly string[] {
    return EXPORT_TARGET_KEYWORDS;
  }
}

/** Buffer a real Playwright download stream into memory — no fs write, no path retained. */
async function bufferDownload(download: Download): Promise<Uint8Array> {
  const stream = await download.createReadStream();
  if (!stream) return new Uint8Array(0);
  const chunks: Buffer[] = [];
  for await (const chunk of stream as AsyncIterable<Buffer | string>) {
    chunks.push(Buffer.isBuffer(chunk) ? chunk : Buffer.from(chunk));
  }
  return new Uint8Array(Buffer.concat(chunks));
}
