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
 * Overlay label for a CONTINUATION checkpoint — a NAVER-native follow-up notification/dialog whose
 * download/confirm control the seller must act on before the actual browser download fires (the
 * Run 7 attempt-2 finding: the export choreography can carry more than one human step). Dev-overlay
 * copy only, same posture as `OPERATOR_STEP_LABELS`.
 */
const CONTINUATION_STEP_LABEL =
  "NAVER 알림창이 표시되었습니다. 알림창의 다운로드(확인) 버튼을 직접 클릭하세요.";

/**
 * Upper bound on continuation checkpoints in one run. Two are real (the consent dialog can itself
 * carry download wording, then the follow-up notification carries the actual control); the cap only
 * guards against a pathological surface producing an unbounded highlight → wait loop. Hitting the
 * cap fails closed like any other undetected download.
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
   * READ-ONLY detection, extended to the multi-checkpoint choreography (Run 7 attempt-2 finding).
   *
   * The Run-4 shape — the seller's confirm fires the download directly — is still the fast path:
   * the armed download is raced against the deadline and wins immediately. But the live surface can
   * interpose further NAVER-native human checkpoints (a consent dialog whose confirm carries
   * download wording, then an asynchronous notification whose control the seller must click before
   * the browser download exists). While the race waits, the driver therefore polls read-only for a
   * NEW single wording-matched control (the original stays excluded by identity); when exactly one
   * appears it is re-tagged, HIGHLIGHTED, and the driver WAITS for the seller's own action on it —
   * it never clicks. Only after that action does a fresh download deadline run. Bounded everywhere:
   * ≥2 simultaneous candidates → ambiguous → fail closed; no action inside the continuation observe
   * window → fail closed; more than `MAX_CONTINUATION_CHECKPOINTS` → fail closed; and absence of
   * both a download and a checkpoint at any deadline → the unchanged `DOWNLOAD_TIMEOUT` shape.
   *
   * A detected download is buffered into memory (bytes re-readable for validate + ingest), the
   * browser's own copy is dropped, and only a nonce-seeded opaque 16-hex ref is emitted — the
   * filename / path / URL never influence the ref or leave this scope.
   */
  async detectDownload(): Promise<DownloadDetectResult> {
    const timeoutMs = this.opts.downloadTimeoutMs ?? 15_000;
    const armed = this.pendingDownload ?? this.page.waitForEvent("download", { timeout: 0 }).catch(() => null);
    this.pendingDownload = armed;
    const diagnostic: ContinuationDiagnostic = { checkpoints: 0, observedLast: false, ambiguous: false };
    this.lastContinuationDiagnostic = diagnostic;
    try {
      for (let checkpoint = 0; checkpoint <= MAX_CONTINUATION_CHECKPOINTS; checkpoint += 1) {
        const outcome = await this.raceDownloadOrContinuation(armed, timeoutMs);
        if (outcome.kind === "download") return await this.bufferDetected(outcome.download);
        if (outcome.kind === "timeout") return { detected: false };
        if (outcome.kind === "ambiguous") {
          diagnostic.ambiguous = true;
          return { detected: false }; // fail closed: 2+ candidate controls is ambiguity, never a guess
        }
        // outcome.kind === "continuation": exactly ONE new control is now the tagged target.
        diagnostic.checkpoints = checkpoint + 1;
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
    { kind: "download"; download: Download } | { kind: "timeout" } | { kind: "ambiguous" } | { kind: "continuation" }
  > {
    const pollMs = this.opts.continuationPollMs ?? 500;
    const sleep = this.opts.sleepFn ?? ((ms: number) => new Promise<void>((r) => setTimeout(r, ms)));
    const maxChecks = Math.max(1, Math.ceil(deadlineMs / pollMs));
    const TICK = Symbol("tick");
    for (let i = 0; i < maxChecks; i += 1) {
      const winner = await Promise.race([armed, sleep(pollMs).then(() => TICK as typeof TICK)]);
      if (winner !== TICK) {
        // The armed promise settled: a download, or null (page/context gone) → the timeout shape.
        return winner ? { kind: "download", download: winner as Download } : { kind: "timeout" };
      }
      const count = await this.markContinuationTarget().catch(() => 0);
      if (count === 1) return { kind: "continuation" };
      if (count >= 2) return { kind: "ambiguous" };
    }
    return { kind: "timeout" };
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
   * In-page, atomic: find a NEW single actionable control matching the confirmed export wording —
   * the CURRENT `[data-aw-target]` element is excluded **by identity**, so the original export
   * control (still present under the dialog) can never be re-matched. On exactly one match the tag
   * MOVES: the old element loses its tag AND its observer click-listener (a stale click on the
   * original control must not satisfy the continuation observation), the new element gains the tag
   * with a `review-export-continuation` label. Returns the NEW-match count so the caller can fail
   * closed on 0-keeps-waiting / ≥2-is-ambiguous. Read-only otherwise — it NEVER clicks.
   */
  private markContinuationTarget(): Promise<number> {
    return this.ctx().evaluate((keywords: readonly string[]) => {
      const w = window as unknown as { getComputedStyle(e: Element): CSSStyleDeclaration } & Record<string, unknown>;
      const current = document.querySelector("[data-aw-target]");
      const kws = keywords.map((k) => k.toLowerCase());
      // Persistent exclusion: `data-aw-seen` stamps every control this run has EVER highlighted. The
      // by-identity `current` exclusion alone is not enough — a checkpoint control is typically
      // REMOVED from the DOM by its own click, and the moment it goes, the original export control
      // (untagged when the tag moved) would become matchable again and be re-highlighted at the
      // seller as if it were new. Seen controls stay excluded for the whole run; `cleanup()` unstamps.
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
      // Candidate set: native interactive controls UNION role-less clickables. Run 7 attempt-4 live
      // finding (dispatch record §19.3): NAVER's SECOND download control was a custom clickable with
      // no button/anchor/role, which the native-only selector missed (checkpoints:0, timed out).
      //
      // A role-less clickable is discriminated by an OWN pointer cursor. `cursor` INHERITS, so a bare
      // `=== "pointer"` test would also match inheriting CHILDREN and instructional text under a
      // pointer region — false candidates that read as ambiguity. Require the element to INTRODUCE the
      // pointer (its parent is not pointer), so we match the clickable itself, not what it contains or
      // what merely sits under it. Visible+enabled + export wording still gate; ambiguity still fails
      // closed; the wording keyword set is unchanged.
      const NATIVE = 'button, a, [role="button"], input[type="button"], input[type="submit"]';
      const introducesPointer = (el: Element): boolean => {
        if (w.getComputedStyle(el).cursor !== "pointer") return false;
        const parent = el.parentElement;
        return !parent || w.getComputedStyle(parent).cursor !== "pointer";
      };
      let matches = Array.from(document.querySelectorAll("*")).filter((el) => {
        if (el === current || seen(el)) return false;
        if (!kws.some((k) => accessibleName(el).includes(k))) return false; // cheap wording gate first
        if (!visibleEnabled(el)) return false;
        return el.matches(NATIVE) || introducesPointer(el);
      });
      // Innermost-only: a native control nested inside a clickable wrapper (both match) collapses to
      // the tightest; two SEPARATE wording-matched controls stay two (fail closed on ambiguity).
      matches = matches.filter((el) => !matches.some((o) => o !== el && el.contains(o)));
      if (matches.length === 1) {
        if (current) {
          const handler = w["__aw_observer_handler__"];
          if (typeof handler === "function") current.removeEventListener("click", handler as EventListener);
          current.removeAttribute("data-aw-target");
          current.removeAttribute("data-aw-role");
          current.removeAttribute("data-aw-label");
          current.setAttribute("data-aw-seen", "");
        }
        const el = matches[0]!;
        el.setAttribute("data-aw-target", "");
        el.setAttribute("data-aw-role", "primary-action");
        el.setAttribute("data-aw-label", "review-export-continuation");
        el.setAttribute("data-aw-seen", "");
      }
      return matches.length;
    }, this.exportKeywords());
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
