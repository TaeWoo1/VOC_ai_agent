import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  captureHeaderLabels,
  headerLabelArtifactPath,
  HEADER_LABEL_ARTIFACT_BASENAME,
  normalizationForm,
  type HeaderArtifactIo,
} from "../../src/esm/esm-review-header-quarantine";
import type { WorkbookShape } from "../../src/esm/esm-review-schema-shape";

// All labels here are SYNTHETIC / FAKE — never real ESM+ headers (which we have not captured).
const FAKE_HEADERS = ["리뷰내용", "상품명", "평점", "작성일", "구매자명", "review_id"];

function shape(headers: readonly string[], overrides: Partial<WorkbookShape> = {}): WorkbookShape {
  return {
    workbookReadable: true,
    sheetCount: 1,
    selectedSheetIndex: 0,
    rowCount: 3,
    columnCount: headers.length,
    headers: [...headers],
    readerRisks: [],
    ...overrides,
  };
}

/** In-memory artifact writer — captures what would be written, so no real file is touched. */
function fakeIo(): { io: HeaderArtifactIo; writes: Array<{ path: string; contents: string }> } {
  const writes: Array<{ path: string; contents: string }> = [];
  return { io: { writeArtifact: (path, contents) => writes.push({ path, contents }) }, writes };
}

const ARTIFACT = headerLabelArtifactPath(join("/tmp", "unused-in-test-findings"));

describe("captureHeaderLabels — literal labels go ONLY to the artifact, never the summary", () => {
  it("writes labels to the injected artifact but keeps them out of the sanitized summary", () => {
    const { io, writes } = fakeIo();
    const out = captureHeaderLabels(shape(FAKE_HEADERS), { artifactPath: ARTIFACT, io });

    expect(out.workbookReadable).toBe(true);
    expect(out.labelsCapturedToLocalArtifact).toBe(true);
    expect(out.artifactPathCategory).toBe("findings_local_quarantine");
    expect(out.rawHeaderLeak).toBe(false);
    expect(out.schemaMappingConfirmed).toBe(false);
    expect(out.dedupKeyConfirmed).toBe(false);

    // The confinement target received the literal labels...
    expect(writes).toHaveLength(1);
    expect(writes[0]!.path).toBe(ARTIFACT);
    // ...but the returned summary carries NONE of them (distinctive non-hex labels).
    const json = JSON.stringify(out);
    for (const raw of FAKE_HEADERS.filter((h) => /[^0-9a-fA-F_]/.test(h))) {
      expect(writes[0]!.contents).toContain(raw);
      expect(json).not.toContain(raw);
    }
  });

  it("emits a per-header category + normalization form, and a count BUCKET (not the exact count)", () => {
    const { io } = fakeIo();
    const out = captureHeaderLabels(shape(FAKE_HEADERS), { artifactPath: ARTIFACT, io });
    expect(out.perHeader).toHaveLength(FAKE_HEADERS.length);
    // Category reuse: a buyer-name column is a PII risk; a review-text column is review text.
    expect(out.perHeader[0]!.category).toBe("reviewTextCandidate"); // 리뷰내용
    expect(out.perHeader[2]!.category).toBe("ratingCandidate"); // 평점
    expect(out.perHeader[4]!.category).toBe("orderOrBuyerRiskCandidate"); // 구매자명
    expect(out.headerCountBucket).toBe("few"); // 6 headers → "few" (2..9), never an exact count
  });

  it("blank headers are ignored; capture still succeeds on the non-blank ones", () => {
    const { io, writes } = fakeIo();
    const out = captureHeaderLabels(shape(["리뷰내용", "  ", ""]), { artifactPath: ARTIFACT, io });
    expect(out.perHeader).toHaveLength(1);
    expect(out.labelsCapturedToLocalArtifact).toBe(true);
    expect(writes).toHaveLength(1);
  });
});

describe("captureHeaderLabels — fail closed", () => {
  it("unreadable workbook writes nothing and reports not-captured", () => {
    const { io, writes } = fakeIo();
    const out = captureHeaderLabels(shape([], { workbookReadable: false }), { artifactPath: ARTIFACT, io });
    expect(out.workbookReadable).toBe(false);
    expect(out.labelsCapturedToLocalArtifact).toBe(false);
    expect(out.perHeader).toHaveLength(0);
    expect(out.headerCountBucket).toBe("zero");
    expect(writes).toHaveLength(0);
  });

  it("readable but header-less workbook writes nothing", () => {
    const { io, writes } = fakeIo();
    const out = captureHeaderLabels(shape([]), { artifactPath: ARTIFACT, io });
    expect(out.labelsCapturedToLocalArtifact).toBe(false);
    expect(writes).toHaveLength(0);
  });
});

describe("normalizationForm — Unicode form label (never the text)", () => {
  it("classifies NFC / NFD / ascii-invariant correctly", () => {
    const nfc = "각".normalize("NFC"); // precomposed Hangul syllable
    const nfd = "각".normalize("NFD"); // decomposed jamo
    expect(normalizationForm(nfc)).toBe("nfc");
    expect(normalizationForm(nfd)).toBe("nfd");
    expect(normalizationForm("review_id")).toBe("ascii"); // no decomposable chars
    expect(nfc).not.toBe(nfd); // sanity: the two forms really differ
  });

  it("classifies a mixed precomposed+decomposed string as other", () => {
    const mixed = "각" + "가".normalize("NFD"); // one composed syllable + one decomposed
    expect(normalizationForm(mixed)).toBe("other");
  });
});

describe("esm-review-header-quarantine — module purity (sole label handler, no live/upload/status)", () => {
  const __dirname = dirname(fileURLToPath(import.meta.url));
  const SRC = join(__dirname, "..", "..", "src", "esm", "esm-review-header-quarantine.ts");
  const raw = readFileSync(SRC, "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");
  const importLines = code.split("\n").filter((l) => /^\s*import\b/.test(l));

  it("imports no browser / upload / status / scheduler / http / child_process module", () => {
    for (const forbidden of [
      "playwright",
      "../status",
      "../upload",
      "review-download-save",
      "review-upload",
      "node:http",
      "child_process",
    ]) {
      expect(importLines.some((l) => l.includes(forbidden))).toBe(false);
    }
  });

  it("contains no click / download / upload / status / scheduler / wall-clock tokens", () => {
    for (const token of [
      ".click(",
      'waitForEvent("download")',
      "saveAs",
      "writeStatus",
      "uploadReviewFile",
      "manualSync",
      "scheduler",
      "setInterval",
      "setTimeout",
      "cron",
      "Date.now",
      "new Date",
    ]) {
      expect(code.includes(token)).toBe(false);
    }
  });

  it("writes ONLY to the gitignored findings/*.local.md artifact basename", () => {
    expect(code.includes(HEADER_LABEL_ARTIFACT_BASENAME)).toBe(true);
    expect(HEADER_LABEL_ARTIFACT_BASENAME).toMatch(/\.local\.md$/);
    // The only fs write is the single artifact writer.
    expect((code.match(/writeFileSync\s*\(/g) ?? []).length).toBe(1);
  });
});
