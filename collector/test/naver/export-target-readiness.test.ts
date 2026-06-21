import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  evaluateExportTargetReadiness,
  EXPORT_TARGET_READINESS_KEYS,
} from "../../src/naver/export-target-readiness";

// --- realistic fixtures -------------------------------------------------------

/** A populated review grid: header row excluded, three data rows in the body. */
const POSITIVE_ROWS = `<table class="review-grid">
  <thead><tr><th>리뷰</th><th>평점</th></tr></thead>
  <tbody>
    <tr><td>좋아요</td><td>5</td></tr>
    <tr><td>괜찮아요</td><td>4</td></tr>
    <tr><td>최고</td><td>5</td></tr>
  </tbody>
</table>`;

/** A labeled positive result count, with the number wrapped in a tag (NAVER-style). */
const POSITIVE_COUNT = `<div class="result-summary">전체 <strong>128</strong>건</div><div id="grid"></div>`;

/** An explicit zero result count. */
const ZERO_COUNT = `<div class="result-summary">총 0건</div>`;

/** A results container that exists but holds no body rows. */
const ZERO_ROWS = `<table class="review-grid"><thead><tr><th>리뷰</th></tr></thead><tbody></tbody></table>`;

/** An in-table empty-state placeholder (one colspan row of text, no data). */
const EMPTY_STATE = `<table class="review-grid"><tbody><tr><td colspan="6">검색 결과가 없습니다.</td></tr></tbody></table>`;

/** The exact observed export alert, surfaced as an in-page notice. */
const NO_EXPORT_TARGET = `<div class="empty-notice">엑셀다운로드 대상인 리뷰가 없습니다.</div>`;

/** A positive "please pick a period" instruction with an empty date input. */
const DATE_RANGE_MISSING = `<div class="guide">조회 기간을 선택해 주세요.</div><input type="text" name="startDate" value="">`;

/** An SPA shell that rendered no recognizable result structure yet. */
const AMBIGUOUS = `<div id="app-root"><div class="spinner"></div></div>`;

describe("evaluateExportTargetReadiness — positive evidence proceeds", () => {
  it("populated data rows → READY / positive_rows", () => {
    const r = evaluateExportTargetReadiness(POSITIVE_ROWS);
    expect(r).toEqual({ decision: "READY", rowCountBucket: "few", reason: "positive_rows" });
  });

  it("a positive labeled result count → READY / positive_count", () => {
    const r = evaluateExportTargetReadiness(POSITIVE_COUNT);
    expect(r.decision).toBe("READY");
    if (r.decision === "READY") {
      expect(r.reason).toBe("positive_count");
      expect(r.rowCountBucket).toBe("many"); // 128 → many
    }
  });
});

describe("evaluateExportTargetReadiness — emptiness halts before the click", () => {
  it("an explicit export-no-target notice → EXPORT_TARGET_EMPTY / no_export_target", () => {
    expect(evaluateExportTargetReadiness(NO_EXPORT_TARGET)).toEqual({
      decision: "HALT",
      state: "EXPORT_TARGET_EMPTY",
      reason: "no_export_target",
    });
  });

  it("a generic in-table empty-state placeholder → EXPORT_TARGET_EMPTY / empty_state", () => {
    expect(evaluateExportTargetReadiness(EMPTY_STATE)).toEqual({
      decision: "HALT",
      state: "EXPORT_TARGET_EMPTY",
      reason: "empty_state",
    });
  });

  it("an explicit zero result count → EXPORT_TARGET_EMPTY / empty_state", () => {
    expect(evaluateExportTargetReadiness(ZERO_COUNT)).toEqual({
      decision: "HALT",
      state: "EXPORT_TARGET_EMPTY",
      reason: "empty_state",
    });
  });

  it("a results container with zero body rows → EXPORT_TARGET_EMPTY / zero_rows", () => {
    expect(evaluateExportTargetReadiness(ZERO_ROWS)).toEqual({
      decision: "HALT",
      state: "EXPORT_TARGET_EMPTY",
      reason: "zero_rows",
    });
  });

  it("the empty-state marker wins even when a placeholder row is present (conservative)", () => {
    // EMPTY_STATE has a <tr><td> but is classified empty, never positive_rows.
    expect(evaluateExportTargetReadiness(EMPTY_STATE).decision).toBe("HALT");
  });
});

describe("evaluateExportTargetReadiness — date-range and ambiguity", () => {
  it("a positive required-range marker with no selected range → EXPORT_DATE_RANGE_REQUIRED", () => {
    expect(evaluateExportTargetReadiness(DATE_RANGE_MISSING)).toEqual({
      decision: "HALT",
      state: "EXPORT_DATE_RANGE_REQUIRED",
      reason: "date_range_missing",
    });
  });

  it("an unreadable SPA shell → EXPORT_TARGET_UNKNOWN / ambiguous (never a blind click)", () => {
    expect(evaluateExportTargetReadiness(AMBIGUOUS)).toEqual({
      decision: "HALT",
      state: "EXPORT_TARGET_UNKNOWN",
      reason: "ambiguous",
    });
  });

  it("commented-out empty/required markers never trip detection", () => {
    const html = `<!-- 검색 결과가 없습니다 / 기간을 선택해 주세요 -->${POSITIVE_ROWS}`;
    expect(evaluateExportTargetReadiness(html).decision).toBe("READY");
  });
});

describe("evaluateExportTargetReadiness — sanitized output (no leak)", () => {
  /** Hostile rows: store, Commerce id, reviewer, raw review text — none may appear. */
  const PII = `<table class="review-grid"><tbody>
    <tr><td>행복마켓</td><td>Commerce ID 1234567</td><td>홍길동</td><td>정말 최악이에요 환불해주세요</td></tr>
  </tbody></table>`;

  it("classifies PII-laden rows as READY while echoing none of the content", () => {
    const r = evaluateExportTargetReadiness(PII);
    expect(r.decision).toBe("READY");
    const json = JSON.stringify(r);
    for (const s of ["행복마켓", "1234567", "홍길동", "정말 최악이에요 환불해주세요"]) {
      expect(json.includes(s)).toBe(false);
    }
    expect(/[<>]/.test(json)).toBe(false); // no raw HTML
    expect(/https?:\/\//.test(json)).toBe(false);
  });

  it("every result carries only allow-listed keys (enums + a coarse bucket)", () => {
    const samples = [POSITIVE_ROWS, POSITIVE_COUNT, ZERO_ROWS, EMPTY_STATE, NO_EXPORT_TARGET, DATE_RANGE_MISSING, AMBIGUOUS];
    for (const html of samples) {
      const r = evaluateExportTargetReadiness(html);
      for (const k of Object.keys(r)) {
        expect(EXPORT_TARGET_READINESS_KEYS).toContain(k);
      }
    }
  });
});

describe("export-target-readiness.ts — source guard: pure, offline, no DOM action", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "naver", "export-target-readiness.ts");
  const raw = readFileSync(SRC, "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("performs no click/navigation/capture/upload/status write and reaches no live API", () => {
    expect(/\.(click|fill|press|selectOption|check|dispatchEvent|tap)\s*\(/.test(code)).toBe(false);
    expect(/\.goto\s*\(/.test(code)).toBe(false);
    expect(/runExport|saveAs|waitForEvent|uploadReviewFile|writeStatus/.test(code)).toBe(false);
  });

  it("imports no fs/http/playwright (browser-free pure leaf)", () => {
    const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));
    for (const line of importLines) {
      expect(/node:fs|node:http|playwright/.test(line)).toBe(false);
    }
  });
});
