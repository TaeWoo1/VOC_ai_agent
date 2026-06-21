import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  diagnoseExportClickOnce,
  EXPORT_CLICK_DIAGNOSIS_KEYS,
  type DiagContext,
  type DiagDialog,
  type DiagDownload,
  type DiagnoseDeps,
  type DiagPage,
} from "../../src/naver/export-click-diagnose";

const noSleep = (): Promise<void> => Promise.resolve();
const deps = (over: Partial<DiagnoseDeps> = {}): DiagnoseDeps => ({
  observeWindowMs: 30,
  pollIntervalMs: 10,
  clickTimeoutMs: 50,
  salt: "salt",
  settleFn: () => Promise.resolve(),
  sleepFn: noSleep,
  ...over,
});

/** One visible enabled Excel control with a stable id → exactly one trigger selector. */
const SYNC_ONE = `<main><button id="exp">엑셀 다운로드</button></main>`;
/** Two distinct controls → buildTriggerSelectors yields 2 → refuse to click. */
const SYNC_TWO = `<main><button id="a">엑셀</button><button id="b">다운로드</button></main>`;
/** A date-range modal that appears after the click. */
const DATE_MODAL = `<div class="modal-dialog" role="dialog">스토어 행복마켓: 조회 기간을 선택하세요 (시작일/종료일) <button class="btn-primary">확인</button></div>`;

class FakePage implements DiagPage {
  clicks: string[] = [];
  private dialogHandler?: (d: DiagDialog) => void;
  constructor(
    private html: string,
    private opts: { download?: DiagDownload; fireDialog?: DiagDialog; htmlAfterClick?: string } = {},
  ) {}
  content(): Promise<string> {
    return Promise.resolve(this.clicks.length > 0 ? (this.opts.htmlAfterClick ?? this.html) : this.html);
  }
  click(selector: string): Promise<void> {
    this.clicks.push(selector);
    if (this.opts.fireDialog && this.dialogHandler) this.dialogHandler(this.opts.fireDialog);
    return Promise.resolve();
  }
  on(_event: "dialog", handler: (d: DiagDialog) => void): void {
    this.dialogHandler = handler;
  }
  waitForEvent(_event: "download"): Promise<DiagDownload> {
    return this.opts.download ? Promise.resolve(this.opts.download) : Promise.reject(new Error("timeout"));
  }
}

class NoopContext implements DiagContext {
  on(): void {
    /* no popup */
  }
}
/** Fires the page handler on registration → simulates a popup opening. */
class PopupContext implements DiagContext {
  on(_event: "page", handler: (page: unknown) => void): void {
    handler({});
  }
}

const xlsxDownload: DiagDownload = { suggestedFilename: () => "review_20260101_행복마켓.xlsx" };
const alertDialog: DiagDialog = {
  type: () => "alert",
  message: () => "스토어 행복마켓: 조회 기간은 최대 3개월 입니다",
  accept: () => Promise.resolve(),
  dismiss: () => Promise.resolve(),
};

describe("diagnoseExportClickOnce — exactly one click through the single gate-approved control", () => {
  it("clicks exactly once and reports a DOWNLOAD with a hashed filename (no raw name)", async () => {
    const page = new FakePage(SYNC_ONE, { download: xlsxDownload });
    const res = await diagnoseExportClickOnce(page, new NoopContext(), deps());
    expect(page.clicks).toHaveLength(1);
    expect(res.clicked).toBe(true);
    expect(res.clickedCount).toBe(1);
    expect(res.outcome).toBe("DOWNLOAD");
    expect(res.download?.extensionCategory).toBe("xlsx");
    expect(res.download?.filenameHash).toMatch(/^[a-f0-9]{16}$/);
    const json = JSON.stringify(res);
    expect(json.includes("행복마켓")).toBe(false); // raw filename never echoed
  });

  it("refuses to click when the page is NOT a single unambiguous control", async () => {
    const page = new FakePage(SYNC_TWO);
    const res = await diagnoseExportClickOnce(page, new NoopContext(), deps());
    expect(page.clicks).toHaveLength(0); // no click
    expect(res.clicked).toBe(false);
    expect(res.outcome).toBe("NO_OP");
  });
});

describe("diagnoseExportClickOnce — sanitized observation of what the click produced", () => {
  it("records a native dialog (sanitized + handled) when no download arrives", async () => {
    const page = new FakePage(SYNC_ONE, { fireDialog: alertDialog });
    const res = await diagnoseExportClickOnce(page, new NoopContext(), deps());
    expect(page.clicks).toHaveLength(1);
    expect(res.outcome).toBe("NATIVE_DIALOG");
    expect(res.dialog?.type).toBe("alert");
    expect(res.dialog?.messageCategory).toBe("date_range");
    expect(res.dialog?.action).toBe("accepted");
    expect(res.dialog?.messageHash).toMatch(/^[a-f0-9]{16}$/);
    expect(JSON.stringify(res).includes("행복마켓")).toBe(false);
  });

  it("classifies a post-click date-range modal", async () => {
    const page = new FakePage(SYNC_ONE, { htmlAfterClick: DATE_MODAL });
    const res = await diagnoseExportClickOnce(page, new NoopContext(), deps());
    expect(res.outcome).toBe("DATE_RANGE_REQUIRED");
    expect(res.modalCategory).toBe("date_range_required");
    expect(res.dateRangeRequired).toBe(true);
    expect(JSON.stringify(res).includes("행복마켓")).toBe(false);
  });

  it("reports a popup when the click opened a new page and nothing else fired", async () => {
    const page = new FakePage(SYNC_ONE);
    const res = await diagnoseExportClickOnce(page, new PopupContext(), deps());
    expect(res.popupOpened).toBe(true);
    expect(res.outcome).toBe("POPUP");
  });

  it("reports NO_OP when the click produced nothing observable", async () => {
    const page = new FakePage(SYNC_ONE);
    const res = await diagnoseExportClickOnce(page, new NoopContext(), deps());
    expect(res.clicked).toBe(true);
    expect(res.outcome).toBe("NO_OP");
  });

  it("only ever emits the allow-listed diagnosis keys", async () => {
    const page = new FakePage(SYNC_ONE, { download: xlsxDownload });
    const res = await diagnoseExportClickOnce(page, new NoopContext(), deps());
    for (const k of Object.keys(res)) {
      expect(EXPORT_CLICK_DIAGNOSIS_KEYS).toContain(k);
    }
  });
});

describe("export-click-diagnose.ts — source guard: observe-only, exactly one click", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "naver", "export-click-diagnose.ts");
  const code = readFileSync(SRC, "utf8")
    .replace(/\/\*[\s\S]*?\*\//g, " ")
    .replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("never persists, uploads, writes status, runs the capture leg, or navigates", () => {
    expect(/saveAs/.test(code)).toBe(false);
    expect(/uploadReviewFile|\buploadReview\w*/.test(code)).toBe(false);
    expect(/writeStatus/.test(code)).toBe(false);
    expect(/runExport/.test(code)).toBe(false);
    expect(/\.goto\s*\(/.test(code)).toBe(false);
  });

  it("performs EXACTLY ONE click (the gate-approved single trigger; no fallback loop)", () => {
    const clicks = code.match(/\.click\s*\(/g) ?? [];
    expect(clicks).toHaveLength(1);
  });
});
