/**
 * Unit tests for the FIXTURE-ONLY NAVER pilot driver (R4, D-021). Offline, no browser, no backend.
 * Covers: the composed upstream stages (session verdict → readiness → locate → verify) per fixture
 * mode, the fail-closed hostile shapes (0/many targets, drift, reconnect/login, empty vs ambiguous
 * readiness, async affordance), signature determinism/opacity, the synthetic downstream defaults,
 * the module source-guard (no click / no live / no save path), and the privacy boundary (fixture
 * canaries and platform tokens never appear in any driver output).
 */
import { describe, it, expect, afterEach } from "vitest";
import { mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { fileURLToPath } from "node:url";
import { dirname, join, resolve } from "node:path";
import {
  NAVER_CHANNEL_CODE,
  NAVER_FIXTURE_ARTIFACT_REF,
  NAVER_RUN_COPY_KEY,
  NaverFixtureProbeDriver,
} from "../../src/action-window/naver-driver";
import {
  NAVER_FIXTURE_CANARIES,
  NaverReviewExportSurfaceFixture,
  type NaverFixtureDownloadShape,
  type NaverFixtureMode,
} from "../../src/action-window/naver-fixture";

const HEX16 = /^[0-9a-f]{16}$/;

const ALL_MODES: readonly NaverFixtureMode[] = [
  "normal",
  "no-target",
  "multi-target",
  "drift",
  "unchanged",
  "reconnect-required",
  "login-required",
  "empty-target",
  "ambiguous-readiness",
  "async-affordance",
];

/**
 * Real-platform tokens that must appear NOWHERE — not even inside the fixture itself. The fixture
 * is NAVER-*shaped*, never NAVER *content*.
 */
const PLATFORM_NEEDLES = ["smartstore", "스마트스토어", "naver.com", "sell.naver", "네이버", "storefarm", "쇼핑윈도"];

/**
 * Fixture-page content that must never leave the driver: the planted canaries plus raw-markup /
 * raw-wording fragments of the synthetic surface.
 */
const FIXTURE_CONTENT_NEEDLES = [...NAVER_FIXTURE_CANARIES, "엑셀", "다운로드", "내려받기", "합성", "fx-export", "리뷰 관리", "<button", "data-", "password"];

function expectNoNeedle(serialized: string, needles: readonly string[], label: string): void {
  const lower = serialized.toLowerCase();
  for (const needle of needles) {
    expect(lower.includes(needle.toLowerCase()), `${label} leaked "${needle}"`).toBe(false);
  }
}

describe("NAVER fixture — shape & privacy of the fixture itself", () => {
  it("every mode's page is NAVER-shaped but contains no platform token", () => {
    for (const mode of ALL_MODES) {
      const html = new NaverReviewExportSurfaceFixture(mode).html();
      expectNoNeedle(html, PLATFORM_NEEDLES, `fixture[${mode}]`);
    }
  });

  it("every mode's page plants all leak canaries (so the no-leak tests are meaningful)", () => {
    for (const mode of ALL_MODES) {
      const html = new NaverReviewExportSurfaceFixture(mode).html();
      for (const canary of NAVER_FIXTURE_CANARIES) {
        expect(html.includes(canary), `fixture[${mode}] missing canary "${canary}"`).toBe(true);
      }
    }
  });

  it("the user action produces the shaped artifact; consuming it is one-shot; re-acting re-arms", () => {
    const fx = new NaverReviewExportSurfaceFixture("normal", "xlsx-valid");
    expect(fx.takePendingDownload()).toBeNull(); // nothing before the action
    fx.applyUserAction();
    const download = fx.takePendingDownload()!;
    expect(download.suggestedFilename()).toBe(NAVER_FIXTURE_CANARIES[2]); // the filename canary
    const bytes = download.bytes();
    expect([...bytes.subarray(0, 4)]).toEqual([0x50, 0x4b, 0x03, 0x04]); // ZIP/OOXML magic
    const text = new TextDecoder().decode(bytes);
    for (const canary of NAVER_FIXTURE_CANARIES) expect(text).toContain(canary); // content canaries planted
    expect(fx.takePendingDownload()).toBeNull(); // consumed
    fx.applyUserAction();
    expect(fx.takePendingDownload()).not.toBeNull(); // a retry produces a fresh artifact

    const bad = new NaverReviewExportSurfaceFixture("normal", "bad-magic");
    bad.applyUserAction();
    expect([...bad.takePendingDownload()!.bytes().subarray(0, 4)]).not.toEqual([0x50, 0x4b, 0x03, 0x04]);

    const wrongExt = new NaverReviewExportSurfaceFixture("normal", "wrong-extension");
    wrongExt.applyUserAction();
    expect(wrongExt.takePendingDownload()!.suggestedFilename().endsWith(".html")).toBe(true);

    const none = new NaverReviewExportSurfaceFixture("normal", "none");
    none.applyUserAction();
    expect(none.takePendingDownload()).toBeNull();
  });

  it("the user action transitions state; the completion signal is absent in unchanged mode", () => {
    const normal = new NaverReviewExportSurfaceFixture("normal");
    expect(normal.completionSignalPresent()).toBe(false);
    normal.applyUserAction();
    expect(normal.completionSignalPresent()).toBe(true);

    const unchanged = new NaverReviewExportSurfaceFixture("unchanged");
    unchanged.applyUserAction();
    expect(unchanged.hasActed()).toBe(true);
    expect(unchanged.completionSignalPresent()).toBe(false);
  });
});

describe("NaverFixtureProbeDriver — upstream stages", () => {
  it("normal: surface ready, single target with an opaque deterministic signature", async () => {
    const driver = new NaverFixtureProbeDriver("normal");
    expect(await driver.prepareSurface()).toEqual({ ok: true });
    expect(driver.prepareDiagnostic()).toEqual({
      verdict: "LOGGED_IN",
      readinessDecision: "READY",
      readinessReason: "positive_rows",
    });

    const located = await driver.locate();
    expect(located.count).toBe(1);
    expect(located.sig).toMatch(HEX16);
    // Deterministic: relocating (and a separate driver instance) yields the same signature.
    expect((await driver.locate()).sig).toBe(located.sig);
    expect((await new NaverFixtureProbeDriver("normal").locate()).sig).toBe(located.sig);
  });

  it("normal: no verified transition without the user's action (observation ≠ completion)", async () => {
    const driver = new NaverFixtureProbeDriver("normal");
    const sig = (await driver.locate()).sig!;
    // Nothing happened yet → not verified, and NOT drift (the target is still there, unchanged).
    expect(await driver.verify(sig)).toEqual({ verified: false, drift: false });
    driver.completeUserAction(true);
    await driver.waitForUserAction();
    expect(await driver.verify(sig)).toEqual({ verified: true, drift: false });
  });

  it("no-target: zero candidates", async () => {
    const driver = new NaverFixtureProbeDriver("no-target");
    expect(await driver.prepareSurface()).toEqual({ ok: true });
    expect(await driver.locate()).toEqual({ count: 0 });
  });

  it("multi-target: ambiguous candidate count, no signature", async () => {
    const driver = new NaverFixtureProbeDriver("multi-target");
    expect(await driver.locate()).toEqual({ count: 2 });
  });

  it("async-affordance: an async job affordance is not the supported sync surface (locate 0)", async () => {
    const driver = new NaverFixtureProbeDriver("async-affordance");
    expect(await driver.prepareSurface()).toEqual({ ok: true }); // rows exist — readiness is fine
    expect(await driver.locate()).toEqual({ count: 0 }); // layout ASYNC wins → fail closed
  });

  it("drift: the post-action surface changes the target identity", async () => {
    const driver = new NaverFixtureProbeDriver("drift");
    const sig = (await driver.locate()).sig!;
    driver.completeUserAction(true);
    await driver.waitForUserAction();
    expect(await driver.verify(sig)).toEqual({ verified: false, drift: true });
  });

  it("unchanged: the action was observed but the expected transition never happened", async () => {
    const driver = new NaverFixtureProbeDriver("unchanged");
    const sig = (await driver.locate()).sig!;
    driver.completeUserAction(true);
    await driver.waitForUserAction();
    expect(await driver.verify(sig)).toEqual({ verified: false, drift: false });
  });

  it("reconnect-required fails closed with the SESSION_EXPIRED semantic code", async () => {
    const driver = new NaverFixtureProbeDriver("reconnect-required");
    expect(await driver.prepareSurface()).toEqual({ ok: false, blockerCode: "SESSION_EXPIRED" });
    expect(driver.prepareDiagnostic()).toEqual({ verdict: "RECONNECT_REQUIRED" });
  });

  it("login-required fails closed with the LOGIN_REQUIRED semantic code", async () => {
    const driver = new NaverFixtureProbeDriver("login-required");
    expect(await driver.prepareSurface()).toEqual({ ok: false, blockerCode: "LOGIN_REQUIRED" });
    expect(driver.prepareDiagnostic()).toEqual({ verdict: "ACCOUNT_LOGIN_REQUIRED" });
  });

  it("distinguishes benign zero-rows emptiness from the ambiguous conservative halt (diagnostic only)", async () => {
    const empty = new NaverFixtureProbeDriver("empty-target");
    expect(await empty.prepareSurface()).toEqual({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    expect(empty.prepareDiagnostic()).toEqual({
      verdict: "LOGGED_IN",
      readinessDecision: "HALT",
      readinessState: "EXPORT_TARGET_EMPTY",
      readinessReason: "zero_rows",
    });

    const ambiguous = new NaverFixtureProbeDriver("ambiguous-readiness");
    expect(await ambiguous.prepareSurface()).toEqual({ ok: false, blockerCode: "UNSUPPORTED_STATE" });
    expect(ambiguous.prepareDiagnostic()).toEqual({
      verdict: "LOGGED_IN",
      readinessDecision: "HALT",
      readinessState: "EXPORT_TARGET_UNKNOWN",
      readinessReason: "ambiguous",
    });
  });
});

describe("NaverFixtureProbeDriver — synthetic downstream (default, no `real` option)", () => {
  it("returns deterministic synthetic results and counts every call", async () => {
    const driver = new NaverFixtureProbeDriver("normal");
    expect(await driver.detectDownload()).toEqual({ detected: true, artifactRef: NAVER_FIXTURE_ARTIFACT_REF });
    expect(NAVER_FIXTURE_ARTIFACT_REF).toMatch(HEX16);
    expect(await driver.validateArtifact(NAVER_FIXTURE_ARTIFACT_REF)).toEqual({ valid: true });
    expect(await driver.ingest(NAVER_FIXTURE_ARTIFACT_REF)).toEqual({ ok: true, processed: 1 });
    expect(driver.downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 1 });
  });

  it("accepts synthetic overrides (fail-shape rehearsal without any real artifact)", async () => {
    const driver = new NaverFixtureProbeDriver("normal", { downstream: { detect: { detected: false } } });
    expect(await driver.detectDownload()).toEqual({ detected: false });
  });
});

describe("NaverFixtureProbeDriver — REAL downstream (detect + quarantine validate)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  function tmpQuarantine(): string {
    const dir = mkdtempSync(join(tmpdir(), "aw-naver-quarantine-"));
    dirs.push(dir);
    return dir;
  }
  function realDriver(shape: NaverFixtureDownloadShape, dir = tmpQuarantine()): NaverFixtureProbeDriver {
    return new NaverFixtureProbeDriver("normal", { downloadShape: shape, downstream: { real: { quarantineDir: dir } } });
  }
  async function act(driver: NaverFixtureProbeDriver): Promise<void> {
    driver.completeUserAction(true);
    await driver.waitForUserAction();
  }

  it("detect consumes the user-produced artifact and reports a FRESH nonce ref (never the synthetic constant)", async () => {
    const driver = realDriver("xlsx-valid");
    await act(driver);
    const first = await driver.detectDownload();
    expect(first.detected).toBe(true);
    expect(first.artifactRef).toMatch(HEX16);
    expect(first.artifactRef).not.toBe(NAVER_FIXTURE_ARTIFACT_REF);

    const other = realDriver("xlsx-valid");
    await act(other);
    const second = await other.detectDownload();
    // Nonce-seeded: two detections never share a ref (nothing content- or name-derived).
    expect(second.artifactRef).not.toBe(first.artifactRef);
  });

  it("no user action yet → nothing pending → the timeout shape ({detected:false})", async () => {
    const driver = realDriver("xlsx-valid");
    expect(await driver.detectDownload()).toEqual({ detected: false });
  });

  it("shape none: the action fires no artifact → {detected:false}", async () => {
    const driver = realDriver("none");
    await act(driver);
    expect(await driver.detectDownload()).toEqual({ detected: false });
  });

  it("happy path: valid xlsx-shaped artifact validates, quarantine dir is empty afterwards", async () => {
    const dir = tmpQuarantine();
    const driver = realDriver("xlsx-valid", dir);
    await act(driver);
    const detected = await driver.detectDownload();
    expect(await driver.validateArtifact(detected.artifactRef!)).toEqual({ valid: true });
    expect(driver.lastQuarantine()).toEqual({ saved: true, extensionOk: true, magicOk: true, deleted: true, valid: true });
    expect(readdirSync(dir)).toEqual([]);
    expect(driver.downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 0 });
  });

  it("wrong-extension and bad-magic artifacts fail validation (still saved-then-deleted)", async () => {
    for (const [shape, failing] of [
      ["wrong-extension", "extensionOk"],
      ["bad-magic", "magicOk"],
    ] as const) {
      const dir = tmpQuarantine();
      const driver = realDriver(shape, dir);
      await act(driver);
      const detected = await driver.detectDownload();
      expect(await driver.validateArtifact(detected.artifactRef!)).toEqual({ valid: false });
      expect(driver.lastQuarantine()?.[failing]).toBe(false);
      expect(driver.lastQuarantine()?.deleted).toBe(true);
      expect(readdirSync(dir)).toEqual([]);
    }
  });

  it("validate without a prior successful detect fails closed", async () => {
    const driver = realDriver("xlsx-valid");
    await act(driver);
    // No detectDownload() call — nothing retained.
    expect(await driver.validateArtifact("0123456789abcdef")).toEqual({ valid: false });
  });

  it("cleanup drops any retained artifact and sweeps quarantine leftovers", async () => {
    const dir = tmpQuarantine();
    // A leftover from a hypothetical crashed prior run:
    const { writeFileSync } = await import("node:fs");
    writeFileSync(join(dir, "aw-quarantine-deadbeefdeadbeef.xlsx"), "leftover");
    const driver = realDriver("xlsx-valid", dir);
    await act(driver);
    await driver.detectDownload(); // retained, never validated
    await driver.cleanup();
    expect(readdirSync(dir)).toEqual([]);
    // After cleanup nothing is retained: validate fails closed.
    expect(await driver.validateArtifact("0123456789abcdef")).toEqual({ valid: false });
  });

  it("real-path outputs and the quarantine verdict never leak fixture content or platform tokens", async () => {
    for (const shape of ["xlsx-valid", "wrong-extension", "bad-magic", "none"] as const) {
      const dir = tmpQuarantine();
      const driver = realDriver(shape, dir);
      const outputs: unknown[] = [];
      outputs.push(await driver.prepareSurface(), await driver.locate());
      await act(driver);
      const detected = await driver.detectDownload();
      outputs.push(detected);
      if (detected.detected) outputs.push(await driver.validateArtifact(detected.artifactRef!));
      outputs.push(driver.lastQuarantine());
      const serialized = JSON.stringify(outputs);
      expectNoNeedle(serialized, PLATFORM_NEEDLES, `real-driver[${shape}]`);
      expectNoNeedle(serialized, FIXTURE_CONTENT_NEEDLES, `real-driver[${shape}]`);
      expectNoNeedle(serialized, [dir, "aw-quarantine", ".xlsx", ".html", "[content_types]"], `real-driver[${shape}]`);
    }
  });
});

describe("NaverFixtureProbeDriver — REAL ingest handoff (injected upload)", () => {
  const dirs: string[] = [];
  afterEach(() => {
    while (dirs.length) rmSync(dirs.pop()!, { recursive: true, force: true });
  });
  function tmpQuarantine(): string {
    const dir = mkdtempSync(join(tmpdir(), "aw-naver-ingest-"));
    dirs.push(dir);
    return dir;
  }
  async function act(driver: NaverFixtureProbeDriver): Promise<void> {
    driver.completeUserAction(true);
    await driver.waitForUserAction();
  }
  type Captured = { bytesHead: number[]; artifactRef: string; keys: string[] };
  function driverWithUpload(outcome: { ok: boolean; processed: number }, dir = tmpQuarantine()) {
    const box: { captured: Captured | null } = { captured: null };
    const upload = (src: { bytes(): Uint8Array; artifactRef: string }): Promise<{ ok: boolean; processed: number }> => {
      const bytes = src.bytes();
      box.captured = { bytesHead: Array.from(bytes.slice(0, 4)), artifactRef: src.artifactRef, keys: Object.keys(src) };
      return Promise.resolve(outcome);
    };
    const driver = new NaverFixtureProbeDriver("normal", {
      downloadShape: "xlsx-valid",
      downstream: { real: { quarantineDir: dir, ingest: { upload } } },
    });
    return { driver, dir, box };
  }
  async function runDownstream(driver: NaverFixtureProbeDriver) {
    await act(driver);
    const detected = await driver.detectDownload();
    const validated = await driver.validateArtifact(detected.artifactRef!);
    const ingested = await driver.ingest(detected.artifactRef!);
    return { detected, validated, ingested };
  }

  it("hands the validated bytes to the injected upload and returns its sanitized outcome", async () => {
    const h = driverWithUpload({ ok: true, processed: 3 });
    const { detected, validated, ingested } = await runDownstream(h.driver);
    expect(validated).toEqual({ valid: true });
    expect(ingested).toEqual({ ok: true, processed: 3 });
    expect(h.driver.downstreamCalls).toEqual({ detect: 1, validate: 1, ingest: 1 });
    // The quarantine file is still deleted after validate — the ingest reuses the in-memory bytes.
    expect(readdirSync(h.dir)).toEqual([]);
    // The upload saw the artifact bytes (ZIP-shaped) + the opaque ref — and NO filename field.
    expect(h.box.captured!.artifactRef).toBe(detected.artifactRef);
    expect(h.box.captured!.artifactRef).toMatch(HEX16);
    expect(h.box.captured!.bytesHead).toEqual([0x50, 0x4b, 0x03, 0x04]);
    expect(h.box.captured!.keys).toEqual(["bytes", "artifactRef"]);
    expect(h.box.captured!.keys).not.toContain("suggestedFilename");
  });

  it("a non-ok upload outcome fails the ingest closed", async () => {
    const h = driverWithUpload({ ok: false, processed: 0 });
    const { ingested } = await runDownstream(h.driver);
    expect(ingested).toEqual({ ok: false, processed: 0 });
    expect(h.driver.downstreamCalls.ingest).toBe(1);
  });

  it("ingest with nothing retained (no detect) fails closed and never calls the upload", async () => {
    const h = driverWithUpload({ ok: true, processed: 9 });
    expect(await h.driver.ingest("0123456789abcdef")).toEqual({ ok: false, processed: 0 });
    expect(h.box.captured).toBeNull();
  });

  it("the injected upload metadata (ref + shape) carries no filename or platform token", async () => {
    const h = driverWithUpload({ ok: true, processed: 1 });
    await runDownstream(h.driver);
    const meta = JSON.stringify({ ref: h.box.captured!.artifactRef, keys: h.box.captured!.keys });
    expectNoNeedle(meta, PLATFORM_NEEDLES, "ingest-upload-meta");
    expectNoNeedle(meta, FIXTURE_CONTENT_NEEDLES, "ingest-upload-meta");
  });
});

describe("NaverFixtureProbeDriver — privacy of driver outputs", () => {
  it("no fixture content, canary, or platform token ever appears in any driver output", async () => {
    for (const mode of ALL_MODES) {
      const driver = new NaverFixtureProbeDriver(mode);
      const outputs: unknown[] = [];
      outputs.push(await driver.prepareSurface(), driver.prepareDiagnostic(), await driver.locate());
      const sig = (await driver.locate()).sig ?? "0000000000000000";
      driver.completeUserAction(true);
      await driver.waitForUserAction();
      outputs.push(await driver.verify(sig), await driver.detectDownload(), await driver.validateArtifact(sig), await driver.ingest(sig));
      const serialized = JSON.stringify(outputs);
      expectNoNeedle(serialized, PLATFORM_NEEDLES, `driver[${mode}]`);
      expectNoNeedle(serialized, FIXTURE_CONTENT_NEEDLES, `driver[${mode}]`);
    }
  });

  it("the exported channel constants are sanitized semantic codes", () => {
    expect(NAVER_CHANNEL_CODE).toBe("naver");
    expect(NAVER_RUN_COPY_KEY).toMatch(/^[A-Za-z][A-Za-z0-9]*(\.[A-Za-z0-9]+)+$/);
  });
});

describe("NAVER driver modules — source guard (no click, no live, no save path)", () => {
  const srcDir = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/action-window");
  const stripComments = (code: string): string =>
    code
      .replace(/\/\*[\s\S]*?\*\//g, "")
      .split("\n")
      .filter((line) => !/^\s*(\/\/|\*)/.test(line))
      .join("\n");

  const MODULES = ["naver-driver.ts", "naver-fixture.ts"];
  const BANNED_TOKENS = [
    /\.click\s*\(/,
    /dispatchEvent\s*\(/,
    /waitForEvent/,
    /saveAs/,
    /playwright/i,
    /node:fs/,
    /node:net/,
    /node:http/,
    /child_process/,
    /fetch\s*\(/,
  ];
  /** Click-capable / live / persisting NAVER modules the fixture driver must never import. */
  const BANNED_IMPORTS = [
    /runExport/,
    /findModalConfirm/,
    /buildTriggerSelectors/,
    /review-download-save/,
    /review-upload-diagnostic/,
    /session-check/,
    /session-halt/,
    /\.\.\/upload/,
    /\.\.\/profile/,
    /live-export-target-probe/,
  ];

  it.each(MODULES)("%s contains no click/live/save token and no forbidden import", (file) => {
    const code = stripComments(readFileSync(join(srcDir, file), "utf8"));
    for (const re of BANNED_TOKENS) expect(re.test(code), `${file} :: ${re}`).toBe(false);
    // Whole import STATEMENTS (multi-line included), so a banned name can't hide mid-statement.
    const importStatements = code.match(/import[\s\S]*?from\s*["'][^"']+["']/g) ?? [];
    for (const statement of importStatements) {
      for (const re of BANNED_IMPORTS) {
        expect(re.test(statement), `${file} import :: ${re} :: ${statement.replace(/\s+/g, " ")}`).toBe(false);
      }
    }
  });
});
