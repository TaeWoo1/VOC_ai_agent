/**
 * Unit tests for the Action Window artifact quarantine (R4, D-021 ratified posture): temporary
 * save → extension + OOXML magic sniff → DELETE, fail-closed everywhere — including on a FAILED
 * DELETE (a retained quarantine file violates the posture, so `valid` requires `deleted`). Covers
 * both entry points (byte-carrying fixture downloads and saveAs-capable real downloads), the
 * sanitized boolean-only verdict, the sweep hygiene, a real-filesystem round trip, and the
 * module's own source guard (fs + saveAs are ALLOWED here and ONLY here; no browser, no network,
 * no upload path, no parser, no console, no raw-filename hashing).
 */
import { describe, it, expect, afterEach } from "vitest";
import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync, writeFileSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  QUARANTINE_PREFIX,
  QUARANTINE_RETENTION_POLICY,
  QUARANTINE_VERDICT_KEYS,
  quarantineBasenameFor,
  quarantineValidateBytes,
  quarantineValidateDownload,
  sweepQuarantine,
  type ByteDownloadLike,
  type QuarantineIo,
  type QuarantineVerdict,
} from "../../src/action-window/quarantine";

const REF = "00ff00ff00ff00ff"; // opaque 16-hex artifact ref
const DIR = "/quarantine-test-dir";
const CANARY_NAME = "리뷰내보내기_0000.xlsx";

/** Structurally OOXML-shaped head: ZIP local-header magic + the content-types entry name. */
function ooxmlBytes(extra = ""): Uint8Array {
  const tail = new TextEncoder().encode(`[Content_Types].xml (synthetic) ${extra}`);
  const out = new Uint8Array(10 + tail.length);
  out.set([0x50, 0x4b, 0x03, 0x04, 0x14, 0x00, 0x00, 0x00, 0x08, 0x00], 0);
  out.set(tail, 10);
  return out;
}

interface FakeIoToggles {
  ensureThrows?: boolean;
  writeThrows?: boolean;
  readThrows?: boolean;
  removeThrows?: boolean;
}

/** In-memory io recording every call — the hermetic default for these tests. */
function makeIo(toggles: FakeIoToggles = {}) {
  const files = new Map<string, Uint8Array>();
  const calls = { ensureDir: 0, writeFile: 0, readHead: 0, removeFile: 0, order: [] as string[], paths: [] as string[] };
  const io: QuarantineIo = {
    ensureDir(dir) {
      calls.ensureDir += 1;
      calls.order.push("ensureDir");
      calls.paths.push(dir);
      if (toggles.ensureThrows) throw new Error("ensure boom");
    },
    writeFile(path, bytes) {
      calls.writeFile += 1;
      calls.order.push("writeFile");
      calls.paths.push(path);
      if (toggles.writeThrows) throw new Error("write boom");
      files.set(path, bytes);
    },
    readHead(path, maxBytes) {
      calls.readHead += 1;
      calls.order.push("readHead");
      if (toggles.readThrows) throw new Error("read boom");
      const bytes = files.get(path);
      if (!bytes) throw new Error("missing");
      return bytes.subarray(0, maxBytes);
    },
    removeFile(path) {
      calls.removeFile += 1;
      calls.order.push("removeFile");
      calls.paths.push(path);
      if (toggles.removeThrows) throw new Error("remove boom");
      files.delete(path);
    },
    listDir(dir) {
      return [...files.keys()].filter((p) => p.startsWith(`${dir}/`)).map((p) => p.slice(dir.length + 1));
    },
  };
  return { io, files, calls };
}

function byteSource(name = CANARY_NAME, bytes: Uint8Array = ooxmlBytes()): ByteDownloadLike {
  return { suggestedFilename: () => name, bytes: () => bytes };
}

describe("quarantineValidateBytes — verdicts (fake io)", () => {
  it("valid OOXML bytes: all-true verdict; ref-derived basename; deleted after the sniff read", async () => {
    const { io, files, calls } = makeIo();
    const verdict = await quarantineValidateBytes(byteSource(), { dir: DIR, artifactRef: REF, io });
    expect(verdict).toEqual({ saved: true, extensionOk: true, magicOk: true, deleted: true, valid: true });
    expect(calls.paths).toContain(join(DIR, `${QUARANTINE_PREFIX}${REF}.xlsx`));
    expect(calls.order).toEqual(["ensureDir", "writeFile", "readHead", "removeFile"]);
    expect(files.size).toBe(0); // nothing lingers
  });

  it("wrong extension: extensionOk false → invalid, but the file is still saved and deleted", async () => {
    const { io, files } = makeIo();
    const verdict = await quarantineValidateBytes(byteSource("리뷰내보내기_0000.html"), { dir: DIR, artifactRef: REF, io });
    expect(verdict).toEqual({ saved: true, extensionOk: false, magicOk: true, deleted: true, valid: false });
    expect(files.size).toBe(0);
  });

  it("bad magic / missing content-types marker / short head: magicOk false → invalid", async () => {
    const cases: Uint8Array[] = [
      new TextEncoder().encode("<html>plain text, no zip magic</html>"),
      ooxmlBytes().subarray(0, 10).slice(), // magic but no [Content_Types].xml
      Uint8Array.from([0x50, 0x4b]), // shorter than the magic itself
    ];
    for (const bytes of cases) {
      const { io } = makeIo();
      const verdict = await quarantineValidateBytes(byteSource(CANARY_NAME, bytes), { dir: DIR, artifactRef: REF, io });
      expect(verdict.magicOk).toBe(false);
      expect(verdict.valid).toBe(false);
      expect(verdict.deleted).toBe(true);
    }
  });

  it("save failure: saved false, never throws, delete still attempted (force semantics)", async () => {
    const { io, calls } = makeIo({ writeThrows: true });
    const verdict = await quarantineValidateBytes(byteSource(), { dir: DIR, artifactRef: REF, io });
    expect(verdict).toEqual({ saved: false, extensionOk: true, magicOk: false, deleted: true, valid: false });
    expect(calls.removeFile).toBe(1);
  });

  it("ensureDir failure degrades to an invalid verdict without throwing", async () => {
    const { io } = makeIo({ ensureThrows: true });
    const verdict = await quarantineValidateBytes(byteSource(), { dir: DIR, artifactRef: REF, io });
    expect(verdict.saved).toBe(false);
    expect(verdict.valid).toBe(false);
  });

  it("readHead failure after a successful save: magicOk false, still deleted", async () => {
    const { io, files } = makeIo({ readThrows: true });
    const verdict = await quarantineValidateBytes(byteSource(), { dir: DIR, artifactRef: REF, io });
    expect(verdict).toEqual({ saved: true, extensionOk: true, magicOk: false, deleted: true, valid: false });
    expect(files.size).toBe(0);
  });

  it("POLICY LOCK — a failed delete fails closed: deleted false ⇒ valid false even when the sniff passed", async () => {
    const { io, files } = makeIo({ removeThrows: true });
    const verdict = await quarantineValidateBytes(byteSource(), { dir: DIR, artifactRef: REF, io });
    expect(verdict).toEqual({ saved: true, extensionOk: true, magicOk: true, deleted: false, valid: false });
    expect(files.size).toBe(1); // honest: the file really is retained — which is exactly why it fails
    expect(QUARANTINE_RETENTION_POLICY).toBe("delete-after-validate");
  });

  it("malformed artifactRef never composes a path or touches the io", async () => {
    for (const bad of ["../x", "00FF00FF00FF00FF", "0123456789abcde", "0123456789abcdef0", ""]) {
      const { io, calls } = makeIo();
      const verdict = await quarantineValidateBytes(byteSource(), { dir: DIR, artifactRef: bad, io });
      expect(verdict).toEqual({ saved: false, extensionOk: false, magicOk: false, deleted: false, valid: false });
      expect(calls.ensureDir + calls.writeFile + calls.readHead + calls.removeFile).toBe(0);
    }
  });

  it("verdict is boolean-only and allow-listed; no filename/path/canary in its serialization", async () => {
    const { io } = makeIo();
    const verdict = await quarantineValidateBytes(byteSource(), { dir: DIR, artifactRef: REF, io });
    expect(Object.keys(verdict).sort()).toEqual([...QUARANTINE_VERDICT_KEYS].sort());
    for (const value of Object.values(verdict)) expect(typeof value).toBe("boolean");
    const serialized = JSON.stringify(verdict);
    for (const needle of [CANARY_NAME, "리뷰내보내기", ".xlsx", DIR, QUARANTINE_PREFIX, REF, "[Content_Types]"]) {
      expect(serialized.includes(needle), `verdict leaked "${needle}"`).toBe(false);
    }
  });
});

describe("quarantineValidateDownload — the saveAs entry point", () => {
  it("a saveAs-capable download is saved via its own writer, sniffed, deleted", async () => {
    const { io, files } = makeIo();
    let savedTo = "";
    const download = {
      suggestedFilename: () => CANARY_NAME,
      saveAs: (path: string) => {
        savedTo = path;
        files.set(path, ooxmlBytes());
        return Promise.resolve();
      },
    };
    const verdict = await quarantineValidateDownload(download, { dir: DIR, artifactRef: REF, io });
    expect(verdict.valid).toBe(true);
    expect(savedTo).toBe(join(DIR, `${QUARANTINE_PREFIX}${REF}.xlsx`));
    expect(files.size).toBe(0);
  });

  it("a throwing saveAs degrades to saved:false without throwing", async () => {
    const { io } = makeIo();
    const download = {
      suggestedFilename: () => CANARY_NAME,
      saveAs: () => Promise.reject(new Error("download errored")),
    };
    const verdict = await quarantineValidateDownload(download, { dir: DIR, artifactRef: REF, io });
    expect(verdict).toEqual({ saved: false, extensionOk: true, magicOk: false, deleted: true, valid: false });
  });
});

describe("quarantine — real filesystem round trip", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  function tmp(): string {
    const dir = mkdtempSync(join(tmpdir(), "aw-quarantine-test-"));
    dirs.push(dir);
    return dir;
  }

  it("default io: the file exists exactly during the validation window, the dir is empty after", async () => {
    const dir = tmp();
    let existedAtSniff = false;
    // Probe through a saveAs download whose write we control: it records that the file really
    // existed at the expected path during the validation window; emptiness is asserted after.
    const path = join(dir, quarantineBasenameFor(REF, "xlsx"));
    const download = {
      suggestedFilename: () => CANARY_NAME,
      saveAs: (target: string) => {
        writeFileSync(target, ooxmlBytes());
        existedAtSniff = existsSync(path) && target === path;
        return Promise.resolve();
      },
    };
    const verdict = await quarantineValidateDownload(download, { dir, artifactRef: REF });
    expect(verdict).toEqual({ saved: true, extensionOk: true, magicOk: true, deleted: true, valid: true });
    expect(existedAtSniff).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("default io bytes path: writes, sniffs, deletes on the real fs", async () => {
    const dir = tmp();
    const verdict = await quarantineValidateBytes(byteSource(), { dir, artifactRef: REF });
    expect(verdict.valid).toBe(true);
    expect(readdirSync(dir)).toEqual([]);
  });

  it("sweepQuarantine removes only prefixed leftovers; a missing dir is a no-op", () => {
    const dir = tmp();
    const leftover = join(dir, `${QUARANTINE_PREFIX}deadbeefdeadbeef.xlsx`);
    const unrelated = join(dir, "keep-me.txt");
    writeFileSync(leftover, ooxmlBytes());
    writeFileSync(unrelated, "not quarantine");
    sweepQuarantine(dir);
    expect(existsSync(leftover)).toBe(false);
    expect(readFileSync(unrelated, "utf8")).toBe("not quarantine");
    expect(() => sweepQuarantine(join(dir, "no-such-subdir"))).not.toThrow();
  });
});

describe("quarantine module — source guard (the ONLY fs/saveAs Action Window module)", () => {
  const srcPath = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/action-window/quarantine.ts");
  const stripComments = (code: string): string =>
    code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join("\n");

  it("contains no browser/network/upload/parser/console path and no raw-filename hashing", () => {
    const code = stripComments(readFileSync(srcPath, "utf8"));
    const bannedTokens = [
      /playwright/i,
      /waitForEvent/,
      /node:net/,
      /node:http/,
      /child_process/,
      /fetch\s*\(/,
      /\.click\s*\(/,
      /dispatchEvent\s*\(/,
      /console\./,
      /exceljs|xlsx-populate|sheetjs/i,
      /sheet_to_json|getWorksheet|\.eachRow|XLSX\./,
    ];
    for (const re of bannedTokens) expect(re.test(code), `quarantine.ts :: ${re}`).toBe(false);
    const importStatements = code.match(/import[\s\S]*?from\s*["'][^"']+["']/g) ?? [];
    const bannedImports = [/review-upload-diagnostic/, /runExport/, /\.\.\/upload/, /saveAndInspectDownload/, /messageFingerprint/];
    for (const statement of importStatements) {
      for (const re of bannedImports) {
        expect(re.test(statement), `quarantine.ts import :: ${re}`).toBe(false);
      }
    }
    // The proven pure helpers ARE reused (D-013): the structural sniff and the extension category.
    expect(code).toMatch(/import\s*\{\s*sniffXlsxReadable\s*\}\s*from\s*["']\.\.\/naver\/review-download-save["']/);
    expect(code).toMatch(/import\s*\{\s*extensionCategory\s*\}\s*from\s*["']\.\.\/naver\/review-export["']/);
    // Exactly ONE saveAs call site (the real-download writer) exists in the module.
    expect(code.match(/\.saveAs\s*\(/g)?.length).toBe(1);
  });

  it("locks the ratified retention policy", () => {
    expect(QUARANTINE_RETENTION_POLICY).toBe("delete-after-validate");
    expect(QUARANTINE_PREFIX).toBe("aw-quarantine-");
  });
});
