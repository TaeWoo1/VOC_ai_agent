import { readFileSync } from "node:fs";
import { dirname, join } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  diagnosticBasenameFor,
  fileSizeBucket,
  saveAndInspectDownload,
  SAVED_DOWNLOAD_INSPECTION_KEYS,
  sniffXlsxReadable,
  type DownloadSaveIo,
  type SaveableDownload,
} from "../../src/naver/review-download-save";
import type { UploadInspection } from "../../src/naver/review-upload-diagnostic";

/** A sanitized inspection a fake `uploadFn` can return. */
const FAKE_UPLOAD: UploadInspection = {
  uploaded: true,
  ingestStatusCategory: "COMPLETED",
  syncJobIdHash: "0123456789abcdef",
  totalRowsBucket: "hundreds",
  successRowsBucket: "hundreds",
  skippedRowsBucket: "zero",
  failedRowsBucket: "zero",
  hasErrorMessage: false,
  sampleErrorPresent: false,
};

const __dirname = dirname(fileURLToPath(import.meta.url));
const SRC_PATH = join(__dirname, "..", "..", "src", "naver", "review-download-save.ts");

/** A minimal real OOXML/xlsx head: ZIP local-header magic + the content-types entry name. */
function ooxmlHead(): Uint8Array {
  const marker = "[Content_Types].xml";
  const bytes = [0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00];
  for (let i = 0; i < marker.length; i += 1) bytes.push(marker.charCodeAt(i));
  return new Uint8Array(bytes);
}

interface FakeOpts {
  rawName?: string;
  size?: number;
  head?: Uint8Array;
  ensureThrows?: boolean;
  saveAsThrows?: boolean;
}
interface FakeHandles {
  io: DownloadSaveIo;
  download: SaveableDownload;
  calls: { ensureDir: number; saveAs: number; fileSize: number; readHead: number; removeFile: number; savedPath: string };
}
function makeFakes(opts: FakeOpts = {}): FakeHandles {
  const calls = { ensureDir: 0, saveAs: 0, fileSize: 0, readHead: 0, removeFile: 0, savedPath: "" };
  const io: DownloadSaveIo = {
    ensureDir(): void {
      calls.ensureDir += 1;
      if (opts.ensureThrows) throw new Error("mkdir fail");
    },
    fileSize(): number {
      calls.fileSize += 1;
      return opts.size ?? 12_345;
    },
    readHead(): Uint8Array {
      calls.readHead += 1;
      return opts.head ?? ooxmlHead();
    },
    removeFile(): void {
      calls.removeFile += 1;
    },
  };
  const download: SaveableDownload = {
    suggestedFilename: () => opts.rawName ?? "리뷰_행복마켓_20260622.xlsx",
    async saveAs(path: string): Promise<void> {
      calls.saveAs += 1;
      calls.savedPath = path;
      if (opts.saveAsThrows) throw new Error("saveAs fail");
    },
  };
  return { io, download, calls };
}

const OPTS_DIR = "/tmp/quarantine/downloads/diagnostic";

describe("fileSizeBucket — coarse, monotonic", () => {
  it("buckets by size without exposing the count", () => {
    expect(fileSizeBucket(0)).toBe("empty");
    expect(fileSizeBucket(1024)).toBe("tiny");
    expect(fileSizeBucket(1025)).toBe("small");
    expect(fileSizeBucket(100 * 1024)).toBe("small");
    expect(fileSizeBucket(2 * 1024 * 1024)).toBe("medium");
    expect(fileSizeBucket(2 * 1024 * 1024 + 1)).toBe("large");
  });
});

describe("sniffXlsxReadable — structural OOXML zip sniff (no cell read)", () => {
  it("true for a ZIP magic + [Content_Types].xml head", () => {
    expect(sniffXlsxReadable(ooxmlHead())).toBe(true);
  });
  it("false without the ZIP local-header magic", () => {
    expect(sniffXlsxReadable(new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]))).toBe(false); // "<html"
  });
  it("false for a zip with no OOXML content-types marker", () => {
    expect(sniffXlsxReadable(new Uint8Array([0x50, 0x4b, 0x03, 0x04, 0x00, 0x00]))).toBe(false);
  });
  it("false for a too-short head", () => {
    expect(sniffXlsxReadable(new Uint8Array([0x50, 0x4b]))).toBe(false);
  });
});

describe("diagnosticBasenameFor — generated name, never the raw NAVER filename", () => {
  it("embeds a salted hash of the raw name + the derived extension, never the raw name", () => {
    const name = diagnosticBasenameFor("salt", "리뷰_행복마켓_20260622.xlsx", "xlsx");
    expect(name).toMatch(/^review-diagnostic-[a-f0-9]{16}\.xlsx$/);
    expect(name.includes("행복마켓")).toBe(false);
  });
  it("maps an unknown category to a .bin extension", () => {
    expect(diagnosticBasenameFor("salt", "weird", "unknown")).toMatch(/^review-diagnostic-[a-f0-9]{16}\.bin$/);
  });
});

describe("saveAndInspectDownload — save → validate → DELETE, sanitized record", () => {
  it("saves to the quarantine dir, validates xlsx, then deletes the file", async () => {
    const { io, download, calls } = makeFakes({ size: 50_000 });
    const r = await saveAndInspectDownload(download, { dir: OPTS_DIR, salt: "test-salt", io });
    expect(r.downloadSaved).toBe(true);
    expect(calls.saveAs).toBe(1); // EXACTLY one save
    expect(calls.removeFile).toBe(1); // DELETED after validate
    expect(r.fileRetained).toBe(false);
    expect(r.retentionPolicy).toBe("delete-after-validate");
    expect(r.savedExtensionCategory).toBe("xlsx");
    expect(r.fileSizeBucket).toBe("small");
    expect(r.xlsxReadable).toBe(true);
    expect(r.workbookContentValidation).toBe("deferred");
    expect(r.rawCellLeak).toBe(false);
    expect(r.savedPathCategory).toBe("downloads_diagnostic_quarantine");
    expect(r.savedBasenameHash).toMatch(/^[a-f0-9]{16}$/);
  });

  it("writes a GENERATED basename under the quarantine dir, never the raw NAVER filename", () => {
    const { io, download, calls } = makeFakes({ rawName: "리뷰_행복마켓_1234567.xlsx" });
    return saveAndInspectDownload(download, { dir: OPTS_DIR, salt: "s", io }).then(() => {
      expect(calls.savedPath.startsWith(OPTS_DIR)).toBe(true);
      expect(calls.savedPath).toMatch(/review-diagnostic-[a-f0-9]{16}\.xlsx$/);
      expect(calls.savedPath.includes("행복마켓")).toBe(false);
      expect(calls.savedPath.includes("1234567")).toBe(false);
    });
  });

  it("reports xlsxReadable:false for a non-OOXML payload but still saves+deletes", async () => {
    const { io, download, calls } = makeFakes({ head: new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]) });
    const r = await saveAndInspectDownload(download, { dir: OPTS_DIR, salt: "s", io });
    expect(r.downloadSaved).toBe(true);
    expect(r.xlsxReadable).toBe(false);
    expect(calls.removeFile).toBe(1);
  });

  it("degrades to downloadSaved:false on a saveAs failure, still cleans up (no throw)", async () => {
    const { io, download, calls } = makeFakes({ saveAsThrows: true });
    const r = await saveAndInspectDownload(download, { dir: OPTS_DIR, salt: "s", io });
    expect(r.downloadSaved).toBe(false);
    expect(calls.removeFile).toBe(1); // finally still attempts cleanup
  });

  it("degrades to downloadSaved:false on an ensureDir failure, never reaching saveAs", async () => {
    const { io, download, calls } = makeFakes({ ensureThrows: true });
    const r = await saveAndInspectDownload(download, { dir: OPTS_DIR, salt: "s", io });
    expect(r.downloadSaved).toBe(false);
    expect(calls.saveAs).toBe(0);
  });

  it("no raw leak; output keys allow-listed", async () => {
    const { io, download } = makeFakes({ rawName: "행복마켓_Commerce_1234567_리뷰.xlsx" });
    const r = await saveAndInspectDownload(download, { dir: OPTS_DIR, salt: "s", io });
    const json = JSON.stringify(r);
    expect(json.includes("행복마켓")).toBe(false);
    expect(json.includes("1234567")).toBe(false);
    expect(json.includes(".xlsx")).toBe(false); // extension is a CATEGORY, not the raw name
    expect(/\/tmp\/|diagnostic\//.test(json)).toBe(false); // never the raw path
    expect(/[<>]/.test(json)).toBe(false);
    for (const k of Object.keys(r)) {
      expect((SAVED_DOWNLOAD_INSPECTION_KEYS as readonly string[]).includes(k)).toBe(true);
    }
  });
});

describe("saveAndInspectDownload — optional uploadFn (upload-before-delete, only when xlsxReadable)", () => {
  it("uploads the saved file BEFORE deleting it, exactly once, and surfaces the inspection", async () => {
    const { io, download, calls } = makeFakes({ size: 50_000 });
    let uploadCalls = 0;
    let removeCountAtUpload = -1;
    let uploadedPath = "";
    const uploadFn = async (path: string): Promise<UploadInspection> => {
      uploadCalls += 1;
      removeCountAtUpload = calls.removeFile; // 0 ⇒ uploaded before the delete
      uploadedPath = path;
      return FAKE_UPLOAD;
    };
    const r = await saveAndInspectDownload(download, { dir: OPTS_DIR, salt: "s", io, uploadFn });
    expect(uploadCalls).toBe(1);
    expect(removeCountAtUpload).toBe(0); // upload-before-delete
    expect(calls.removeFile).toBe(1); // still deleted after (delete-after-validate)
    expect(uploadedPath.startsWith(OPTS_DIR)).toBe(true);
    expect(r.uploaded).toEqual(FAKE_UPLOAD);
    expect((SAVED_DOWNLOAD_INSPECTION_KEYS as readonly string[]).includes("uploaded")).toBe(true);
  });

  it("does NOT upload a non-OOXML payload (skips uploadFn when !xlsxReadable), still saves+deletes", async () => {
    const { io, download, calls } = makeFakes({ head: new Uint8Array([0x3c, 0x68, 0x74, 0x6d, 0x6c]) });
    let uploadCalls = 0;
    const r = await saveAndInspectDownload(download, {
      dir: OPTS_DIR,
      salt: "s",
      io,
      uploadFn: async () => {
        uploadCalls += 1;
        return FAKE_UPLOAD;
      },
    });
    expect(r.xlsxReadable).toBe(false);
    expect(uploadCalls).toBe(0);
    expect(r.uploaded).toBeUndefined();
    expect(calls.removeFile).toBe(1);
  });

  it("without an uploadFn, behaves exactly as before (no uploaded field)", async () => {
    const { io, download } = makeFakes({ size: 50_000 });
    const r = await saveAndInspectDownload(download, { dir: OPTS_DIR, salt: "s", io });
    expect(r.uploaded).toBeUndefined();
  });
});

describe("review-download-save.ts — strict save-module source guard", () => {
  const raw = readFileSync(SRC_PATH, "utf8");
  const code = raw.replace(/\/\*[\s\S]*?\*\//g, " ").replace(/(^|[^:])\/\/.*$/gm, "$1");

  it("calls saveAs EXACTLY ONCE (the only saveAs outside runExport)", () => {
    expect((code.match(/\.saveAs\s*\(/g) ?? []).length).toBe(1);
  });

  it("never uploads, writes status, mutates DB, or sets LAST_SUCCESS", () => {
    expect(/uploadReviewFile|\buploadReview\w*/.test(code)).toBe(false);
    expect(/writeStatus/.test(code)).toBe(false);
    expect(/decideState/.test(code)).toBe(false);
    expect(/runExport/.test(code)).toBe(false);
    expect(/LAST_SUCCESS|lastCollectedAt/.test(code)).toBe(false);
  });

  it("uses NO xlsx parser and reads NO cell (structural magic-byte sniff only)", () => {
    expect(/from\s+["'](?:xlsx|exceljs|node-xlsx)["']/.test(code)).toBe(false);
    expect(/sheet_to_json|getWorksheet|\.eachRow|XLSX\./.test(code)).toBe(false);
  });

  it("emits nothing itself (the CLI prints; this module returns a record)", () => {
    expect(/console\./.test(code)).toBe(false);
  });

  it("drives no page action (no click/fill/press/goto/evaluate)", () => {
    expect(/\.click\s*\(/.test(code)).toBe(false);
    expect(/\.fill\s*\(|\.press\s*\(|\.goto\s*\(|\.evaluate\s*\(/.test(code)).toBe(false);
  });

  it("deletes after validating (unlink in the cleanup path)", () => {
    expect(/removeFile/.test(code)).toBe(true);
    expect(/unlinkSync/.test(code)).toBe(true);
    expect(/delete-after-validate/.test(code)).toBe(true);
  });
});
