import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  confirmReviewUsageByIndexOnce,
  confirmReviewUsageOnce,
  REVIEW_USAGE_CANDIDATES_KEYS,
  REVIEW_USAGE_CONFIRM_INDEX_KEYS,
  REVIEW_USAGE_CONFIRM_KEYS,
  scanReviewUsageConfirmCandidates,
  type ConfirmContext,
  type ConfirmDeps,
  type ConfirmDialog,
  type ConfirmDownload,
  type ConfirmPage,
} from "../../src/naver/review-usage-confirm";
import type { SavedDownloadInspection } from "../../src/naver/review-download-save";

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
  /** what the bind in-page scan returns (affirmative match count). */
  scanCount: number;
  /** what the candidate in-page scan returns (overrides scanCount for that evaluate). */
  candidatesReturn?: { candidates: Array<{ index: number; kind: string; visible: boolean; enabled: boolean; textLength: number }> };
  /** what locator(stamp).count() returns (default = scanCount). */
  locatorCount?: number;
  /** if set, waitForEvent("download") resolves with this suggested filename. */
  downloadName?: string;
  /** if set, a native dialog fires. */
  dialog?: { type: string; message: string };
  /** force the click to throw (control not actionable). */
  clickThrows?: boolean;
  /** force page.content() to throw (closed/detached page). */
  contentThrows?: boolean;
  /** force page.evaluate() to throw (context destroyed). */
  evaluateThrows?: boolean;
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
      if (opts.contentThrows) throw new Error("Target page, context or browser has been closed");
      const i = Math.min(counts.content, opts.contentSeq.length - 1);
      counts.content += 1;
      return opts.contentSeq[i] ?? "";
    },
    async evaluate(_fn: unknown, _arg: unknown): Promise<unknown> {
      counts.evaluate += 1;
      if (opts.evaluateThrows) throw new Error("Execution context was destroyed");
      if (opts.candidatesReturn !== undefined) return opts.candidatesReturn;
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
    async waitForEvent(
      _event: "download",
    ): Promise<{ suggestedFilename: () => string; saveAs: (p: string) => Promise<void> }> {
      if (opts.downloadName) {
        return { suggestedFilename: () => opts.downloadName as string, saveAs: async () => undefined };
      }
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

describe("confirmReviewUsageOnce — controlled save hook (saveDownloadFn) [PR C1 parity]", () => {
  const SAVED_FIXTURE: SavedDownloadInspection = {
    downloadSaved: true,
    savedPathCategory: "downloads_diagnostic_quarantine",
    savedBasenameHash: "abcdef0123456789",
    savedExtensionCategory: "xlsx",
    fileSizeBucket: "small",
    xlsxReadable: true,
    workbookContentValidation: "deferred",
    rawCellLeak: false,
    fileRetained: false,
    retentionPolicy: "delete-after-validate",
    deleteFailed: false,
  };

  it("invokes the save hook once with the fired download and surfaces savedDownload (semantic path)", async () => {
    const { page, ctx } = makeFakes({ contentSeq: [CONSENT_HTML, DISMISSED_HTML], scanCount: 1, downloadName: "리뷰_행복마켓.xlsx" });
    let calls = 0;
    let gotName = "";
    const saveDownloadFn = async (d: ConfirmDownload): Promise<SavedDownloadInspection> => {
      calls += 1;
      gotName = d.suggestedFilename();
      return SAVED_FIXTURE;
    };
    const r = await confirmReviewUsageOnce(page, ctx, { ...DEPS, saveDownloadFn });
    expect(r.confirmClicked).toBe(true);
    expect(r.postConfirmDownloadFired).toBe(true);
    expect(calls).toBe(1); // exactly once…
    expect(gotName).toBe("리뷰_행복마켓.xlsx"); // …with the real download (sanitization happens INSIDE the hook)
    expect(r.savedDownload).toEqual(SAVED_FIXTURE);
  });

  it("does NOT invoke the save hook when no download fires (semantic path)", async () => {
    const { page, ctx } = makeFakes({ contentSeq: [CONSENT_HTML, DISMISSED_HTML], scanCount: 1 });
    let calls = 0;
    const r = await confirmReviewUsageOnce(page, ctx, {
      ...DEPS,
      saveDownloadFn: async (): Promise<SavedDownloadInspection> => {
        calls += 1;
        return SAVED_FIXTURE;
      },
    });
    expect(r.postConfirmDownloadFired).toBe(false);
    expect(calls).toBe(0);
    expect(r.savedDownload).toBeUndefined();
  });

  it("without a save hook, a fired download is observed-and-discarded (no savedDownload)", async () => {
    const { page, ctx } = makeFakes({ contentSeq: [CONSENT_HTML, DISMISSED_HTML], scanCount: 1, downloadName: "리뷰.xlsx" });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.postConfirmDownloadFired).toBe(true);
    expect(r.savedDownload).toBeUndefined();
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

describe("confirmReviewUsageOnce — read failures degrade to a sanitized halt (never throw)", () => {
  it("a closed page on the re-confirm read → CONFIRM_READ_FAILED, no click, no throw", async () => {
    const { page, ctx, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 1, contentThrows: true });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.confirmBind).toBe("CONFIRM_READ_FAILED");
    expect(r.confirmClicked).toBe(false);
    expect(r.confirmClickedCount).toBe(0);
    expect(r.confirmOutcome).toBe("NO_CHANGE");
    expect(counts.click).toBe(0);
  });

  it("a destroyed context during the bind scan → CONFIRM_READ_FAILED, no click, no throw", async () => {
    const { page, ctx, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 1, evaluateThrows: true });
    const r = await confirmReviewUsageOnce(page, ctx, DEPS);
    expect(r.confirmBind).toBe("CONFIRM_READ_FAILED");
    expect(counts.click).toBe(0);
  });
});

describe("scanReviewUsageConfirmCandidates — NO-CLICK candidate-index diagnostic", () => {
  const RAW_CANDIDATES = {
    candidates: [
      { index: 0, kind: "cancel", visible: true, enabled: true, textLength: 2 },
      { index: 1, kind: "affirmative", visible: true, enabled: true, textLength: 2 },
      { index: 2, kind: "other", visible: false, enabled: false, textLength: 5 },
    ],
  };

  it("scans the consent modal and reports sanitized per-candidate metadata, never clicking", async () => {
    const { page, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 1, candidatesReturn: RAW_CANDIDATES });
    const r = await scanReviewUsageConfirmCandidates(page);
    expect(r.candidateScan).toBe("SCANNED");
    expect(counts.click).toBe(0); // NEVER clicks in candidate mode
    expect(r.candidateIndices).toEqual([0, 1, 2]);
    expect(r.candidateCountBucket).toBe("few");
    expect(r.candidates.map((c) => c.buttonKind)).toEqual(["cancel", "affirmative", "other"]);
    expect(r.candidates[0]?.visible).toBe(true);
    expect(r.candidates[2]?.enabled).toBe(false);
    // metadata is bucketed, not raw lengths
    expect(r.candidates[0]?.textLengthBucket).toBe("tiny");
  });

  it("reports MULTIPLE candidates without clicking any", async () => {
    const many = {
      candidates: Array.from({ length: 4 }, (_v, i) => ({
        index: i,
        kind: i === 1 ? "affirmative" : "other",
        visible: true,
        enabled: true,
        textLength: 3,
      })),
    };
    const { page, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 1, candidatesReturn: many });
    const r = await scanReviewUsageConfirmCandidates(page);
    expect(r.candidates.length).toBe(4);
    expect(counts.click).toBe(0);
  });

  it("CONFIRM_NOT_CONSENT when the foreground modal is not the consent modal (no scan)", async () => {
    const { page, counts } = makeFakes({ contentSeq: [DISMISSED_HTML], scanCount: 0 });
    const r = await scanReviewUsageConfirmCandidates(page);
    expect(r.candidateScan).toBe("CONFIRM_NOT_CONSENT");
    expect(r.candidates).toEqual([]);
    expect(counts.evaluate).toBe(0); // never scans a non-consent modal
    expect(counts.click).toBe(0);
  });

  it("CONFIRM_READ_FAILED on a closed page / destroyed context (no throw)", async () => {
    const closed = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 0, contentThrows: true });
    expect((await scanReviewUsageConfirmCandidates(closed.page)).candidateScan).toBe("CONFIRM_READ_FAILED");
    const destroyed = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 0, evaluateThrows: true });
    const r = await scanReviewUsageConfirmCandidates(destroyed.page);
    expect(r.candidateScan).toBe("CONFIRM_READ_FAILED");
    expect(destroyed.counts.click).toBe(0);
  });

  it("candidate metadata carries no raw text/selector; output keys allow-listed", async () => {
    const piiRaw = {
      candidates: [{ index: 0, kind: "affirmative", visible: true, enabled: true, textLength: 12 }],
    };
    const { page } = makeFakes({ contentSeq: [PII_CONSENT], scanCount: 1, candidatesReturn: piiRaw });
    const r = await scanReviewUsageConfirmCandidates(page);
    const json = JSON.stringify(r);
    expect(json.includes("행복마켓")).toBe(false);
    expect(json.includes("확인")).toBe(false); // no raw button text
    expect(/[<>]/.test(json)).toBe(false);
    for (const k of Object.keys(r)) {
      expect((REVIEW_USAGE_CANDIDATES_KEYS as readonly string[]).includes(k)).toBe(true);
    }
    for (const c of r.candidates) {
      expect(Object.keys(c).sort()).toEqual(["buttonKind", "enabled", "index", "textLengthBucket", "visible"]);
    }
  });
});

describe("confirmReviewUsageByIndexOnce — clicks EXACTLY the operator-approved index, observe-only", () => {
  /** The live scan shape: index 0/1 cancel, index 2 affirmative — all visible/enabled. */
  const CANDS = {
    candidates: [
      { index: 0, kind: "cancel", visible: true, enabled: true, textLength: 2 },
      { index: 1, kind: "cancel", visible: true, enabled: true, textLength: 2 },
      { index: 2, kind: "affirmative", visible: true, enabled: true, textLength: 2 },
    ],
  };

  it("ATTEMPT/BOUND: the approved affirmative index → clicks once and observes DOWNLOAD", async () => {
    const { page, ctx, counts } = makeFakes({
      contentSeq: [CONSENT_HTML, DISMISSED_HTML],
      scanCount: 1,
      candidatesReturn: CANDS,
      locatorCount: 1,
      downloadName: "리뷰_행복마켓_20260622.xlsx",
    });
    const r = await confirmReviewUsageByIndexOnce(page, ctx, DEPS, 2);
    expect(r.approvedIndex).toBe(2);
    expect(r.approvedIndexDecision).toBe("ATTEMPT");
    expect(r.approvedIndexBind).toBe("BOUND");
    expect(r.approvedIndexClicked).toBe(true);
    expect(r.approvedIndexClickedCount).toBe(1);
    expect(counts.click).toBe(1); // EXACTLY ONE click
    expect(r.confirmOutcome).toBe("DOWNLOAD");
    expect(r.download?.extensionCategory).toBe("xlsx");
    expect(r.download?.filenameHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("REJECT_NOT_AFFIRMATIVE: a cancel index (0/1) → no click", async () => {
    const { page, ctx, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 1, candidatesReturn: CANDS });
    const r0 = await confirmReviewUsageByIndexOnce(page, ctx, DEPS, 0);
    expect(r0.approvedIndexDecision).toBe("REJECT_NOT_AFFIRMATIVE");
    expect(r0.approvedIndexBind).toBe("INDEX_NOT_AFFIRMATIVE");
    expect(r0.approvedIndexClicked).toBe(false);
    expect(counts.click).toBe(0);
  });

  it("REJECT_MISSING: an out-of-range index → no click", async () => {
    const { page, ctx, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 1, candidatesReturn: CANDS });
    const r = await confirmReviewUsageByIndexOnce(page, ctx, DEPS, 9);
    expect(r.approvedIndexDecision).toBe("REJECT_MISSING");
    expect(r.approvedIndexBind).toBe("INDEX_NOT_FOUND");
    expect(counts.click).toBe(0);
  });

  it("REJECT_NOT_VISIBLE: an invisible affirmative index → no click", async () => {
    const cands = { candidates: [{ index: 0, kind: "affirmative", visible: false, enabled: true, textLength: 2 }] };
    const { page, ctx, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 1, candidatesReturn: cands });
    const r = await confirmReviewUsageByIndexOnce(page, ctx, DEPS, 0);
    expect(r.approvedIndexDecision).toBe("REJECT_NOT_VISIBLE");
    expect(r.approvedIndexBind).toBe("INDEX_NOT_VISIBLE");
    expect(counts.click).toBe(0);
  });

  it("REJECT_DISABLED: a disabled affirmative index → no click", async () => {
    const cands = { candidates: [{ index: 0, kind: "affirmative", visible: true, enabled: false, textLength: 2 }] };
    const { page, ctx, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 1, candidatesReturn: cands });
    const r = await confirmReviewUsageByIndexOnce(page, ctx, DEPS, 0);
    expect(r.approvedIndexDecision).toBe("REJECT_DISABLED");
    expect(r.approvedIndexBind).toBe("INDEX_DISABLED");
    expect(counts.click).toBe(0);
  });

  it("SKIP_NOT_CONSENT: a non-consent foreground modal → no scan/click", async () => {
    const { page, ctx, counts } = makeFakes({ contentSeq: [DISMISSED_HTML], scanCount: 0 });
    const r = await confirmReviewUsageByIndexOnce(page, ctx, DEPS, 2);
    expect(r.approvedIndexDecision).toBe("SKIP_NOT_CONSENT");
    expect(r.approvedIndexBind).toBe("CONFIRM_NOT_CONSENT");
    expect(counts.evaluate).toBe(0); // the scan never evaluates a non-consent modal
    expect(counts.click).toBe(0);
  });

  it("CONFIRM_READ_FAILED: a closed page during the rescan → no click, no throw", async () => {
    const { page, ctx, counts } = makeFakes({ contentSeq: [CONSENT_HTML], scanCount: 1, contentThrows: true });
    const r = await confirmReviewUsageByIndexOnce(page, ctx, DEPS, 2);
    expect(r.approvedIndexBind).toBe("CONFIRM_READ_FAILED");
    expect(r.approvedIndexClicked).toBe(false);
    expect(counts.click).toBe(0);
  });

  it("INDEX_NOT_UNIQUE: valid metadata but the stamped locator resolves to ≠1 → no click", async () => {
    const { page, ctx, counts } = makeFakes({
      contentSeq: [CONSENT_HTML],
      scanCount: 1,
      candidatesReturn: CANDS,
      locatorCount: 2,
    });
    const r = await confirmReviewUsageByIndexOnce(page, ctx, DEPS, 2);
    expect(r.approvedIndexDecision).toBe("ATTEMPT"); // metadata validated, but the live bind wasn't unique
    expect(r.approvedIndexBind).toBe("INDEX_NOT_UNIQUE");
    expect(r.approvedIndexClicked).toBe(false);
    expect(counts.click).toBe(0);
  });

  it("no raw leak; output keys allow-listed", async () => {
    const piiCands = { candidates: [{ index: 0, kind: "affirmative", visible: true, enabled: true, textLength: 12 }] };
    const { page, ctx } = makeFakes({
      contentSeq: [PII_CONSENT, PII_CONSENT],
      scanCount: 1,
      candidatesReturn: piiCands,
      locatorCount: 1,
      downloadName: "행복마켓_1234567_리뷰.xlsx",
      dialog: { type: "confirm", message: "행복마켓 Commerce ID 1234567" },
    });
    const r = await confirmReviewUsageByIndexOnce(page, ctx, DEPS, 0);
    const json = JSON.stringify(r);
    expect(json.includes("행복마켓")).toBe(false);
    expect(json.includes("1234567")).toBe(false);
    expect(json.includes(".xlsx")).toBe(false); // extension is a CATEGORY, not the raw name
    expect(/https?:\/\//.test(json)).toBe(false);
    expect(/[<>]/.test(json)).toBe(false);
    for (const k of Object.keys(r)) {
      expect((REVIEW_USAGE_CONFIRM_INDEX_KEYS as readonly string[]).includes(k)).toBe(true);
    }
  });
});

describe("confirmReviewUsageByIndexOnce — controlled save hook (saveDownloadFn)", () => {
  const CANDS = {
    candidates: [
      { index: 0, kind: "cancel", visible: true, enabled: true, textLength: 2 },
      { index: 1, kind: "cancel", visible: true, enabled: true, textLength: 2 },
      { index: 2, kind: "affirmative", visible: true, enabled: true, textLength: 2 },
    ],
  };
  const SAVED_FIXTURE: SavedDownloadInspection = {
    downloadSaved: true,
    savedPathCategory: "downloads_diagnostic_quarantine",
    savedBasenameHash: "abcdef0123456789",
    savedExtensionCategory: "xlsx",
    fileSizeBucket: "small",
    xlsxReadable: true,
    workbookContentValidation: "deferred",
    rawCellLeak: false,
    fileRetained: false,
    retentionPolicy: "delete-after-validate",
    deleteFailed: false,
  };

  it("invokes the save hook once with the fired download and surfaces savedDownload", async () => {
    const { page, ctx } = makeFakes({
      contentSeq: [CONSENT_HTML, DISMISSED_HTML],
      scanCount: 1,
      candidatesReturn: CANDS,
      locatorCount: 1,
      downloadName: "리뷰_행복마켓.xlsx",
    });
    let calls = 0;
    let gotName = "";
    const saveDownloadFn = async (d: ConfirmDownload): Promise<SavedDownloadInspection> => {
      calls += 1;
      gotName = d.suggestedFilename();
      return SAVED_FIXTURE;
    };
    const r = await confirmReviewUsageByIndexOnce(page, ctx, { ...DEPS, saveDownloadFn }, 2);
    expect(r.approvedIndexClicked).toBe(true);
    expect(r.postConfirmDownloadFired).toBe(true);
    expect(calls).toBe(1); // hook invoked exactly once…
    expect(gotName).toBe("리뷰_행복마켓.xlsx"); // …with the real download (sanitization happens INSIDE the hook)
    expect(r.savedDownload).toEqual(SAVED_FIXTURE);
  });

  it("does NOT invoke the save hook when no download fires", async () => {
    const { page, ctx } = makeFakes({ contentSeq: [CONSENT_HTML, DISMISSED_HTML], scanCount: 1, candidatesReturn: CANDS, locatorCount: 1 });
    let calls = 0;
    const saveDownloadFn = async (): Promise<SavedDownloadInspection> => {
      calls += 1;
      return SAVED_FIXTURE;
    };
    const r = await confirmReviewUsageByIndexOnce(page, ctx, { ...DEPS, saveDownloadFn }, 2);
    expect(r.postConfirmDownloadFired).toBe(false);
    expect(calls).toBe(0);
    expect(r.savedDownload).toBeUndefined();
  });

  it("without a save hook, a fired download is observed-and-discarded (no savedDownload)", async () => {
    const { page, ctx } = makeFakes({
      contentSeq: [CONSENT_HTML, DISMISSED_HTML],
      scanCount: 1,
      candidatesReturn: CANDS,
      locatorCount: 1,
      downloadName: "리뷰.xlsx",
    });
    const r = await confirmReviewUsageByIndexOnce(page, ctx, DEPS, 2);
    expect(r.postConfirmDownloadFired).toBe(true);
    expect(r.savedDownload).toBeUndefined();
  });
});

describe("review-usage-confirm.ts — strict action-adapter source guard", () => {
  const raw = readFileSync(SRC_PATH, "utf8");
  // Strip block + line comments so the guard checks executable source, not prose.
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("performs EXACTLY TWO clicks (one per confirm adapter — single-affirmative + approved-index)", () => {
    // One `.click(` in confirmReviewUsageOnce's thunk, one in confirmReviewUsageByIndexOnce's thunk;
    // the candidate scan stays click-free. The shared observe helper calls the thunk, adding none.
    expect((code.match(/\.click\s*\(/g) ?? []).length).toBe(2);
  });

  it("allows ONLY read-only DOM access + the download observe", () => {
    expect(/\.evaluate\s*\(/.test(code)).toBe(true);
    expect(/\.locator\s*\(/.test(code)).toBe(true);
    expect(/\.count\s*\(/.test(code)).toBe(true);
    expect(/waitForEvent\s*\(\s*["']download["']/.test(code)).toBe(true);
    expect(/setAttribute\s*\(/.test(code)).toBe(true); // internal stamp only
  });

  it("never persists, uploads, writes status, or runs the capture/other-action verbs", () => {
    // The adapter may DECLARE/forward a download's `saveAs` (the type member + the injected save hook),
    // but it must never CALL `.saveAs(` itself — the actual file write is confined to review-download-save.ts.
    expect(/\.saveAs\s*\(/.test(code)).toBe(false);
    expect(/uploadReviewFile|\buploadReview\w*/.test(code)).toBe(false);
    expect(/writeStatus/.test(code)).toBe(false);
    expect(/runExport/.test(code)).toBe(false);
    expect(/\bmkdirSync\b|\bunlinkSync\b|\bwriteFileSync\b|node:fs/.test(code)).toBe(false); // no fs in the adapter
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

  // --- esbuild keepNames (`__name`) safety: every page.evaluate callback must be an INLINE
  //     anonymous arrow with NO inner named declarations. A named top-level function reference or a
  //     named inner helper becomes `__name(...)`, undefined in the page → ReferenceError. ---

  it("never references the esbuild keepNames helper `__name(`", () => {
    expect(code.includes("__name(")).toBe(false);
  });

  it("passes ONLY inline anonymous arrows to page.evaluate (no named function reference)", () => {
    // Every `.evaluate(` must be immediately followed by `(` (an arrow param list), never an identifier.
    const calls = code.match(/\.evaluate\s*\(\s*[^)]/g) ?? [];
    expect(calls.length).toBeGreaterThan(0);
    for (const c of calls) {
      // the char after `.evaluate(` (and optional ws) must be `(` — the start of an arrow's params.
      expect(/\.evaluate\s*\(\s*\(/.test(c)).toBe(true);
    }
    // and there is no `.evaluate(` whose first non-space arg is an identifier (a named fn reference).
    expect(/\.evaluate\s*\(\s*[A-Za-z_$]/.test(code)).toBe(false);
  });

  it("has no named inner helper inside any evaluate body (the __name trigger)", () => {
    // Slice each evaluate body conservatively (from `.evaluate((` to the next `}, ` arg boundary)
    // and assert no `const NAME = (...) =>` and no `function NAME(` inside.
    const bodies = code.split(/\.evaluate\s*\(\s*\(/).slice(1);
    expect(bodies.length).toBeGreaterThan(0);
    for (const tail of bodies) {
      const body = tail.slice(0, tail.indexOf("}, "));
      expect(/const\s+[A-Za-z_$][\w$]*\s*(?::[^=]+)?=\s*(?:async\s*)?\([^)]*\)\s*=>/.test(body)).toBe(false);
      expect(/\bfunction\s+[A-Za-z_$]/.test(body)).toBe(false);
    }
  });

  it("the candidate diagnostic body performs NO click", () => {
    const start = code.indexOf("async function scanReviewUsageConfirmCandidates");
    const end = code.indexOf("function readFailedCandidates");
    expect(start).toBeGreaterThanOrEqual(0);
    expect(end).toBeGreaterThan(start);
    const body = code.slice(start, end);
    expect(/\.click\s*\(/.test(body)).toBe(false);
  });

  it("the approved-index body binds via the cand-index stamp with a count() guard BEFORE its click", () => {
    const start = code.indexOf("async function confirmReviewUsageByIndexOnce");
    expect(start).toBeGreaterThanOrEqual(0);
    const body = code.slice(start);
    // binds the operator-approved index via the SAME stamp the scan writes (never a global selector)…
    expect(/CAND_INDEX_ATTR/.test(body)).toBe(true);
    expect(/document\.querySelectorAll/.test(body)).toBe(false);
    // …and the single click is preceded by a count() uniqueness guard.
    const countIdx = body.indexOf(".count(");
    const clickIdx = body.indexOf(".click(");
    expect(countIdx).toBeGreaterThanOrEqual(0);
    expect(clickIdx).toBeGreaterThan(countIdx);
  });
});
