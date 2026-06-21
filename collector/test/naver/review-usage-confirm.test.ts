import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  confirmReviewUsageOnce,
  REVIEW_USAGE_CONFIRM_KEYS,
  type ConfirmContext,
  type ConfirmDeps,
  type ConfirmDialog,
  type ConfirmPage,
} from "../../src/naver/review-usage-confirm";

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, "..", "..", "src", "naver", "review-usage-confirm.ts");

/** The review-usage consent modal (취소 / 확인) rendered over a populated review grid. */
const CONSENT_HTML = `<div role="dialog" aria-modal="true">
  <h2>리뷰 다운로드 및 활용에 유의해 주세요.</h2>
  <p>리뷰 작성자(저작권자) … 리뷰데이터 다운로드를 계속하시겠습니까?</p>
  <button>취소</button><button class="btn-primary">확인</button>
  </div>
  <table><tbody><tr><td>리뷰</td></tr></tbody></table>
  <div class="filters">조회 기간: 최대 3개월 · 시작일 · 종료일</div>`;

/** The consent modal dismissed — no modal markers remain. */
const DISMISSED_HTML = `<main><table><tbody><tr><td>리뷰</td></tr></tbody></table></main>`;

/** A follow-up async-job notice modal. */
const ASYNC_HTML = `<div role="dialog" aria-modal="true"><p>다운로드 센터에서 처리 중입니다.</p></div>`;

/** PII-laden fixtures — used to prove nothing is ever echoed. */
const PII_CONSENT = `<div role="dialog" aria-modal="true">
  <h2>리뷰 다운로드 및 활용에 유의해 주세요.</h2>
  <p>판매자 행복마켓 (Commerce ID 1234567) 리뷰데이터 다운로드를 계속하시겠습니까?</p>
  <button>취소</button><button>확인</button></div>`;

interface FakePageOpts {
  /** content() responses: index 0 = consent re-check, then observe reads (last repeats). */
  contentSeq: string[];
  /** what the in-page scan returns. */
  scanCount: number;
  /** what locator(stamp).count() returns (default = scanCount). */
  locatorCount?: number;
  /** if set, waitForEvent("download") resolves with this suggested filename. */
  downloadName?: string;
  /** if set, a native dialog fires. */
  dialog?: { type: string; message: string };
  /** force the click to throw (control not actionable). */
  clickThrows?: boolean;
}

interface FakeHandles {
  page: ConfirmPage;
  ctx: ConfirmContext;
  counts: { evaluate: number; click: number; locatorCount: number; content: number };
}

function makeFakes(opts: FakePageOpts): FakeHandles {
  const counts = { evaluate: 0, click: 0, locatorCount: 0, content: 0 };
  let dialogHandler: ((d: ConfirmDialog) => void) | undefined;

  const page = {
    async content(): Promise<string> {
      const i = Math.min(counts.content, opts.contentSeq.length - 1);
      counts.content += 1;
      return opts.contentSeq[i] ?? "";
    },
    async evaluate(_fn: unknown, _arg: unknown): Promise<unknown> {
      counts.evaluate += 1;
      return opts.scanCount;
    },
    locator(_selector: string) {
      return {
        async count(): Promise<number> {
          counts.locatorCount += 1;
          return opts.locatorCount ?? opts.scanCount;
        },
        async click(): Promise<void> {
          counts.click += 1;
          if (opts.clickThrows) throw new Error("not actionable");
          // Fire the dialog (if any) as a side effect of the click, like a real confirm would.
          if (opts.dialog && dialogHandler) {
            dialogHandler({
              type: () => opts.dialog!.type,
              message: () => opts.dialog!.message,
              accept: async () => undefined,
              dismiss: async () => undefined,
            });
          }
        },
      };
    },
    on(_event: "dialog", handler: (d: ConfirmDialog) => void): void {
      dialogHandler = handler;
    },
    async waitForEvent(_event: "download"): Promise<{ suggestedFilename: () => string }> {
      if (opts.downloadName) return { suggestedFilename: () => opts.downloadName as string };
      throw new Error("download timeout");
    },
  } as unknown as ConfirmPage;

  const ctx = {
    on(_event: "page", _handler: (p: unknown) => void): void {
      // popups not exercised in these unit tests
    },
  } as unknown as ConfirmContext;

  return { page, ctx, counts };
}

const DEPS: ConfirmDeps = {
  observeWindowMs: 30,
  pollIntervalMs: 10,
  salt: "test-salt",
  settleFn: async () => undefined,
  sleepFn: async () => undefined,
};

describe("confirmReviewUsageOnce — exactly one modal-scoped 확인 click, observe-only", () => {
  it("CONFIRM_NOT_CONSENT: a non-consent foreground modal halts without scanning or clicking", async () => {
    const { page, ctx, counts } = makeFakes({ contentSeq: [DISMISSED_HTML], scanCount: 1 });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.confirmBind).toBe("CONFIRM_NOT_CONSENT");
    expect(r.confirmClicked).toBe(false);
    expect(r.confirmClickedCount).toBe(0);
    expect(counts.evaluate).toBe(0); // never even scans a non-consent modal
    expect(counts.click).toBe(0);
  });

  it("CONFIRM_NOT_FOUND: consent modal but zero affirmative candidates → no click", async () => {
    const { page, ctx, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 0 });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.confirmBind).toBe("CONFIRM_NOT_FOUND");
    expect(r.confirmClicked).toBe(false);
    expect(counts.click).toBe(0);
  });

  it("CONFIRM_NOT_UNIQUE: two affirmative candidates → no click", async () => {
    const { page, ctx, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 2 });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.confirmBind).toBe("CONFIRM_NOT_UNIQUE");
    expect(r.confirmClicked).toBe(false);
    expect(counts.click).toBe(0);
  });

  it("BOUND + download: clicks exactly once and reports DOWNLOAD with a sanitized record", async () => {
    const { page, ctx, counts } = makeFakes({
      contentSeq: [CONSENT_HTML, DISMISSED_HTML],
      scanCount: 1,
      downloadName: "리뷰_행복마켓_20260622.xlsx",
    });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.confirmBind).toBe("BOUND");
    expect(r.confirmClicked).toBe(true);
    expect(r.confirmClickedCount).toBe(1);
    expect(counts.click).toBe(1); // EXACTLY ONE click
    expect(r.confirmOutcome).toBe("DOWNLOAD");
    expect(r.postConfirmDownloadFired).toBe(true);
    expect(r.download?.fired).toBe(true);
    expect(r.download?.extensionCategory).toBe("xlsx");
    expect(r.download?.filenameHash).toMatch(/^[a-f0-9]{16}$/); // hashed, never the raw name
  });

  it("BOUND, modal dismissed, no download → MODAL_DISMISSED_NO_DOWNLOAD", async () => {
    const { page, ctx, counts } = makeFakes({ contentSeq: [CONSENT_HTML, DISMISSED_HTML], scanCount: 1 });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.confirmBind).toBe("BOUND");
    expect(counts.click).toBe(1);
    expect(r.postConfirmDownloadFired).toBe(false);
    expect(r.modalDisappeared).toBe(true);
    expect(r.confirmOutcome).toBe("MODAL_DISMISSED_NO_DOWNLOAD");
  });

  it("BOUND, a follow-up async-job modal appears → ASYNC_JOB", async () => {
    const { page, ctx } = makeFakes({ contentSeq: [CONSENT_HTML, ASYNC_HTML], scanCount: 1 });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.confirmOutcome).toBe("ASYNC_JOB");
    expect(r.followUpModalCategory).toBe("async_job_notice");
    expect(r.postConfirmAsyncJob).toBe(true);
  });

  it("BOUND, the consent modal stays up (click had no effect) → NO_CHANGE", async () => {
    const { page, ctx } = makeFakes({ contentSeq: [CONSENT_HTML, CONSENT_HTML], scanCount: 1 });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.modalDisappeared).toBe(false);
    expect(r.followUpModalCategory).toBeNull();
    expect(r.confirmOutcome).toBe("NO_CHANGE");
  });

  it("a native dialog after the click is recorded (sanitized) and yields NATIVE_DIALOG", async () => {
    const { page, ctx } = makeFakes({
      contentSeq: [CONSENT_HTML, CONSENT_HTML],
      scanCount: 1,
      dialog: { type: "confirm", message: "행복마켓 다운로드를 계속하시겠습니까?" },
    });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.confirmOutcome).toBe("NATIVE_DIALOG");
    expect(r.postConfirmDialogCategory).not.toBe("none");
  });

  it("bind failure when the click cannot resolve still reports clicked:false", async () => {
    const { page, ctx } = makeFakes({ contentSeq: [CONSENT_HTML, CONSENT_HTML], scanCount: 1, clickThrows: true });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.confirmBind).toBe("BOUND"); // the control was bound…
    expect(r.confirmClicked).toBe(false); // …but the click did not resolve
    expect(r.confirmClickedCount).toBe(0);
  });
});

describe("confirmReviewUsageOnce — no raw leak; output keys allow-listed", () => {
  it("PII in modal/filename never appears in the result JSON", async () => {
    const { page, ctx } = makeFakes({
      contentSeq: [PII_CONSENT, PII_CONSENT],
      scanCount: 1,
      downloadName: "행복마켓_1234567_리뷰.xlsx",
      dialog: { type: "confirm", message: "행복마켓 Commerce ID 1234567" },
    });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    const json = JSON.stringify(r);
    expect(json.includes("행복마켓")).toBe(false);
    expect(json.includes("1234567")).toBe(false);
    expect(json.includes(".xlsx")).toBe(false); // extension is a CATEGORY, not the raw name
    expect(/https?:\/\//.test(json)).toBe(false);
    expect(/[<>]/.test(json)).toBe(false);
    expect(Object.keys(r).sort()).toEqual(
      [...REVIEW_USAGE_CONFIRM_KEYS].filter((k) => k in r).sort(),
    );
    for (const k of Object.keys(r)) {
      expect((REVIEW_USAGE_CONFIRM_KEYS as readonly string[]).includes(k)).toBe(true);
    }
  });
});

describe("review-usage-confirm.ts — strict action-adapter source guard", () => {
  const raw = readFileSync(SRC_PATH, "utf8");
  // Strip block + line comments so the guard checks executable source, not prose.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("performs EXACTLY ONE click (no fallback, no retry)", () => {
    expect((code.match(/\.click\s*\(/g) ?? []).length).toBe(1);
  });

  it("allows ONLY read-only DOM access + the download observe", () => {
    expect(/\.evaluate\s*\(/.test(code)).toBe(true);
    expect(/\.locator\s*\(/.test(code)).toBe(true);
    expect(/\.count\s*\(/.test(code)).toBe(true);
    expect(/waitForEvent\s*\(\s*["']download["']/.test(code)).toBe(true);
    expect(/setAttribute\s*\(/.test(code)).toBe(true); // internal stamp only
  });

  it("never persists, uploads, writes status, or runs the capture/other-action verbs", () => {
    expect(/saveAs/.test(code)).toBe(false);
    expect(/uploadReviewFile|\buploadReview\w*/.test(code)).toBe(false);
    expect(/writeStatus/.test(code)).toBe(false);
    expect(/runExport/.test(code)).toBe(false);
    expect(/\.fill\s*\(/.test(code)).toBe(false);
    expect(/\.press\s*\(/.test(code)).toBe(false);
    expect(/\.goto\s*\(/.test(code)).toBe(false);
    expect(/selectOption|dispatchEvent|\.tap\s*\(/.test(code)).toBe(false);
  });

  it("scopes the 확인 scan to the modal container — never a global button sweep", () => {
    expect(/container\.querySelectorAll/.test(code)).toBe(true);
    // no document-wide button enumeration for the candidate set
    expect(/document\.querySelectorAll\(\s*["']button/.test(code)).toBe(false);
  });

  it("imports no live browser driver (narrowed structural interfaces only)", () => {
    const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      expect(/playwright/.test(line)).toBe(false);
      expect(/node:fs|node:http|node:https/.test(line)).toBe(false);
    }
  });
});
