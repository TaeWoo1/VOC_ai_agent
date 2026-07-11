/**
 * **Local Agent — Action Window channel selection + hosting config (R4, D-023).** Hermetic unit
 * coverage for the pure dev-only gate that decides WHICH Action Window channel the Bridge hosts
 * (synthetic R2B vs the NAVER fixture channel) and the config it builds. No browser, no network,
 * no live NAVER: the NAVER-fixture driver is a synthetic composition, and the default boot wires a
 * synthetic ingest (a real `/api/uploads` upload is opt-in and never exercised here).
 */
import { describe, it, expect } from "vitest";
import {
  resolveActionWindowChannel,
  resolveActionWindowSynthetic,
  buildActionWindowConfig,
  ACTION_WINDOW_SYNTHETIC_FLAG,
  ACTION_WINDOW_NAVER_FIXTURE_FLAG,
  ACTION_WINDOW_INGEST_LOCAL_FLAG,
} from "../../src/cli/local-agent";
import { NaverFixtureProbeDriver, NAVER_CHANNEL_CODE, NAVER_RUN_COPY_KEY } from "../../src/action-window/naver-driver";
import { SyntheticProbeDriver } from "../../src/action-window/session";

const DEV = { NODE_ENV: "development" } as NodeJS.ProcessEnv;
const PROD = { NODE_ENV: "production" } as NodeJS.ProcessEnv;

describe("resolveActionWindowChannel — dev-only gate", () => {
  it("selects the synthetic channel for the synthetic flag in non-production", () => {
    expect(resolveActionWindowChannel([ACTION_WINDOW_SYNTHETIC_FLAG], DEV)).toBe("synthetic");
  });

  it("selects the NAVER fixture channel for the NAVER-fixture flag in non-production", () => {
    expect(resolveActionWindowChannel([ACTION_WINDOW_NAVER_FIXTURE_FLAG], DEV)).toBe("naver-fixture");
  });

  it("the NAVER-fixture flag wins when both flags are present", () => {
    expect(resolveActionWindowChannel([ACTION_WINDOW_SYNTHETIC_FLAG, ACTION_WINDOW_NAVER_FIXTURE_FLAG], DEV)).toBe("naver-fixture");
  });

  it("hosts nothing under NODE_ENV=production (either flag)", () => {
    expect(resolveActionWindowChannel([ACTION_WINDOW_SYNTHETIC_FLAG], PROD)).toBeNull();
    expect(resolveActionWindowChannel([ACTION_WINDOW_NAVER_FIXTURE_FLAG], PROD)).toBeNull();
  });

  it("hosts nothing without a flag", () => {
    expect(resolveActionWindowChannel([], DEV)).toBeNull();
  });

  it("back-compat: resolveActionWindowSynthetic is true ONLY for the synthetic channel", () => {
    expect(resolveActionWindowSynthetic([ACTION_WINDOW_SYNTHETIC_FLAG], DEV)).toBe(true);
    expect(resolveActionWindowSynthetic([ACTION_WINDOW_SYNTHETIC_FLAG], PROD)).toBe(false);
    expect(resolveActionWindowSynthetic([ACTION_WINDOW_NAVER_FIXTURE_FLAG], DEV)).toBe(false); // NAVER ≠ synthetic
    expect(resolveActionWindowSynthetic([], DEV)).toBe(false);
  });
});

describe("buildActionWindowConfig — hosted run config", () => {
  it("synthetic: channelCode synthetic, SyntheticProbeDriver, R3 persistence, opaque run id", () => {
    const cfg = buildActionWindowConfig("synthetic", [ACTION_WINDOW_SYNTHETIC_FLAG], DEV);
    expect(cfg.channelCode).toBe("synthetic");
    expect(cfg.runCopyKey).toBe("actionWindow.run.synthetic");
    expect(cfg.createDriver()).toBeInstanceOf(SyntheticProbeDriver);
    expect(cfg.persistDir).toMatch(/\.operation-runs$/);
    expect(cfg.runId).toMatch(/^run_[0-9a-f]{12}$/);
  });

  it("naver-fixture: channelCode naver, NaverFixtureProbeDriver, R3 persistence, opaque run id", () => {
    const cfg = buildActionWindowConfig("naver-fixture", [ACTION_WINDOW_NAVER_FIXTURE_FLAG], DEV);
    expect(cfg.channelCode).toBe(NAVER_CHANNEL_CODE);
    expect(cfg.channelCode).toBe("naver");
    expect(cfg.runCopyKey).toBe(NAVER_RUN_COPY_KEY);
    expect(cfg.createDriver()).toBeInstanceOf(NaverFixtureProbeDriver);
    expect(cfg.persistDir).toMatch(/\.operation-runs$/);
    expect(cfg.runId).toMatch(/^run_[0-9a-f]{12}$/);
  });

  it("the run id is freshly minted per build (never a fixed/derived value)", () => {
    const a = buildActionWindowConfig("naver-fixture", [ACTION_WINDOW_NAVER_FIXTURE_FLAG], DEV);
    const b = buildActionWindowConfig("naver-fixture", [ACTION_WINDOW_NAVER_FIXTURE_FLAG], DEV);
    expect(a.runId).not.toBe(b.runId);
  });

  it("naver-fixture builds cleanly with and without the local-ingest opt-in (no network at build time)", () => {
    // Default (no opt-in): synthetic ingest, no creds read.
    expect(() => buildActionWindowConfig("naver-fixture", [ACTION_WINDOW_NAVER_FIXTURE_FLAG], DEV).createDriver()).not.toThrow();
    // Opt-in present: the real upload is injected (built lazily, never invoked here) — still no throw.
    const withIngest = buildActionWindowConfig(
      "naver-fixture",
      [ACTION_WINDOW_NAVER_FIXTURE_FLAG, ACTION_WINDOW_INGEST_LOCAL_FLAG],
      DEV,
    );
    expect(withIngest.createDriver()).toBeInstanceOf(NaverFixtureProbeDriver);
    expect(withIngest.channelCode).toBe("naver");
  });
});
