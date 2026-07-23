/**
 * Unit tests for the Action Window artifact PARSE gate — the answer to "the quarantine sniff said
 * valid, but is it actually a workbook?".
 *
 * The two verdicts answer different questions and this suite keeps them apart: the D-021 sniff reads
 * ZIP magic plus the `[Content_Types].xml` entry NAME in the head; the parse gate walks the
 * container. Covers the real committed artifacts (both directions), the payload shapes a hostile or
 * broken download produces, the sanitized boolean-only surface, and the module's source guard.
 *
 * `dataRowPresent` is asserted as **observed and non-gating** — an empty-but-valid export is a
 * legitimate seller outcome, and `parseOk` must not depend on it.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

import {
  ARTIFACT_PARSE_VERDICT_KEYS,
  artifactParseVerdict,
  type ArtifactParseVerdict,
} from "../../src/action-window/artifact-parse";
import { sniffXlsxReadable } from "../../src/naver/review-download-save";
import { reviewExportBytes, reviewExportEmptyBytes } from "../support/review-export-fixture";

/** ZIP local-header magic + the content-types entry NAME — what the D-021 sniff looks for. */
function sniffShapedNonWorkbook(): Uint8Array {
  const tail = new TextEncoder().encode("[Content_Types].xml (sellerops synthetic fixture)");
  const out = new Uint8Array(10 + tail.length);
  out.set([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00], 0);
  out.set(tail, 10);
  return out;
}

const utf8 = (s: string): Uint8Array => new TextEncoder().encode(s);

describe("artifactParseVerdict — the real artifacts", () => {
  it("accepts the committed export and sees its data rows", () => {
    expect(artifactParseVerdict(reviewExportBytes())).toEqual({
      workbookReadable: true,
      sheetPresent: true,
      dataRowPresent: true,
      parseOk: true,
    });
  });

  it("accepts the committed EMPTY export — no data rows is not a failure", () => {
    // The legitimate quiet-range export. `dataRowPresent` is false and `parseOk` is true: that
    // separation is the whole point, and a real header-only export has been observed in the wild.
    expect(artifactParseVerdict(reviewExportEmptyBytes())).toEqual({
      workbookReadable: true,
      sheetPresent: true,
      dataRowPresent: false,
      parseOk: true,
    });
  });
});

describe("artifactParseVerdict — the gap the sniff cannot see", () => {
  it("rejects a payload the D-021 sniff accepts", () => {
    const bytes = sniffShapedNonWorkbook();

    // Both halves asserted together, so the test states the actual finding rather than implying it.
    expect(sniffXlsxReadable(bytes)).toBe(true);
    expect(artifactParseVerdict(bytes)).toEqual({
      workbookReadable: false,
      sheetPresent: false,
      dataRowPresent: false,
      parseOk: false,
    });
  });
});

describe("artifactParseVerdict — malformed and hostile payloads fail closed", () => {
  const cases: Array<[string, Uint8Array]> = [
    ["empty bytes", new Uint8Array(0)],
    ["a few bytes, shorter than any header", new Uint8Array([0x50, 0x4b])],
    ["plain text", utf8("상품번호,상품명,리뷰상세내용\n1,합성,합성 본문\n")],
    ["an HTML interstitial", utf8("<!doctype html><html><body>세션이 만료되었습니다</body></html>")],
    ["ZIP magic then garbage", new Uint8Array([0x50, 0x4b, 0x03, 0x04, ...new Array(64).fill(0xff)])],
  ];

  for (const [label, bytes] of cases) {
    it(`${label} → parseOk false`, () => {
      expect(artifactParseVerdict(bytes).parseOk).toBe(false);
    });
  }

  it("a truncated real workbook fails closed rather than throwing", () => {
    // A download cut off mid-flight: the head is a genuine OOXML head, so the sniff is satisfied,
    // but the central directory is gone.
    const full = reviewExportBytes();
    const truncated = full.slice(0, Math.floor(full.length / 2));

    expect(sniffXlsxReadable(truncated)).toBe(true);
    expect(() => artifactParseVerdict(truncated)).not.toThrow();
    expect(artifactParseVerdict(truncated).parseOk).toBe(false);
  });

  it("never throws, whatever the bytes", () => {
    for (const [, bytes] of cases) {
      expect(() => artifactParseVerdict(bytes)).not.toThrow();
    }
  });
});

describe("artifactParseVerdict — the sanitized surface", () => {
  it("returns booleans only, exactly the allow-listed keys", () => {
    const verdict = artifactParseVerdict(reviewExportBytes());

    expect(Object.keys(verdict).sort()).toEqual([...ARTIFACT_PARSE_VERDICT_KEYS].sort());
    for (const key of ARTIFACT_PARSE_VERDICT_KEYS) {
      expect(typeof verdict[key]).toBe("boolean");
    }
  });

  it("carries no header text, cell value, sheet name, or count", () => {
    // The underlying reader resolves a header row internally; none of it may surface here. The
    // committed fixture's headers and its PII-class sentinels are the probes.
    const serialized = JSON.stringify(artifactParseVerdict(reviewExportBytes()));

    for (const token of ["리뷰글번호", "리뷰상세내용", "상품주문번호", "MUST-NOT-PERSIST", "Sheet0"]) {
      expect(serialized.includes(token), token).toBe(false);
    }
    expect(serialized).not.toMatch(/\d/); // no counts, no indexes — booleans only
  });

  it("`parseOk` does NOT depend on dataRowPresent", () => {
    // Stated as an invariant, not just observed on one fixture: the only false `dataRowPresent`
    // among readable workbooks still yields `parseOk`.
    const verdicts: ArtifactParseVerdict[] = [
      artifactParseVerdict(reviewExportBytes()),
      artifactParseVerdict(reviewExportEmptyBytes()),
    ];

    expect(verdicts.map((v) => v.dataRowPresent)).toEqual([true, false]);
    expect(verdicts.every((v) => v.parseOk)).toBe(true);
  });
});

describe("artifact-parse module — source guard", () => {
  const srcPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/action-window/artifact-parse.ts");
  const stripComments = (code: string): string =>
    code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join("\n");

  it("reaches no filesystem, network, browser, upload, or console path", () => {
    const code = stripComments(readFileSync(srcPath, "utf8"));
    const banned = [
      /node:fs/,
      /node:net/,
      /node:http/,
      /child_process/,
      /playwright/i,
      /fetch\s*\(/,
      /console\./,
      /\.\.\/upload/,
      /exceljs|xlsx-populate|sheetjs/i,
    ];
    for (const re of banned) expect(re.test(code), `artifact-parse.ts :: ${re}`).toBe(false);

    // The one allowed reach: the pure, buffer-in workbook reader (node:zlib only).
    expect(code).toMatch(/from\s*["']\.\.\/xlsx\/workbook-shape-read["']/);
  });

  it("returns no header/cell vocabulary from its own source", () => {
    const code = stripComments(readFileSync(srcPath, "utf8"));
    for (const token of ["headers", "headerCells", "sampleRows", "readerRisks"]) {
      expect(code.includes(token), `artifact-parse.ts :: ${token}`).toBe(false);
    }
  });
});
