import { describe, expect, it } from "vitest";
import {
  classifyDialogMessage,
  classifyModalCategory,
  deriveExportClickOutcome,
  diagnosePreClickSignals,
  DIALOG_RECORD_KEYS,
  emptyPostClick,
  lengthBucket,
  mergePostClick,
  messageFingerprint,
  PRE_CLICK_SIGNAL_KEYS,
  POST_CLICK_SIGNAL_KEYS,
  summarizePostClick,
  type DialogRecord,
  type PostClickSignals,
} from "../../src/naver/export-click-signals";

/** A realistic single-control sync export surface (one visible enabled Excel button). */
const SYNC_HTML = `<main><button id="exp">엑셀 다운로드</button>
  <input type="date" name="from"><input type="date" name="to"></main>`;

/** PII-laden fixtures — used to prove nothing is ever echoed. */
const PII_DIALOG = "스토어 '행복마켓' (Commerce ID 1234567) 조회 기간은 최대 3개월 입니다";
const PII_MODAL = `<div class="modal-dialog" role="dialog">
  <p>판매자 행복마켓 님, 조회 기간을 선택하세요 (시작일/종료일)</p>
  <button class="btn-primary">확인</button></div>`;

describe("lengthBucket — coarse, monotonic", () => {
  it("buckets by size without exposing the length", () => {
    expect(lengthBucket(0)).toBe("empty");
    expect(lengthBucket(8)).toBe("tiny");
    expect(lengthBucket(40)).toBe("short");
    expect(lengthBucket(200)).toBe("medium");
    expect(lengthBucket(201)).toBe("long");
  });
});

describe("messageFingerprint — salted, one-way, stable", () => {
  it("is a 16-hex digest, deterministic, salt-sensitive, and whitespace-stable", () => {
    const a = messageFingerprint("salt", "조회 기간 오류");
    expect(a).toMatch(/^[a-f0-9]{16}$/);
    expect(messageFingerprint("salt", "조회 기간 오류")).toBe(a); // deterministic
    expect(messageFingerprint("salt", "  조회   기간 오류  ")).toBe(a); // whitespace-normalized
    expect(messageFingerprint("other", "조회 기간 오류")).not.toBe(a); // salt changes it
  });

  it("never embeds the raw message", () => {
    const fp = messageFingerprint("s", PII_DIALOG);
    expect(fp.includes("행복마켓")).toBe(false);
    expect(fp).toMatch(/^[a-f0-9]{16}$/);
  });
});

describe("classifyModalCategory — fixed categories or null", () => {
  it("returns null when no modal marker is present", () => {
    expect(classifyModalCategory("<main><button>엑셀</button></main>")).toBeNull();
  });
  it("date-range modal → date_range_required", () => {
    expect(classifyModalCategory(PII_MODAL)).toBe("date_range_required");
  });
  it("async-job notice wins over a plain confirm", () => {
    expect(
      classifyModalCategory(`<div role="dialog">다운로드 목록에서 확인하세요 <button>확인</button></div>`),
    ).toBe("async_job_notice");
  });
  it("generic confirm modal → confirmation_required", () => {
    expect(classifyModalCategory(`<div class="modal">계속하시겠습니까? <button>확인</button></div>`)).toBe(
      "confirmation_required",
    );
  });
  it("modal with no recognized wording → unknown_modal", () => {
    expect(classifyModalCategory(`<div role="alertdialog"><span>…</span></div>`)).toBe("unknown_modal");
  });
});

describe("classifyDialogMessage — fixed categories, never the text", () => {
  it("classifies date-range / confirmation / error / async / other", () => {
    expect(classifyDialogMessage("조회 기간을 선택하세요")).toBe("date_range");
    expect(classifyDialogMessage(PII_DIALOG)).toBe("date_range");
    expect(classifyDialogMessage("계속하시겠습니까?")).toBe("confirmation");
    expect(classifyDialogMessage("엑셀 다운로드에 실패했습니다")).toBe("error_warning");
    expect(classifyDialogMessage("다운로드 목록에서 받으세요")).toBe("async_job");
    expect(classifyDialogMessage("안녕하세요")).toBe("other");
  });
});

describe("diagnosePreClickSignals — sanitized pre-click snapshot", () => {
  it("reads the sync layout, actionable, and date-range presence", () => {
    const s = diagnosePreClickSignals(SYNC_HTML);
    expect(s.exportLayout).toBe("SYNC_DOWNLOAD");
    expect(s.exportActionable).toBe(true);
    expect(s.dateRangeControlPresence).toBe("few"); // two date inputs
    expect(s.modalOpen).toBe(false);
    expect(s.toastRegionPresent).toBe(false);
  });

  it("detects a pre-existing modal + a filled range", () => {
    const html = `<div class="modal-dialog"><input type="date" value="2026-06-01"></div>`;
    const s = diagnosePreClickSignals(html);
    expect(s.modalOpen).toBe(true);
    expect(s.selectedRangePresent).toBe(true);
  });

  it("only ever emits the allow-listed keys", () => {
    const s = diagnosePreClickSignals(SYNC_HTML);
    expect(Object.keys(s).sort()).toEqual([...PRE_CLICK_SIGNAL_KEYS].sort());
  });
});

describe("summarizePostClick + mergePostClick — accumulate observations", () => {
  it("summarizes one snapshot into sanitized booleans/category", () => {
    const p = summarizePostClick(PII_MODAL);
    expect(p.modalOpen).toBe(true);
    expect(p.modalCategory).toBe("date_range_required");
    expect(p.dateRangeRequired).toBe(true);
    expect(Object.keys(p).sort()).toEqual([...POST_CLICK_SIGNAL_KEYS].sort());
  });

  it("OR-accumulates booleans and keeps the FIRST modal category", () => {
    const a = summarizePostClick(`<div class="modal">계속 <button>확인</button></div>`); // confirmation_required
    const b = summarizePostClick(`<div class="toast">처리 중</div>`); // toast + async marker
    const m = mergePostClick(a, b);
    expect(m.modalCategory).toBe("confirmation_required"); // first wins
    expect(m.toastPresent).toBe(true);
    expect(m.asyncJobMarkerPresent).toBe(true);
  });

  it("empty accumulator is all-false/null", () => {
    expect(emptyPostClick()).toEqual({
      modalOpen: false,
      modalCategory: null,
      toastPresent: false,
      asyncJobMarkerPresent: false,
      dateRangeRequired: false,
    });
  });
});

describe("deriveExportClickOutcome — deliberate precedence", () => {
  const base: PostClickSignals = emptyPostClick();
  it("download beats everything", () => {
    expect(
      deriveExportClickOutcome({
        downloadFired: true,
        dialogPresent: true,
        post: { ...base, modalOpen: true, dateRangeRequired: true },
        popupOpened: true,
      }),
    ).toBe("DOWNLOAD");
  });
  it("native dialog beats modal/toast/popup", () => {
    expect(
      deriveExportClickOutcome({
        downloadFired: false,
        dialogPresent: true,
        post: { ...base, modalOpen: true, dateRangeRequired: true },
        popupOpened: true,
      }),
    ).toBe("NATIVE_DIALOG");
  });
  it("date-range requirement beats a generic modal", () => {
    expect(
      deriveExportClickOutcome({
        downloadFired: false,
        dialogPresent: false,
        post: { ...base, modalOpen: true, dateRangeRequired: true },
        popupOpened: false,
      }),
    ).toBe("DATE_RANGE_REQUIRED");
  });
  it("falls through modal → async → toast → popup → no_op", () => {
    const mk = (over: Partial<PostClickSignals>, popup = false): ReturnType<typeof deriveExportClickOutcome> =>
      deriveExportClickOutcome({ downloadFired: false, dialogPresent: false, post: { ...base, ...over }, popupOpened: popup });
    expect(mk({ modalOpen: true })).toBe("MODAL");
    expect(mk({ asyncJobMarkerPresent: true })).toBe("ASYNC_JOB");
    expect(mk({ toastPresent: true })).toBe("TOAST");
    expect(mk({}, true)).toBe("POPUP");
    expect(mk({})).toBe("NO_OP");
  });
});

describe("no-leak — hostile PII fixtures never appear in any record", () => {
  it("dialog record carries only enums/bucket/hash", () => {
    const rec: DialogRecord = {
      type: "alert",
      messageCategory: classifyDialogMessage(PII_DIALOG),
      messageLengthBucket: lengthBucket(PII_DIALOG.length),
      messageHash: messageFingerprint("s", PII_DIALOG),
      action: "accepted",
    };
    const json = JSON.stringify(rec);
    expect(json.includes("행복마켓")).toBe(false);
    expect(json.includes("1234567")).toBe(false);
    expect(/[<>]/.test(json)).toBe(false);
    expect(Object.keys(rec).sort()).toEqual([...DIALOG_RECORD_KEYS].sort());
  });

  it("pre/post snapshots of PII HTML contain no raw substrings or hashes-of-store", () => {
    const json = JSON.stringify({
      pre: diagnosePreClickSignals(PII_MODAL),
      post: summarizePostClick(PII_MODAL),
    });
    expect(json.includes("행복마켓")).toBe(false);
    expect(/https?:\/\//.test(json)).toBe(false);
    expect(/[a-f0-9]{16,}/.test(json)).toBe(false); // no hash/id shapes in structural snapshots
  });
});
