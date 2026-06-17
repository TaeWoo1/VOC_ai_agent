import { resolve } from "node:path";
import { log } from "../log";
import type { PwPage } from "../profile";
import type { ExportOutcome } from "../status";

export type ExportPageKind = "SYNC_DOWNLOAD" | "ASYNC_JOB" | "UNRECOGNIZED";

// PLACEHOLDER markers — to be confirmed during the approved live milestone-1 run
// (mirrors the placeholder markers in src/session.ts). A page that shows a job /
// download-center affordance is async; a direct excel/download control is sync.
const ASYNC_JOB_MARKERS = [
  /다운로드\s*목록/,
  /다운로드\s*센터/,
  /다운로드\s*요청/,
  /처리\s*중/,
  /대기열/,
  /download[-\s]?center/i,
  /export[-\s]?(queue|job)/i,
];
const SYNC_EXPORT_MARKERS = [
  /엑셀\s*다운로드/,
  /excel\s*download/i,
  /리뷰[^<]{0,20}다운로드/,
  /data-export=["']review["']/i,
];

/**
 * Pure: classify the export area by its rendered HTML. An async/job affordance
 * wins over a direct download control — an async export must never be mistaken
 * for a sync capture. Unknown layout → UNRECOGNIZED so the run halts instead of
 * guessing. Markers are PLACEHOLDERS, confirmed only by the live run.
 */
export function classifyExportPage(html: string): ExportPageKind {
  const any = (markers: RegExp[]) => markers.some((re) => re.test(html));
  if (any(ASYNC_JOB_MARKERS)) return "ASYNC_JOB";
  if (any(SYNC_EXPORT_MARKERS)) return "SYNC_DOWNLOAD";
  return "UNRECOGNIZED";
}

// PLACEHOLDER selector + timeout — confirmed during the live run.
const TRIGGER_SELECTOR = "[data-export='review']";
const DOWNLOAD_TIMEOUT_MS = 15_000;

export interface ExportResult {
  outcome: ExportOutcome;
  filePath?: string;
}

export interface RunExportOptions {
  /**
   * Classify-only (milestone-1 discovery): prove the sync mechanism from the
   * Playwright download event WITHOUT persisting the real export. No `saveAs` is
   * called, so nothing is written into `downloadDir`; the browser's temporary
   * download artifact is discarded when the context closes. CAPTURED is returned
   * with no `filePath`, and the caller must not upload it.
   */
  classifyOnly?: boolean;
}

/**
 * Live: on the export page, classify the mechanism and — only for a sync
 * download — trigger and capture the file. Async jobs are DETECTED only (no
 * polling/loop in this slice). Every failure resolves to a specific
 * ExportOutcome; CAPTURED is returned only when a download actually arrived, so a
 * fake success is impossible. In classify-only mode the file is NOT persisted
 * (no `saveAs`), so CAPTURED carries no `filePath`. LIVE-ONLY.
 */
export async function runExport(
  page: PwPage,
  downloadDir: string,
  options: RunExportOptions = {},
): Promise<ExportResult> {
  const kind = classifyExportPage(await page.content());
  if (kind === "UNRECOGNIZED") {
    log("export.classify", { kind, outcome: "LAYOUT_UNRECOGNIZED" });
    return { outcome: "LAYOUT_UNRECOGNIZED" };
  }
  if (kind === "ASYNC_JOB") {
    log("export.classify", { kind, outcome: "ASYNC_JOB_DETECTED" });
    return { outcome: "ASYNC_JOB_DETECTED" };
  }
  try {
    const downloadPromise = page.waitForEvent("download", { timeout: DOWNLOAD_TIMEOUT_MS });
    await page.click(TRIGGER_SELECTOR, { timeout: DOWNLOAD_TIMEOUT_MS });
    const download = await downloadPromise;
    if (options.classifyOnly) {
      // The download event alone proves the export is sync. Do NOT persist the
      // real file — milestone-1 is discovery, not ingestion. The browser's temp
      // artifact is discarded on context close; nothing lands in downloadDir.
      log("export.captured", { kind, classifyOnly: true });
      return { outcome: "CAPTURED" };
    }
    const filePath = resolve(downloadDir, download.suggestedFilename());
    await download.saveAs(filePath);
    log("export.captured", { kind });
    return { outcome: "CAPTURED", filePath };
  } catch {
    log("export.download_failed", { kind }, "error");
    return { outcome: "DOWNLOAD_FAILED" };
  }
}
