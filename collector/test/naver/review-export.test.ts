import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { clearLogSink, getLogSink } from "../../src/log";
import { classifyExportPage, runExport } from "../../src/naver/review-export";
import type { PwDownload, PwPage } from "../../src/profile";
import { decideState, type ExportOutcome } from "../../src/status";

const fixtures = resolve(dirname(fileURLToPath(import.meta.url)), "../../fixtures");
const read = (name: string): string => readFileSync(resolve(fixtures, name), "utf8");

describe("classifyExportPage", () => {
  it("immediate-download layout → SYNC_DOWNLOAD", () => {
    expect(classifyExportPage(read("export_sync_blob.html"))).toBe("SYNC_DOWNLOAD");
  });

  it("download-center / job layout → ASYNC_JOB (wins over a direct control)", () => {
    expect(classifyExportPage(read("export_async_job.html"))).toBe("ASYNC_JOB");
  });

  it("unknown layout → UNRECOGNIZED", () => {
    expect(classifyExportPage(read("export_layout_unknown.html"))).toBe("UNRECOGNIZED");
  });
});

/** Fake Playwright page: supplies content + a controllable download outcome. */
function fakePage(opts: {
  html: string;
  download?: PwDownload;
  downloadError?: boolean;
  onClick?: () => void;
}): PwPage {
  return {
    url: () => "https://sell.smartstore.naver.com/o/n/review",
    content: async () => opts.html,
    goto: async () => null,
    click: async () => {
      opts.onClick?.();
    },
    waitForEvent: async () => {
      if (opts.downloadError || !opts.download) throw new Error("download timeout");
      return opts.download;
    },
  };
}

describe("runExport", () => {
  beforeEach(() => clearLogSink());

  it("sync layout with a download → CAPTURED and saves the file", async () => {
    let savedTo = "";
    const download: PwDownload = {
      suggestedFilename: () => "review_export.xlsx",
      saveAs: async (p) => {
        savedTo = p;
      },
    };
    let clicked = false;
    const page = fakePage({ html: read("export_sync_blob.html"), download, onClick: () => (clicked = true) });
    const result = await runExport(page, "/tmp/dl");
    expect(result.outcome).toBe("CAPTURED");
    expect(result.filePath).toBe(resolve("/tmp/dl", "review_export.xlsx"));
    expect(savedTo).toBe(resolve("/tmp/dl", "review_export.xlsx"));
    expect(clicked).toBe(true);
  });

  it("async layout → ASYNC_JOB_DETECTED without clicking any control", async () => {
    let clicked = false;
    const page = fakePage({ html: read("export_async_job.html"), onClick: () => (clicked = true) });
    const result = await runExport(page, "/tmp/dl");
    expect(result.outcome).toBe("ASYNC_JOB_DETECTED");
    expect(result.filePath).toBeUndefined();
    expect(clicked).toBe(false);
  });

  it("unknown layout → LAYOUT_UNRECOGNIZED", async () => {
    const page = fakePage({ html: read("export_layout_unknown.html") });
    const result = await runExport(page, "/tmp/dl");
    expect(result.outcome).toBe("LAYOUT_UNRECOGNIZED");
  });

  it("sync layout but the download never arrives → DOWNLOAD_FAILED (no fake success)", async () => {
    const page = fakePage({ html: read("export_sync_blob.html"), downloadError: true });
    const result = await runExport(page, "/tmp/dl");
    expect(result.outcome).toBe("DOWNLOAD_FAILED");
  });

  it("logs metadata only (no raw HTML, no URL, no secrets)", async () => {
    const page = fakePage({ html: read("export_async_job.html") });
    await runExport(page, "/tmp/dl");
    const serialized = JSON.stringify(getLogSink());
    expect(serialized).toContain("export.classify");
    expect(serialized).not.toContain("다운로드 목록"); // raw HTML must not leak
    expect(serialized).not.toContain("sell.smartstore");
  });
});

describe("export outcome → collector state (via decideState)", () => {
  const base = { paired: true, session: "LOGGED_IN" } as const;
  const cases: Array<[ExportOutcome, string]> = [
    ["CAPTURED", "COLLECTING"], // captured but upload not yet attempted
    ["ASYNC_JOB_DETECTED", "EXPORT_ASYNC_JOB_DETECTED"],
    ["LAYOUT_UNRECOGNIZED", "EXPORT_LAYOUT_CHANGED"],
    ["DOWNLOAD_FAILED", "DOWNLOAD_FAILED"],
    ["NOT_ATTEMPTED", "CONNECTED"],
  ];
  it.each(cases)("%s → %s", (exportOutcome, expected) => {
    expect(decideState({ ...base, exportOutcome })).toBe(expected);
  });
});
