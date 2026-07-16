import { describe, expect, it } from "vitest";
import {
  classifyDialogMessage,
  classifyModalCategory,
  decideApprovedIndexBind,
  decideApprovedIndexConfirm,
  decideReviewUsageConfirm,
  decideSaveReviewDownload,
  decideStatusSignalsAfterUpload,
  decideUploadSavedReviewDownload,
  statusDetailAfterUpload,
  decideSupervisedExportReady,
  deriveConfirmOutcome,
  deriveExportClickOutcome,
  diagnosePreClickSignals,
  isAffirmativeConfirmLabel,
  DIALOG_RECORD_KEYS,
  emptyPostClick,
  lengthBucket,
  mergePostClick,
  messageFingerprint,
  parseApprovedIndexArg,
  PRE_CLICK_SIGNAL_KEYS,
  POST_CLICK_SIGNAL_KEYS,
  summarizePostClick,
  type DialogRecord,
  type PostClickSignals,
  type PreClickSignals,
} from "../../src/naver/export-click-signals";
import { evaluateExportTargetReadiness } from "../../src/naver/export-target-readiness";
import { decideState } from "../../src/status";

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

describe("review-usage download-consent classification (legal modal/dialog)", () => {
  /** The legal review-usage consent modal — PII-ish names included to prove no echo. */
  const REVIEW_USAGE_MODAL = `<div class="modal-dialog" role="dialog">
    <p>리뷰 다운로드 및 활용에 유의해 주세요.</p>
    <p>리뷰 작성자 및 저작권자의 권리를 존중해 주세요.</p>
    <p>리뷰데이터 다운로드를 계속하시겠습니까?</p>
    <button class="btn-primary">확인</button></div>`;

  it("the modal classifies as review_usage_confirmation (distinct from a generic confirm)", () => {
    expect(classifyModalCategory(REVIEW_USAGE_MODAL)).toBe("review_usage_confirmation");
  });

  it("is NOT mistaken for date_range / async / a bare confirmation", () => {
    const cat = classifyModalCategory(REVIEW_USAGE_MODAL);
    expect(cat).not.toBe("date_range_required");
    expect(cat).not.toBe("async_job_notice");
    expect(cat).not.toBe("confirmation_required");
  });

  it("the native-dialog form classifies as review_usage_confirmation too", () => {
    expect(classifyDialogMessage("리뷰데이터 다운로드를 계속하시겠습니까?")).toBe("review_usage_confirmation");
    expect(classifyDialogMessage("리뷰 다운로드 및 활용에 유의해 주세요")).toBe("review_usage_confirmation");
  });

  it("summarizePostClick flags reviewUsageConfirmation and folds the outcome distinctly", () => {
    const p = summarizePostClick(REVIEW_USAGE_MODAL);
    expect(p.reviewUsageConfirmation).toBe(true);
    expect(p.modalCategory).toBe("review_usage_confirmation");
    expect(
      deriveExportClickOutcome({ downloadFired: false, dialogPresent: false, post: p, popupOpened: false }),
    ).toBe("REVIEW_USAGE_CONFIRMATION");
  });

  it("the readiness gate does NOT read a consent modal as an empty/no-target page", () => {
    // A consent prompt means reviews EXIST — it must never be conflated with empty_state /
    // no_export_target / date_range_missing by the separate readiness evaluator.
    const r = evaluateExportTargetReadiness(REVIEW_USAGE_MODAL);
    if (r.decision === "HALT") {
      expect(r.state).not.toBe("EXPORT_TARGET_EMPTY");
      expect(r.state).not.toBe("EXPORT_DATE_RANGE_REQUIRED");
    }
  });

  it("never echoes the raw consent text (enums/booleans only)", () => {
    const json = JSON.stringify(summarizePostClick(REVIEW_USAGE_MODAL));
    for (const s of ["리뷰 작성자", "저작권자", "활용에 유의", "계속하시겠습니까"]) {
      expect(json.includes(s)).toBe(false);
    }
    expect(/[<>]/.test(json)).toBe(false);
  });
});

describe("review-usage consent rendered OVER a populated grid (live misclassification fix)", () => {
  // The exact shape a live run misread as DATE_RANGE_REQUIRED: the legal consent modal renders OVER
  // a populated review grid whose background filters carry date/range markers (조회 기간 / 최대 N개월
  // / 시작일·종료일). The review rows behind it mean the export click SUCCEEDED and reviews EXIST.
  const REVIEW_USAGE_OVER_DATE_BG = `<div class="review-management">
    <div class="filters">조회 기간: 최대 3개월 · 시작일 · 종료일</div>
    <table><tbody>
      <tr><td>리뷰1</td></tr><tr><td>리뷰2</td></tr><tr><td>리뷰3</td></tr>
    </tbody></table>
    <div class="modal-dialog" role="dialog" aria-modal="true">
      <p>리뷰 다운로드 및 활용에 유의해 주세요.</p>
      <p>리뷰 작성자 및 저작권자의 권리를 존중해 주세요.</p>
      <p>리뷰데이터 다운로드를 계속하시겠습니까?</p>
      <button class="btn-cancel">취소</button>
      <button class="btn-primary">확인</button>
    </div></div>`;

  it("classifies as review_usage_confirmation, NOT date_range_required, despite background date markers", () => {
    const cat = classifyModalCategory(REVIEW_USAGE_OVER_DATE_BG);
    expect(cat).toBe("review_usage_confirmation");
    expect(cat).not.toBe("date_range_required");
  });

  it("summarizePostClick keeps the modal category as review_usage_confirmation (background date markers still reported)", () => {
    const p = summarizePostClick(REVIEW_USAGE_OVER_DATE_BG);
    expect(p.modalCategory).toBe("review_usage_confirmation");
    expect(p.reviewUsageConfirmation).toBe(true);
    expect(p.dateRangeRequired).toBe(true); // the report may still note background date markers…
  });

  it("when BOTH reviewUsageConfirmation and dateRangeRequired are true → outcome REVIEW_USAGE_CONFIRMATION", () => {
    const p = summarizePostClick(REVIEW_USAGE_OVER_DATE_BG);
    expect(
      deriveExportClickOutcome({ downloadFired: false, dialogPresent: false, post: p, popupOpened: false }),
    ).toBe("REVIEW_USAGE_CONFIRMATION"); // …but the actionable foreground gate is the consent
  });

  it("a real download still wins over the review-usage gate", () => {
    const p = summarizePostClick(REVIEW_USAGE_OVER_DATE_BG);
    expect(
      deriveExportClickOutcome({ downloadFired: true, dialogPresent: false, post: p, popupOpened: false }),
    ).toBe("DOWNLOAD");
  });

  it("a PURE date-range modal (no review-usage markers) STILL classifies/derives as date_range", () => {
    const p = summarizePostClick(PII_MODAL); // date-range modal, no review-usage text
    expect(p.modalCategory).toBe("date_range_required");
    expect(p.reviewUsageConfirmation).toBe(false);
    expect(deriveExportClickOutcome({ downloadFired: false, dialogPresent: false, post: p, popupOpened: false })).toBe(
      "DATE_RANGE_REQUIRED",
    );
  });

  it("native-dialog path: a consent message that also mentions a period is review_usage_confirmation", () => {
    expect(classifyDialogMessage("리뷰데이터 다운로드를 계속하시겠습니까? (조회 기간 최대 3개월)")).toBe(
      "review_usage_confirmation",
    );
  });

  it("never echoes the raw modal/background text (enums/booleans only)", () => {
    const json = JSON.stringify(summarizePostClick(REVIEW_USAGE_OVER_DATE_BG));
    for (const s of ["리뷰 작성자", "저작권자", "활용에 유의", "조회 기간", "시작일", "종료일", "리뷰1"]) {
      expect(json.includes(s)).toBe(false);
    }
    expect(/[<>]/.test(json)).toBe(false);
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

describe("selectedRangePresent — the KNOWN blind spots (D-025; placeholder, do not promote)", () => {
  // WHY THIS BLOCK EXISTS. Run 5 (§8-18) produced the detector's first live reading —
  // `selectedRangePresent: false`, agreeing with an operator who had selected nothing. That is one
  // TRUE NEGATIVE. The positive direction has never been observed on any real surface: the ONLY
  // `true` anywhere in this repo is the one-line string above, authored to satisfy the regex.
  //
  // The mechanism that predicts it may NEVER read `true` live: the regex matches the `value`
  // ATTRIBUTE in serialized HTML, but every live read is `page.content()` serialization, and a
  // user- or JS-set input value updates the IDL PROPERTY and leaves the attribute untouched. So an
  // SPA date picker — which live `dateRangeControlPresence: "some"` (6-20 date-ish controls)
  // suggests — can be fully populated and still serialize as `value=""`.
  //
  // These cases pin the boundary honestly. They assert `false` NOT because false is desirable, but
  // because that is what the detector does today, and D-025 turns on knowing exactly how far it can
  // see. Each is a plausible real shape. If a live run ever reports `true` with a range selected,
  // the detector is validated and these expectations should be revisited against that evidence —
  // per `collector/CLAUDE.md` §4 item 6, corrected from observed findings, never guess-tuned.
  const BLIND_SPOTS: Array<[string, string]> = [
    ["a date input with no value attribute (the property-set shape)", `<input type="date">`],
    ["a picker whose value attribute stays empty after selection", `<input type="text" class="date-picker" value="">`],
    ["a range rendered as text rather than an input value", `<span class="date-display">2026-06-01 ~ 2026-06-30</span>`],
    ["a range held in a sibling element, not the control", `<input type="date"><div class="selected-range">2026-06-01 ~ 2026-06-30</div>`],
    ["value BEFORE the type attribute (the regex requires type first)", `<input value="2026-06-01" type="date">`],
  ];

  for (const [label, html] of BLIND_SPOTS) {
    it(`reads false for: ${label}`, () => {
      expect(diagnosePreClickSignals(html).selectedRangePresent).toBe(false);
    });
  }

  it("is NOT hardwired to false — the class= branch and the type= branch both fire", () => {
    // Offline we KNOW the detector is not stuck at false; earlier notes claimed "a hardwired false
    // would look identical" to Run 5's reading, and that is not true. What is unknown is only
    // whether NAVER's real surface ever serializes into a shape the regex can see.
    expect(diagnosePreClickSignals(`<input type="date" value="2026-06-01">`).selectedRangePresent).toBe(true);
    expect(diagnosePreClickSignals(`<input class="x date-picker y" value="2026-06-01">`).selectedRangePresent).toBe(true);
  });

  it("a populated range does not disturb the date-control count bucket", () => {
    // The two fields are independent regexes: presence counts controls, selected reads a value.
    // Run 5's `some` + `false` pairing is therefore internally consistent, not contradictory.
    const s = diagnosePreClickSignals(`<input type="date"><input type="date"><div class="calendar"></div>`);
    expect(s.dateRangeControlPresence).toBe("few");
    expect(s.selectedRangePresent).toBe(false);
  });
});

describe("decideSupervisedExportReady — light readiness for the supervised-fast path", () => {
  const base: PreClickSignals = {
    exportLayout: "LAYOUT_UNRECOGNIZED",
    exportActionable: false,
    dateRangeControlPresence: "none",
    selectedRangePresent: false,
    modalOpen: false,
    toastRegionPresent: false,
  };

  it("is ready when an actionable SYNC_DOWNLOAD control is present", () => {
    expect(decideSupervisedExportReady(diagnosePreClickSignals(SYNC_HTML))).toBe(true);
    expect(decideSupervisedExportReady({ ...base, exportLayout: "SYNC_DOWNLOAD", exportActionable: true })).toBe(true);
  });

  it("ignores HTML empty-state: readiness depends only on the actionable sync control", () => {
    // A surface with a (false-positive) hidden empty placeholder still reports SYNC_DOWNLOAD +
    // actionable from the visible control — the supervised path must treat it as ready.
    const withHiddenEmpty = `<main><button id="exp">엑셀 다운로드</button>
      <div style="display:none">검색 결과가 없습니다</div></main>`;
    const pre = diagnosePreClickSignals(withHiddenEmpty);
    expect(pre.exportLayout).toBe("SYNC_DOWNLOAD");
    expect(decideSupervisedExportReady(pre)).toBe(true);
  });

  it("is NOT ready when the sync control exists but is not actionable", () => {
    expect(decideSupervisedExportReady({ ...base, exportLayout: "SYNC_DOWNLOAD", exportActionable: false })).toBe(false);
  });

  it("is NOT ready for an async-job layout, even if actionable", () => {
    expect(decideSupervisedExportReady({ ...base, exportLayout: "ASYNC_JOB_DETECTED", exportActionable: true })).toBe(false);
  });

  it("is NOT ready for an unrecognized layout", () => {
    expect(decideSupervisedExportReady(base)).toBe(false);
  });
});

describe("decideReviewUsageConfirm — flag-gated, consent-only confirm attempt", () => {
  it("SKIP_NO_FLAG when the flag is absent (default: never auto-confirm)", () => {
    expect(decideReviewUsageConfirm({ outcome: "REVIEW_USAGE_CONFIRMATION", confirmFlag: false })).toBe("SKIP_NO_FLAG");
  });

  it("SKIP_NOT_CONSENT when the click did not reach the consent gate, even with the flag", () => {
    expect(decideReviewUsageConfirm({ outcome: "DATE_RANGE_REQUIRED", confirmFlag: true })).toBe("SKIP_NOT_CONSENT");
    expect(decideReviewUsageConfirm({ outcome: "DOWNLOAD", confirmFlag: true })).toBe("SKIP_NOT_CONSENT");
    expect(decideReviewUsageConfirm({ outcome: "NO_OP", confirmFlag: true })).toBe("SKIP_NOT_CONSENT");
  });

  it("ATTEMPT only when the flag is set AND the outcome is review-usage consent", () => {
    expect(decideReviewUsageConfirm({ outcome: "REVIEW_USAGE_CONFIRMATION", confirmFlag: true })).toBe("ATTEMPT");
  });
});

describe("isAffirmativeConfirmLabel — affirmative wins, cancel/close always excluded", () => {
  it("accepts affirmative labels", () => {
    for (const label of ["확인", "계속", "다운로드", "동의", "Confirm", "OK"]) {
      expect(isAffirmativeConfirmLabel(label)).toBe(true);
    }
  });

  it("rejects pure cancel/close labels", () => {
    for (const label of ["취소", "닫기", "Cancel", "Close"]) {
      expect(isAffirmativeConfirmLabel(label)).toBe(false);
    }
  });

  it("rejects a control that matches BOTH (cancel exclusion wins)", () => {
    // e.g. a "취소 확인" composite label must never be treated as the affirmative control.
    expect(isAffirmativeConfirmLabel("취소 확인")).toBe(false);
    expect(isAffirmativeConfirmLabel("확인 취소")).toBe(false);
  });

  it("rejects a label with no affirmative marker", () => {
    expect(isAffirmativeConfirmLabel("뒤로")).toBe(false);
    expect(isAffirmativeConfirmLabel("")).toBe(false);
  });
});

describe("deriveConfirmOutcome — post-확인 precedence", () => {
  const base = {
    downloadFired: false,
    dialogPresent: false,
    modalDisappeared: false,
    followUpModalCategory: null,
    asyncJobMarkerPresent: false,
  };

  it("a fired download is the definitive answer", () => {
    expect(deriveConfirmOutcome({ ...base, downloadFired: true })).toBe("DOWNLOAD");
    // download wins even if a follow-up modal also appears
    expect(deriveConfirmOutcome({ ...base, downloadFired: true, followUpModalCategory: "async_job_notice" })).toBe(
      "DOWNLOAD",
    );
  });

  it("a native dialog blocks everything below download", () => {
    expect(deriveConfirmOutcome({ ...base, dialogPresent: true })).toBe("NATIVE_DIALOG");
  });

  it("an async-job notice (marker or follow-up modal) is ASYNC_JOB", () => {
    expect(deriveConfirmOutcome({ ...base, asyncJobMarkerPresent: true })).toBe("ASYNC_JOB");
    expect(deriveConfirmOutcome({ ...base, followUpModalCategory: "async_job_notice" })).toBe("ASYNC_JOB");
  });

  it("a NEW non-consent modal is FOLLOW_UP_MODAL", () => {
    expect(deriveConfirmOutcome({ ...base, followUpModalCategory: "date_range_required" })).toBe("FOLLOW_UP_MODAL");
  });

  it("modal closed with no download is MODAL_DISMISSED_NO_DOWNLOAD", () => {
    expect(deriveConfirmOutcome({ ...base, modalDisappeared: true })).toBe("MODAL_DISMISSED_NO_DOWNLOAD");
  });

  it("nothing observed (consent modal still up) is NO_CHANGE", () => {
    expect(deriveConfirmOutcome(base)).toBe("NO_CHANGE");
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
      reviewUsageConfirmation: false,
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

describe("parseApprovedIndexArg — strict non-negative integer after the value flag", () => {
  const FLAG = "--diagnose-confirm-review-usage-index";
  it("parses a non-negative integer in the token after the flag", () => {
    expect(parseApprovedIndexArg([FLAG, "2"])).toBe(2);
    expect(parseApprovedIndexArg([FLAG, "0"])).toBe(0);
    expect(parseApprovedIndexArg(["--diagnose-export-click", FLAG, "10", "--x"])).toBe(10);
  });
  it("returns null when the flag is absent", () => {
    expect(parseApprovedIndexArg(["--diagnose-export-click"])).toBeNull();
    expect(parseApprovedIndexArg([])).toBeNull();
  });
  it("returns null when the value is missing, negative, or non-integer", () => {
    expect(parseApprovedIndexArg([FLAG])).toBeNull(); // no value token
    expect(parseApprovedIndexArg([FLAG, "-1"])).toBeNull();
    expect(parseApprovedIndexArg([FLAG, "2.5"])).toBeNull();
    expect(parseApprovedIndexArg([FLAG, "abc"])).toBeNull();
    expect(parseApprovedIndexArg([FLAG, "--next-flag"])).toBeNull();
  });
});

describe("decideApprovedIndexConfirm — flag+index gated, consent-only attempt", () => {
  it("SKIP_NO_INDEX when not requested or the index did not parse", () => {
    expect(
      decideApprovedIndexConfirm({ outcome: "REVIEW_USAGE_CONFIRMATION", indexRequested: false, parsedIndex: 2 }),
    ).toBe("SKIP_NO_INDEX");
    expect(
      decideApprovedIndexConfirm({ outcome: "REVIEW_USAGE_CONFIRMATION", indexRequested: true, parsedIndex: null }),
    ).toBe("SKIP_NO_INDEX");
  });
  it("SKIP_NOT_CONSENT when the click did not reach the consent gate", () => {
    expect(decideApprovedIndexConfirm({ outcome: "DATE_RANGE_REQUIRED", indexRequested: true, parsedIndex: 2 })).toBe(
      "SKIP_NOT_CONSENT",
    );
    expect(decideApprovedIndexConfirm({ outcome: "DOWNLOAD", indexRequested: true, parsedIndex: 2 })).toBe(
      "SKIP_NOT_CONSENT",
    );
  });
  it("ATTEMPT only when requested, a valid index parsed, AND the outcome is consent", () => {
    expect(
      decideApprovedIndexConfirm({ outcome: "REVIEW_USAGE_CONFIRMATION", indexRequested: true, parsedIndex: 2 }),
    ).toBe("ATTEMPT");
    expect(
      decideApprovedIndexConfirm({ outcome: "REVIEW_USAGE_CONFIRMATION", indexRequested: true, parsedIndex: 0 }),
    ).toBe("ATTEMPT");
  });
});

describe("decideApprovedIndexBind — index must be an affirmative, visible, enabled control", () => {
  // The live scan shape: index 0/1 cancel, index 2 affirmative — all visible/enabled.
  const CANDIDATES = [
    { index: 0, buttonKind: "cancel", visible: true, enabled: true },
    { index: 1, buttonKind: "cancel", visible: true, enabled: true },
    { index: 2, buttonKind: "affirmative", visible: true, enabled: true },
  ];

  it("BOUND for the affirmative visible+enabled index", () => {
    expect(decideApprovedIndexBind({ candidates: CANDIDATES, requestedIndex: 2 })).toBe("BOUND");
  });
  it("INDEX_NOT_FOUND when the requested index is out of range", () => {
    expect(decideApprovedIndexBind({ candidates: CANDIDATES, requestedIndex: 5 })).toBe("INDEX_NOT_FOUND");
  });
  it("INDEX_NOT_AFFIRMATIVE for a cancel index (operator can't bind 0/1)", () => {
    expect(decideApprovedIndexBind({ candidates: CANDIDATES, requestedIndex: 0 })).toBe("INDEX_NOT_AFFIRMATIVE");
    expect(decideApprovedIndexBind({ candidates: CANDIDATES, requestedIndex: 1 })).toBe("INDEX_NOT_AFFIRMATIVE");
  });
  it("INDEX_NOT_VISIBLE / INDEX_DISABLED in precedence order (affirmative first, then visible, then enabled)", () => {
    expect(
      decideApprovedIndexBind({
        candidates: [{ index: 0, buttonKind: "affirmative", visible: false, enabled: true }],
        requestedIndex: 0,
      }),
    ).toBe("INDEX_NOT_VISIBLE");
    expect(
      decideApprovedIndexBind({
        candidates: [{ index: 0, buttonKind: "affirmative", visible: true, enabled: false }],
        requestedIndex: 0,
      }),
    ).toBe("INDEX_DISABLED");
  });
});

describe("decideSaveReviewDownload — save only when requested + clicked + a download fired", () => {
  const base = { saveRequested: true, approvedIndexClicked: true, downloadFired: true, saveSucceeded: true };
  it("NOT_REQUESTED when the flag is absent", () => {
    expect(decideSaveReviewDownload({ ...base, saveRequested: false })).toBe("NOT_REQUESTED");
  });
  it("NOT_CLICKED when the approved-index click did not land", () => {
    expect(decideSaveReviewDownload({ ...base, approvedIndexClicked: false })).toBe("NOT_CLICKED");
  });
  it("NO_DOWNLOAD when no download fired", () => {
    expect(decideSaveReviewDownload({ ...base, downloadFired: false })).toBe("NO_DOWNLOAD");
  });
  it("SAVED when requested + clicked + download fired + inspection succeeded", () => {
    expect(decideSaveReviewDownload(base)).toBe("SAVED");
  });
  it("SAVE_FAILED when the save/validate cycle did not succeed", () => {
    expect(decideSaveReviewDownload({ ...base, saveSucceeded: false })).toBe("SAVE_FAILED");
  });
});

describe("decideUploadSavedReviewDownload — upload only when requested + saved + a real .xlsx", () => {
  const base = { uploadRequested: true, downloadSaved: true, xlsxReadable: true, uploadSucceeded: true };
  it("NOT_REQUESTED when the upload flag is absent", () => {
    expect(decideUploadSavedReviewDownload({ ...base, uploadRequested: false })).toBe("NOT_REQUESTED");
  });
  it("NOT_SAVED when the download was never saved", () => {
    expect(decideUploadSavedReviewDownload({ ...base, downloadSaved: false })).toBe("NOT_SAVED");
  });
  it("NOT_READABLE when the saved file is not structurally a real .xlsx", () => {
    expect(decideUploadSavedReviewDownload({ ...base, xlsxReadable: false })).toBe("NOT_READABLE");
  });
  it("UPLOADED when requested + saved + readable + the backend accepted the ingest", () => {
    expect(decideUploadSavedReviewDownload(base)).toBe("UPLOADED");
  });
  it("UPLOAD_FAILED when the backend did not accept the ingest", () => {
    expect(decideUploadSavedReviewDownload({ ...base, uploadSucceeded: false })).toBe("UPLOAD_FAILED");
  });
});

describe("decideStatusSignalsAfterUpload — map the diagnostic upload onto decideState (PR B)", () => {
  const cap = { downloadFired: true, downloadSaved: true, xlsxReadable: true } as const;
  const ld = { paired: true as const, session: "LOGGED_IN" as const };

  it("download not fired/saved/readable → DOWNLOAD_FAILED, NOT_ATTEMPTED → state DOWNLOAD_FAILED", () => {
    for (const bad of [
      { ...cap, downloadFired: false },
      { ...cap, downloadSaved: false },
      { ...cap, xlsxReadable: false },
    ]) {
      const s = decideStatusSignalsAfterUpload({ ...bad, uploadReason: "UPLOADED", ingestStatusCategory: "COMPLETED" });
      expect(s).toEqual({ exportOutcome: "DOWNLOAD_FAILED", uploadOutcome: "NOT_ATTEMPTED" });
      expect(decideState({ ...ld, ...s })).toBe("DOWNLOAD_FAILED");
    }
  });

  it("UPLOADED + COMPLETED → CAPTURED, OK → LAST_SUCCESS", () => {
    const s = decideStatusSignalsAfterUpload({ ...cap, uploadReason: "UPLOADED", ingestStatusCategory: "COMPLETED" });
    expect(s).toEqual({ exportOutcome: "CAPTURED", uploadOutcome: "OK" });
    expect(decideState({ ...ld, ...s })).toBe("LAST_SUCCESS");
  });

  it("UPLOADED + PARTIAL → CAPTURED, OK → LAST_SUCCESS (success-with-warnings)", () => {
    const s = decideStatusSignalsAfterUpload({ ...cap, uploadReason: "UPLOADED", ingestStatusCategory: "PARTIAL" });
    expect(s).toEqual({ exportOutcome: "CAPTURED", uploadOutcome: "OK" });
    expect(decideState({ ...ld, ...s })).toBe("LAST_SUCCESS");
  });

  it("UPLOADED + FAILED or UNKNOWN → CAPTURED, FAILED → UPLOAD_FAILED", () => {
    for (const cat of ["FAILED", "UNKNOWN"] as const) {
      const s = decideStatusSignalsAfterUpload({ ...cap, uploadReason: "UPLOADED", ingestStatusCategory: cat });
      expect(s).toEqual({ exportOutcome: "CAPTURED", uploadOutcome: "FAILED" });
      expect(decideState({ ...ld, ...s })).toBe("UPLOAD_FAILED");
    }
  });

  it("UPLOAD_FAILED (backend unavailable/threw) → CAPTURED, FAILED → UPLOAD_FAILED", () => {
    const s = decideStatusSignalsAfterUpload({ ...cap, uploadReason: "UPLOAD_FAILED" });
    expect(s).toEqual({ exportOutcome: "CAPTURED", uploadOutcome: "FAILED" });
    expect(decideState({ ...ld, ...s })).toBe("UPLOAD_FAILED");
  });
});

describe("statusDetailAfterUpload — sanitized buckets/categories only, never raw data", () => {
  const inspection = {
    uploaded: true as const,
    ingestStatusCategory: "PARTIAL" as const,
    syncJobIdHash: "deadbeefdeadbeef",
    totalRowsBucket: "tens" as const,
    successRowsBucket: "tens" as const,
    skippedRowsBucket: "few" as const,
    failedRowsBucket: "few" as const,
    hasErrorMessage: true,
    sampleErrorPresent: true,
  };

  it("UPLOADED → buckets + ingest category, never exact counts / syncJobId / filename", () => {
    const d = statusDetailAfterUpload({ downloadSaveReason: "SAVED", uploadReason: "UPLOADED", uploaded: inspection });
    expect(d).toBe("upload UPLOADED PARTIAL total=tens success=tens skipped=few failed=few");
    expect(/\d/.test(d)).toBe(false); // no exact counts
    expect(d.includes("deadbeef")).toBe(false); // no syncJobIdHash
    expect(d.includes(".xlsx")).toBe(false); // no filename
  });

  it("UPLOAD_FAILED → bare category, no backend error body", () => {
    expect(statusDetailAfterUpload({ downloadSaveReason: "SAVED", uploadReason: "UPLOAD_FAILED" })).toBe("upload UPLOAD_FAILED");
  });

  it("not a validated capture → reflects the save reason only", () => {
    expect(statusDetailAfterUpload({ downloadSaveReason: "SAVE_FAILED", uploadReason: "NOT_READABLE" })).toBe(
      "download not validated: SAVE_FAILED",
    );
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
