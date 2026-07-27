/**
 * Guided Acquisition Reliability — the managed-download filename sanitization (the seam that turns a GUID temp
 * artifact into a real, seller-named, openable file at a known path).
 */
import { describe, it, expect } from "vitest";
import { safeExportFilename } from "../../src/cli/local-agent";

describe("safeExportFilename — managed copy naming", () => {
  it("keeps a plain seller filename, including a Korean-titled xlsx", () => {
    expect(safeExportFilename("리뷰_20260501.xlsx")).toBe("리뷰_20260501.xlsx");
    expect(safeExportFilename("review-export.csv")).toBe("review-export.csv");
  });

  it("strips any directory component — no path traversal reaches the managed dir", () => {
    expect(safeExportFilename("../../etc/passwd")).toBe("passwd");
    expect(safeExportFilename("/tmp/evil.xlsx")).toBe("evil.xlsx");
    expect(safeExportFilename("a/b/c/reviews.xlsx")).toBe("reviews.xlsx");
  });

  it("falls back to a fixed name for empty or dot-only names, never an empty path", () => {
    expect(safeExportFilename("")).toBe("review-export.xlsx");
    expect(safeExportFilename(".")).toBe("review-export.xlsx");
    expect(safeExportFilename("..")).toBe("review-export.xlsx");
  });
});
