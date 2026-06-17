import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { beforeEach, describe, expect, it } from "vitest";
import { clearLogSink, getLogSink } from "../../src/log";
import {
  buildTriggerSelectors,
  classifyExportPage,
  findExportCandidates,
  runExport,
} from "../../src/naver/review-export";
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

  // The live milestone-1 fix: a top-document, visible, enabled Excel/download
  // control WITHOUT the placeholder data-export='review' selector must still be
  // recognized as sync.
  it("top-document Excel button without data-export → SYNC_DOWNLOAD", () => {
    expect(classifyExportPage(read("export_top_doc_excel_button.html"))).toBe("SYNC_DOWNLOAD");
  });

  it("export control as anchor / role=button → SYNC_DOWNLOAD", () => {
    expect(classifyExportPage(read("export_top_doc_anchor_rolebutton.html"))).toBe("SYNC_DOWNLOAD");
  });

  it("only a DISABLED Excel control → UNRECOGNIZED (not actionable)", () => {
    expect(classifyExportPage(read("export_disabled_button.html"))).toBe("UNRECOGNIZED");
  });

  it("export wording only in non-interactive copy → UNRECOGNIZED", () => {
    expect(classifyExportPage(read("export_text_only_no_control.html"))).toBe("UNRECOGNIZED");
  });

  it("non-export file controls (파일 첨부 / 파일 선택) → UNRECOGNIZED", () => {
    // `파일` is intentionally NOT export wording — file upload/attach/select must
    // not be mistaken for an export trigger.
    expect(classifyExportPage("<main><button>파일 첨부</button><button>파일 선택</button></main>")).toBe(
      "UNRECOGNIZED",
    );
  });
});

describe("findExportCandidates", () => {
  it("matches a top-document button by wording, without data-export", () => {
    const cands = findExportCandidates(read("export_top_doc_excel_button.html"));
    expect(cands).toHaveLength(1);
    expect(cands[0]).toMatchObject({ tag: "button", keyword: "엑셀", dataExportReview: false });
  });

  it("matches both an anchor and a role=button container", () => {
    const cands = findExportCandidates(read("export_top_doc_anchor_rolebutton.html"));
    const tags = cands.map((c) => c.tag).sort();
    expect(tags).toEqual(["a", "div"]);
  });

  it("excludes a disabled control (not actionable)", () => {
    expect(findExportCandidates(read("export_disabled_button.html"))).toHaveLength(0);
  });

  it("excludes export wording that is not inside an interactive element", () => {
    expect(findExportCandidates(read("export_text_only_no_control.html"))).toHaveLength(0);
  });

  it("does not match broad non-export wording (파일 첨부 / 파일 선택)", () => {
    expect(findExportCandidates("<button>파일 첨부</button>")).toHaveLength(0);
    expect(findExportCandidates("<button>파일 선택</button>")).toHaveLength(0);
  });

  it("excludes a hidden control even with export wording", () => {
    expect(findExportCandidates('<button hidden>엑셀 다운로드</button>')).toHaveLength(0);
    expect(findExportCandidates('<button aria-hidden="true">엑셀 다운로드</button>')).toHaveLength(0);
    expect(findExportCandidates('<button style="display:none">엑셀 다운로드</button>')).toHaveLength(0);
  });

  it("ignores export wording inside an HTML comment", () => {
    expect(findExportCandidates("<!-- <button>엑셀 다운로드</button> --><main>리뷰</main>")).toHaveLength(0);
  });
});

describe("buildTriggerSelectors", () => {
  it("prefers the data-export selector when present", () => {
    expect(buildTriggerSelectors(read("export_sync_blob.html"))).toEqual(["[data-export='review']"]);
  });

  it("falls back to a tag+keyword text selector when data-export is absent", () => {
    expect(buildTriggerSelectors(read("export_top_doc_excel_button.html"))).toEqual([
      'button:has-text("엑셀"):not([disabled])',
    ]);
  });

  it("builds anchor and role=button text selectors", () => {
    expect(buildTriggerSelectors(read("export_top_doc_anchor_rolebutton.html"))).toEqual([
      'a:has-text("엑셀"):not([disabled])',
      'div[role="button"]:has-text("엑셀"):not([aria-disabled="true"])',
    ]);
  });

  it("uses an id selector when the candidate has one", () => {
    expect(buildTriggerSelectors('<button id="rv-excel">엑셀 다운로드</button>')).toEqual(["#rv-excel"]);
  });

  it("builds an aria-label fallback when there is no visible text", () => {
    expect(buildTriggerSelectors('<button aria-label="엑셀 다운로드"></button>')).toEqual([
      'button[aria-label*="엑셀"]:not([disabled])',
    ]);
  });

  it("builds a title fallback when there is no visible text", () => {
    expect(buildTriggerSelectors('<button title="엑셀 다운로드"></button>')).toEqual([
      'button[title*="엑셀"]:not([disabled])',
    ]);
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

  it("classify-only: sync layout → CAPTURED but does NOT persist the file (no saveAs)", async () => {
    let savedTo = "";
    const download: PwDownload = {
      suggestedFilename: () => "review_export.xlsx",
      saveAs: async (p) => {
        savedTo = p;
      },
    };
    let clicked = false;
    const page = fakePage({ html: read("export_sync_blob.html"), download, onClick: () => (clicked = true) });
    const result = await runExport(page, "/tmp/dl", { classifyOnly: true });
    expect(result.outcome).toBe("CAPTURED");
    expect(result.filePath).toBeUndefined(); // mechanism proven by the download event; nothing written
    expect(savedTo).toBe(""); // saveAs never called — no real file lands in downloadDir
    expect(clicked).toBe(true);
  });

  it("top-document Excel button (no data-export) → CAPTURED and clicked", async () => {
    const download: PwDownload = { suggestedFilename: () => "review_export.xlsx", saveAs: async () => {} };
    let clicked = false;
    const page = fakePage({
      html: read("export_top_doc_excel_button.html"),
      download,
      onClick: () => (clicked = true),
    });
    const result = await runExport(page, "/tmp/dl", { classifyOnly: true });
    expect(result.outcome).toBe("CAPTURED");
    expect(result.filePath).toBeUndefined(); // classify-only: nothing persisted
    expect(clicked).toBe(true);
  });

  it("only a DISABLED control → LAYOUT_UNRECOGNIZED and never clicks", async () => {
    let clicked = false;
    const page = fakePage({ html: read("export_disabled_button.html"), onClick: () => (clicked = true) });
    const result = await runExport(page, "/tmp/dl", { classifyOnly: true });
    expect(result.outcome).toBe("LAYOUT_UNRECOGNIZED");
    expect(clicked).toBe(false);
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

describe("classify-only never reports success (LAST_SUCCESS impossible)", () => {
  // Classify-only writes status from {session, exportOutcome} with NO
  // uploadOutcome (the upload leg is skipped). Prove that for EVERY export
  // outcome the resulting state is never LAST_SUCCESS — discovery is not
  // successful collection.
  const base = { paired: true, session: "LOGGED_IN" } as const;
  const outcomes: ExportOutcome[] = [
    "CAPTURED",
    "ASYNC_JOB_DETECTED",
    "LAYOUT_UNRECOGNIZED",
    "DOWNLOAD_FAILED",
    "NOT_ATTEMPTED",
  ];

  it.each(outcomes)("classify-only %s does not yield LAST_SUCCESS", (exportOutcome) => {
    expect(decideState({ ...base, exportOutcome })).not.toBe("LAST_SUCCESS");
  });

  it("a captured sync export in classify-only is COLLECTING, not LAST_SUCCESS", () => {
    expect(decideState({ ...base, exportOutcome: "CAPTURED" })).toBe("COLLECTING");
  });
});
