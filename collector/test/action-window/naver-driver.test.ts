/**
 * Unit tests for the FIXTURE-ONLY NAVER pilot driver (R4, D-021). Offline, no browser, no backend.
 * Covers: the composed upstream stages (session verdict → readiness → locate → verify) per fixture
 * mode, the fail-closed hostile shapes (0/many targets, drift, reconnect/login, empty vs ambiguous
 * readiness, async affordance), signature determinism/opacity, the synthetic downstream defaults,
 * the module source-guard (no click / no live / no save path), and the privacy boundary (fixture
 * canaries and platform tokens never appear in any driver output).
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
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

describe("NaverFixtureProbeDriver — synthetic downstream", () => {
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
