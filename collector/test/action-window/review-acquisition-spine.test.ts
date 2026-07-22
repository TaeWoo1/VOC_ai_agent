/**
 * **Review Acquisition Spine v1 — the collector half of the joint.**
 *
 * The spine is: a synthetic guided export produces an artifact → the Action Window quarantine
 * validates it → the validated bytes are handed to the existing ingest path → the reviews become
 * operator-visible. Every segment already existed; nothing joined them, and the synthetic path could
 * never reach ingest because its artifact was not a workbook.
 *
 * This suite pins the collector-side segments against the COMMITTED golden artifact
 * (`contracts/review-export/naver/v1`), which `ReviewAcquisitionSpineTest` on the backend ingests
 * byte-for-byte. The artifact and `expected-rows.json` are the joint: both ports read the same file
 * and assert the same rows, so the two halves can no longer agree in theory and diverge in fact.
 *
 * Hermetic and offline: no browser, no backend, no network, no marketplace, no credentials. It
 * consumes no gate and promotes no capability — capability truth stays
 * `docs/multi-channel-connector-roadmap.md` §4.1.
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";

import { quarantineValidateBytes, type ByteDownloadLike } from "../../src/action-window/quarantine";
import { sanitizeBackendIngest, neutralUploadName } from "../../src/action-window/ingest-handoff";
import type { IngestResult } from "../../src/upload";
import { channelReviewIdFingerprint } from "../../src/action-window/reply-submission/review-id-fingerprint";
import { sniffXlsxReadable } from "../../src/naver/review-download-save";
import { readWorkbookRowSample } from "../../src/esm/esm-review-xlsx-reader";
import { fixtureHtml } from "../../src/action-window/fixture";
import {
  REVIEW_EXPORT_FIXTURE_PATH,
  expectedRows,
  reviewExportBase64,
  reviewExportBytes,
} from "../support/review-export-fixture";

const REF = "00ff00ff00ff00ff"; // opaque 16-hex artifact ref, as the engine emits
const EXPECTED = expectedRows();

const dirs: string[] = [];
function tempQuarantineDir(): string {
  const dir = mkdtempSync(join(tmpdir(), "aw-spine-"));
  dirs.push(dir);
  return dir;
}
afterEach(() => {
  while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
});

function asDownload(bytes: Uint8Array, filename = "synthetic-review-export.xlsx"): ByteDownloadLike {
  return { suggestedFilename: () => filename, bytes: () => bytes };
}

/** A backend `IngestResult` in the shape the contract declares for a given ingest outcome. */
function backendResult(counts: { status: string; successRows: number; skippedRows: number; failedRows: number }): IngestResult {
  return {
    syncJobId: "job-synthetic",
    uploadType: "REVIEW",
    status: counts.status,
    totalRows: counts.successRows + counts.skippedRows + counts.failedRows,
    successRows: counts.successRows,
    skippedRows: counts.skippedRows,
    failedRows: counts.failedRows,
  };
}

/**
 * The pre-spine payload: ZIP local-header magic + the content-types entry NAME, and nothing else.
 * Kept here verbatim as the counter-example the suite exists to pin — see the "structural validity"
 * block below.
 */
function structurallyShapedOnly(): Uint8Array {
  return new Uint8Array([
    ...[0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00],
    ...new TextEncoder().encode("[Content_Types].xml (sellerops synthetic fixture)"),
  ]);
}

describe("spine :: the committed artifact is THE artifact", () => {
  it("matches the contract's pinned sha256", () => {
    // reviewExportBytes() throws on mismatch; calling it IS the assertion. Asserted explicitly too,
    // so the failure reads as "the fixture changed" rather than as an unrelated loader error.
    expect(() => reviewExportBytes()).not.toThrow();
    expect(EXPECTED.contract).toBe("review-export/naver/v1");
  });

  it("is a REAL workbook an independent parser can read", () => {
    // Read back with the collector's own dependency-free xlsx reader — a parser that shares no code
    // with the quarantine sniff, so "it is a workbook" is established independently of "it sniffs OK".
    const sample = readWorkbookRowSample(REVIEW_EXPORT_FIXTURE_PATH, 50);

    expect(sample.workbookReadable).toBe(true);
    expect(sample.readerRisks).toEqual([]);
    expect(sample.sheetCount).toBe(1);
    expect(sample.headerCells).toEqual(EXPECTED.headers);
    expect(sample.sampleRows).toHaveLength(EXPECTED.rows.length);
  });

  it("carries exactly the rows both ports assert against", () => {
    const sample = readWorkbookRowSample(REVIEW_EXPORT_FIXTURE_PATH, 50);
    const col = (name: string): number => EXPECTED.headers.indexOf(name);

    EXPECTED.rows.forEach((expectedRow, i) => {
      const row = sample.sampleRows[i]!;
      expect(row[col("리뷰글번호")]).toBe(expectedRow.channelReviewId);
      expect(row[col("상품번호")]).toBe(expectedRow.sku);
      expect(row[col("상품명")]).toBe(expectedRow.product);
      expect(row[col("구매자평점")]).toBe(String(expectedRow.rating));
      expect(row[col("리뷰상세내용")]).toBe(expectedRow.body);
      expect(row[col("리뷰등록일")]).toBe(expectedRow.reviewDate);
    });
  });

  it("plants the unmapped-column sentinels the backend proves never persist", () => {
    // These columns have no canonical slot. Their presence here is what gives the backend's
    // "never reaches a canonical field" assertion something real to fail on.
    const sample = readWorkbookRowSample(REVIEW_EXPORT_FIXTURE_PATH, 50);
    for (const header of EXPECTED.unmappedHeaders) {
      const index = EXPECTED.headers.indexOf(header);
      expect(index).toBeGreaterThanOrEqual(0);
      for (const row of sample.sampleRows) {
        expect(row[index]).toBe(EXPECTED.unmappedSentinels[header]);
      }
    }
  });

  it("contains no platform token", () => {
    // The fixture models a NAVER-shaped export; it must not carry marketplace identity. Header
    // labels are schema aliases (리뷰글번호 …) and are deliberately not in this list.
    const text = Buffer.from(reviewExportBytes()).toString("latin1");
    const sample = readWorkbookRowSample(REVIEW_EXPORT_FIXTURE_PATH, 50);
    const cells = [...sample.headerCells, ...sample.sampleRows.flat()].join(" ");
    for (const token of ["네이버", "스마트스토어", "smartstore", "NAVER", "naver"]) {
      expect(cells.includes(token), `cell values :: ${token}`).toBe(false);
      expect(text.includes(token), `raw bytes :: ${token}`).toBe(false);
    }
  });
});

describe("spine :: quarantine validation over the real artifact", () => {
  it("validates clean and leaves nothing on disk", async () => {
    const dir = tempQuarantineDir();

    const verdict = await quarantineValidateBytes(asDownload(reviewExportBytes()), { dir, artifactRef: REF });

    expect(verdict).toEqual({ saved: true, extensionOk: true, magicOk: true, deleted: true, valid: true });
    // The ratified delete-after-validate posture: the validation window is over, so is the file.
    expect(readdirSync(dir)).toEqual([]);
    expect(existsSync(join(dir, `aw-quarantine-${REF}.xlsx`))).toBe(false);
  });
});

describe("spine :: structural validity is NOT ingestibility", () => {
  /**
   * THE FINDING THIS SLICE RECORDS. The quarantine sniff checks ZIP magic plus the
   * `[Content_Types].xml` entry NAME within the head — a payload can satisfy both and still not be a
   * workbook. Before this slice the synthetic fixture served exactly such a payload, so a green
   * fixture run proved detection and validation and could prove NOTHING downstream: a real parser
   * rejects those bytes.
   *
   * This is reported, not resolved: the sniff's semantics are the ratified D-021 posture and are
   * deliberately unchanged here. What changes is that the synthetic path can now carry bytes that
   * pass BOTH checks, and that the gap between them is pinned rather than assumed.
   */
  it("the pre-spine payload passes the sniff", () => {
    expect(sniffXlsxReadable(structurallyShapedOnly())).toBe(true);
  });

  it("…and passes quarantine validation", async () => {
    const dir = tempQuarantineDir();
    const verdict = await quarantineValidateBytes(asDownload(structurallyShapedOnly()), { dir, artifactRef: REF });
    expect(verdict.valid).toBe(true);
  });

  it("…yet no parser can read it, where the real artifact reads clean", () => {
    const dir = tempQuarantineDir();
    const path = join(dir, "structurally-shaped.xlsx");
    writeFileSync(path, structurallyShapedOnly());

    expect(readWorkbookRowSample(path, 5).workbookReadable).toBe(false);
    expect(readWorkbookRowSample(REVIEW_EXPORT_FIXTURE_PATH, 5).workbookReadable).toBe(true);
  });
});

describe("spine :: the ingest handoff", () => {
  it("reduces the backend result to the sanitized outcome the engine reads", () => {
    const outcome = sanitizeBackendIngest(backendResult(EXPECTED.expectedIngest));

    expect(outcome).toEqual({ ok: true, processed: EXPECTED.rows.length });
  });

  it("treats the all-duplicate re-ingest as an idempotent completion, not a failure", () => {
    // The backend's second ingest of the SAME file: SUCCESS with 0 processed and every row skipped.
    const outcome = sanitizeBackendIngest(backendResult(EXPECTED.expectedReingest));

    expect(outcome).toEqual({ ok: true, processed: 0 });
  });

  it("names the upload from the opaque ref only — never the platform's filename", () => {
    expect(neutralUploadName(REF)).toBe(`aw-${REF}.xlsx`);
    expect(neutralUploadName("리뷰내보내기_0000.xlsx")).toBe("aw-review-export.xlsx");
  });
});

describe("spine :: cross-port review-id identity", () => {
  it("fingerprints every row's 리뷰글번호 to the value the backend port must reproduce", () => {
    // The Java port asserts the SAME recorded values in ReviewAcquisitionSpineTest, so the contract
    // file carries a live parity check on the spine's own data — not only on abstract vectors.
    for (const row of EXPECTED.rows) {
      expect(channelReviewIdFingerprint(row.channelReviewId)).toBe(row.reviewIdFingerprint);
    }
  });

  it("keeps every id well-formed for the persisted identity column", () => {
    for (const row of EXPECTED.rows) {
      expect(row.channelReviewId).toMatch(/^\d{10}$/);
      expect(channelReviewIdFingerprint(row.channelReviewId)).not.toBeNull();
    }
  });
});

describe("spine :: the fixture page serves the real bytes", () => {
  it("embeds the committed artifact when the caller supplies it", () => {
    const base64 = reviewExportBase64();
    const html = fixtureHtml("naver-review-export-xlsx", { reviewExportBase64: base64 });

    expect(html).toContain(base64);
    expect(html).toContain("atob(");
    // The stand-in payload is gone from this page — the download the operator's click fires is the
    // same artifact the backend ingests.
    expect(html).not.toContain("(sellerops synthetic fixture)");
  });

  it("leaves every other mode and the default exactly as they were", () => {
    // No caller is forced to supply bytes; absent the option the fixture is byte-identical to before.
    expect(fixtureHtml("naver-review-export-xlsx")).toContain("(sellerops synthetic fixture)");
    expect(fixtureHtml("download-xlsx", { reviewExportBase64: "QUJD" })).toContain("(sellerops synthetic fixture)");
    expect(fixtureHtml("normal", { reviewExportBase64: "QUJD" })).not.toContain("QUJD");
  });
});
