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
import {
  naverLocateDecision,
  naverSurfaceDecision,
  naverVerifyDecision,
  type NaverPrepareDiagnostic,
} from "./naver-surface";
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
}

/** Some bundlers inject `__name(...)` into serialized evaluate bodies — a harmless identity shim. */
const NAME_SHIM = "globalThis.__name = globalThis.__name || function (f) { return f; };";

export class NaverLiveProbeDriver implements ProbeDriver {
  private readonly page: Page;
  private readonly opts: NaverLiveProbeDriverOptions;

  /** TEST-VISIBLE sanitized diagnostic of the last `prepareSurface` (fixed enums only, never wired). */
  private lastDiagnostic: NaverPrepareDiagnostic | null = null;
  /** TEST-VISIBLE booleans of the last quarantine validation (never wired). */
  private lastQuarantineVerdict: QuarantineVerdict | null = null;
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
    const { result, diagnostic } = naverSurfaceDecision(verdict, html);
    this.lastDiagnostic = diagnostic;
    return result;
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
   * READ-ONLY detection: race the armed download against the deadline. Absence → the timeout shape.
   * A detected download is buffered into memory (bytes re-readable for validate + ingest), the
   * browser's own copy is dropped, and only a nonce-seeded opaque 16-hex ref is emitted — the
   * filename / path / URL never influence the ref or leave this scope.
   */
  async detectDownload(): Promise<DownloadDetectResult> {
    const timeoutMs = this.opts.downloadTimeoutMs ?? 15_000;
    const armed = this.pendingDownload ?? this.page.waitForEvent("download", { timeout: timeoutMs }).catch(() => null);
    let timer: NodeJS.Timeout | undefined;
    const download = await Promise.race([
      armed,
      new Promise<null>((resolveTimeout) => {
        timer = setTimeout(() => resolveTimeout(null), timeoutMs);
      }),
    ]);
    if (timer) clearTimeout(timer);
    this.pendingDownload = null;
    if (!download) return { detected: false };
    const filename = download.suggestedFilename();
    const bytes = await bufferDownload(download);
    // We hold the bytes in memory; the browser's own temp copy is no longer needed.
    await download.delete().catch(() => {});
    this.retained = { suggestedFilename: () => filename, bytes: () => bytes };
    return { detected: true, artifactRef: artifactRefFor(["aw-naver-live-download", randomUUID()]) };
  }

  /**
   * Validate the buffered artifact via the ratified quarantine posture (temporary save → extension +
   * OOXML magic sniff → DELETE; a failed delete fails closed). The bytes are RETAINED for the ingest
   * handoff; only the sanitized boolean crosses back to the engine.
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
    return { valid: verdict.valid };
  }

  /**
   * Hand the validated bytes to the INJECTED upload callback under the opaque `artifactRef` (the
   * platform's suggested filename is never passed). Only the sanitized `{ ok, processed }` crosses
   * back; a non-`ok` outcome fails the run closed (`UNSUPPORTED_STATE`, per the engine).
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

  private unmarkExportTarget(): Promise<void> {
    return this.ctx()
      .evaluate(() => {
        document.querySelectorAll("[data-aw-target]").forEach((el) => {
          el.removeAttribute("data-aw-target");
          el.removeAttribute("data-aw-role");
          el.removeAttribute("data-aw-label");
        });
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
