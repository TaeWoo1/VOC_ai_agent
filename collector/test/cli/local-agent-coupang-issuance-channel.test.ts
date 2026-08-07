/**
 * Coupang WING issuance guidance channel wiring in the local-agent boot: the pure resolver + config
 * builder, the Bridge hosting seam (the endpoint is registered and a Coupang session is attached), and the
 * ONE-carrier mutual-exclusion invariant. This is the OFFLINE host the browser product path pairs to and
 * drives — the fixture driver, no browser, no live WING, no CLI client. Mirror of the NAVER issuance test.
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_WINDOW_COUPANG_ISSUANCE_FLAG,
  ACTION_WINDOW_ISSUANCE_FLAG,
  buildCoupangIssuanceConfig,
  resolveCoupangIssuanceChannel,
} from "../../src/cli/local-agent";
import { createAgentBridge } from "../../src/agent/agent-bridge";
import { SyntheticProbeDriver } from "../../src/action-window/session";
import { SyntheticReplySubmitDriver } from "../../src/action-window/reply-submission/reply-driver";
import { IssuanceFixtureDriver } from "../../src/action-window/api-issuance/issuance-fixture-driver";
import { CoupangIssuanceFixtureDriver } from "../../src/action-window/coupang-issuance/coupang-issuance-fixture-driver";

const BASE = {
  port: 0,
  allowedOrigins: ["http://localhost:5173"],
  pairingFile: "/tmp/does-not-listen/pairings.json",
  agentVersion: "test",
  refSalt: "test-salt",
  now: () => 0,
};

describe("resolveCoupangIssuanceChannel", () => {
  it("hosts the Coupang issuance channel only when the dev flag is present and not in production", () => {
    expect(resolveCoupangIssuanceChannel([ACTION_WINDOW_COUPANG_ISSUANCE_FLAG], {})).toBe(true);
    expect(resolveCoupangIssuanceChannel([], {})).toBe(false);
    expect(resolveCoupangIssuanceChannel([ACTION_WINDOW_COUPANG_ISSUANCE_FLAG], { NODE_ENV: "production" })).toBe(false);
  });

  it("does not react to the NAVER issuance flag (the flags are distinct carriers)", () => {
    expect(resolveCoupangIssuanceChannel([ACTION_WINDOW_ISSUANCE_FLAG], {})).toBe(false);
  });
});

describe("buildCoupangIssuanceConfig", () => {
  it("builds a synthetic-fixture-driver config on channelCode coupang with a Runtime-assigned runId and no persistence", () => {
    const cfg = buildCoupangIssuanceConfig();
    expect(cfg.runId).toMatch(/^run_[0-9a-f]{12}$/);
    expect(cfg.channelCode).toBe("coupang");
    // The default driver is the synthetic Coupang fixture — no browser, no live WING, no credential read.
    expect(cfg.createDriver()).toBeInstanceOf(CoupangIssuanceFixtureDriver);
    // Read-only guidance has nothing to recover → deliberately no persistDir on the config shape.
    expect("persistDir" in cfg).toBe(false);
  });
});

describe("createAgentBridge — Coupang issuance carrier is registered and isolated", () => {
  it("attaches the Coupang issuance session when coupangIssuance is configured (and only then)", () => {
    const withCoupang = createAgentBridge({ ...BASE, coupangIssuance: buildCoupangIssuanceConfig() });
    expect(withCoupang.coupangIssuanceSession).toBeDefined();
    // The other carrier sessions are absent — exactly one carrier is hosted.
    expect(withCoupang.apiIssuanceSession).toBeUndefined();
    expect(withCoupang.actionWindowSession).toBeUndefined();
    expect(withCoupang.replySubmissionSession).toBeUndefined();
    expect(withCoupang.importHost).toBeUndefined();

    const without = createAgentBridge({ ...BASE });
    expect(without.coupangIssuanceSession).toBeUndefined();
  });

  it("is mutually exclusive with every other carrier", () => {
    const coupang = () => buildCoupangIssuanceConfig();
    expect(() =>
      createAgentBridge({
        ...BASE,
        coupangIssuance: coupang(),
        actionWindow: { runId: "run_export00001", channelCode: "synthetic", runCopyKey: "k", createDriver: () => new SyntheticProbeDriver() },
      }),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      createAgentBridge({
        ...BASE,
        coupangIssuance: coupang(),
        replySubmission: { runId: "run_reply000001", channelCode: "naver", createDriver: () => new SyntheticReplySubmitDriver() },
      }),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      createAgentBridge({
        ...BASE,
        coupangIssuance: coupang(),
        apiIssuance: { runId: "run_issuance0001", channelCode: "naver", createDriver: () => new IssuanceFixtureDriver() },
      }),
    ).toThrow(/mutually exclusive/);
  });
});
