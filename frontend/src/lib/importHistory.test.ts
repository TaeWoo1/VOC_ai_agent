import { describe, expect, it } from "vitest";
import type { ReviewImport } from "./types";
import { importOutcome, importTimestamp, provenanceLabel } from "./importHistory";

// What a seller reads about one import. Two cases carry the weight: an EMPTY EXPORT and an
// ALL-DUPLICATE re-import are both correct successes, and reporting either as a failure — or
// flattening them into one indistinguishable "0건" — would tell a seller their working export was
// broken. Each gets its own sentence, and the tests say which is which.

function anImport(over: Partial<ReviewImport> = {}): ReviewImport {
  return {
    id: "import-1",
    method: "SELLER_CENTER_EXPORT",
    status: "SUCCESS",
    totalRows: 6,
    successRows: 6,
    skippedRows: 0,
    failedRows: 0,
    startedAt: "2026-05-10T00:00:00Z",
    finishedAt: "2026-05-10T00:00:05Z",
    ...over,
  };
}

describe("provenanceLabel", () => {
  it("names each provenance the backend can state", () => {
    expect(provenanceLabel("SELLER_CENTER_EXPORT")).toBe("셀러센터 내보내기");
    expect(provenanceLabel("MANUAL_UPLOAD")).toBe("직접 업로드");
  });

  it("says unknown for a row older than the provenance column — never guesses one", () => {
    // `method` is nullable by migration V6: rows that predate it stay valid. Picking either label
    // would attribute an action to the seller (or to SellerOps) that nothing recorded.
    expect(provenanceLabel(null)).toBe("방식 미상");
    expect(provenanceLabel("SOMETHING_NEW")).toBe("방식 미상");
  });
});

describe("importOutcome", () => {
  it("reports what a normal import brought", () => {
    expect(importOutcome(anImport({ successRows: 6 }))).toEqual({
      headline: "새 리뷰 6건",
      detail: "",
      tone: "good",
    });
  });

  it("an EMPTY EXPORT is a success with nothing new — not a failure", () => {
    // The quiet-range case: the seller exported a window that held no reviews. The import worked.
    expect(importOutcome(anImport({ successRows: 0, skippedRows: 0, totalRows: 0 }))).toEqual({
      headline: "새 리뷰 없음",
      detail: "",
      tone: "muted",
    });
  });

  it("an ALL-DUPLICATE re-import says so, distinctly from an empty one", () => {
    // Same headline family, different fact: everything in the file was already collected. The two
    // must not collapse into one string, or a seller cannot tell "nothing there" from "already had it".
    const outcome = importOutcome(anImport({ successRows: 0, skippedRows: 6, totalRows: 6 }));

    expect(outcome).toEqual({ headline: "새로 추가된 리뷰 없음", detail: "중복 6건", tone: "muted" });
    expect(outcome.headline).not.toBe(importOutcome(anImport({ successRows: 0, skippedRows: 0 })).headline);
  });

  it("a PARTIAL still reports what DID land", () => {
    // Hiding the successes would misreport a half-landed import as a total loss.
    expect(importOutcome(anImport({ status: "PARTIAL", successRows: 4, failedRows: 2, totalRows: 6 })))
      .toEqual({ headline: "일부만 저장됐어요 · 새 리뷰 4건", detail: "실패 2건", tone: "warn" });
  });

  it("a FAILED import reads as failed", () => {
    expect(importOutcome(anImport({ status: "FAILED", successRows: 0, failedRows: 3, totalRows: 3 })))
      .toEqual({ headline: "가져오지 못했어요", detail: "실패 3건", tone: "bad" });
  });

  it("a RUNNING import says it did not finish — it never claims to still be progressing", () => {
    // Uploads are synchronous, so a persisted RUNNING row is in practice an import that died
    // mid-flight, and nothing polls it. "진행 중" would keep asserting progress about a run that
    // ended days ago; "완료되지 않았어요" is true whether it is in flight or crashed.
    expect(importOutcome(anImport({ status: "RUNNING", successRows: 0, totalRows: 0, finishedAt: null })))
      .toEqual({ headline: "완료되지 않았어요", detail: "", tone: "warn" });
  });

  it("an unrecognised status reads as unknown rather than being guessed", () => {
    expect(importOutcome(anImport({ status: "SOMETHING_ELSE" })).headline).toBe("상태 미상");
  });

  it("counts are exact, never bucketed", () => {
    expect(importOutcome(anImport({ successRows: 3851 })).headline).toBe("새 리뷰 3851건");
  });

  it("mentions duplicates and failures only when there are some", () => {
    expect(importOutcome(anImport({ successRows: 5, skippedRows: 0, failedRows: 0 })).detail).toBe("");
    expect(importOutcome(anImport({ successRows: 5, skippedRows: 2, failedRows: 1 })).detail)
      .toBe("중복 2건 · 실패 1건");
  });
});

describe("importTimestamp", () => {
  it("uses the finish time when the import ended", () => {
    expect(importTimestamp(anImport())).toBe("2026-05-10T00:00:05Z");
  });

  it("falls back to the start time while it is still running", () => {
    // A running import has no end yet; an empty date would read as missing data, not as in-progress.
    expect(importTimestamp(anImport({ status: "RUNNING", finishedAt: null })))
      .toBe("2026-05-10T00:00:00Z");
  });
});
