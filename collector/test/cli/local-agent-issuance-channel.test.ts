/**
 * API-issuance guidance channel wiring in the local-agent boot: the pure resolver + config builder, the
 * Bridge hosting seam (the endpoint is registered and a session is attached), and the ONE-carrier
 * mutual-exclusion invariant (an agent hosts exactly one carrier — export | reply | import | issuance).
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_WINDOW_ISSUANCE_FLAG,
  buildApiIssuanceConfig,
  resolveApiIssuanceChannel,
} from "../../src/cli/local-agent";
import { createAgentBridge } from "../../src/agent/agent-bridge";
import { SyntheticProbeDriver } from "../../src/action-window/session";
import { SyntheticReplySubmitDriver } from "../../src/action-window/reply-submission/reply-driver";
import { IssuanceFixtureDriver } from "../../src/action-window/api-issuance/issuance-fixture-driver";

const BASE = {
  port: 0,
  allowedOrigins: ["http://localhost:5173"],
  pairingFile: "/tmp/does-not-listen/pairings.json",
  agentVersion: "test",
  refSalt: "test-salt",
  now: () => 0,
};

describe("resolveApiIssuanceChannel", () => {
  it("hosts the issuance channel only when the dev flag is present and not in production", () => {
    expect(resolveApiIssuanceChannel([ACTION_WINDOW_ISSUANCE_FLAG], {})).toBe(true);
    expect(resolveApiIssuanceChannel([], {})).toBe(false);
    expect(resolveApiIssuanceChannel([ACTION_WINDOW_ISSUANCE_FLAG], { NODE_ENV: "production" })).toBe(false);
  });
});

describe("buildApiIssuanceConfig", () => {
  it("builds a synthetic-fixture-driver config with a Runtime-assigned runId and no persistence", () => {
    const cfg = buildApiIssuanceConfig();
    expect(cfg.runId).toMatch(/^run_[0-9a-f]{12}$/);
    expect(cfg.channelCode).toBe("naver");
    // The default driver is the synthetic fixture — no browser, no live NAVER, no credential read.
    expect(cfg.createDriver()).toBeInstanceOf(IssuanceFixtureDriver);
    // Read-only guidance has nothing to recover → deliberately no persistDir on the config shape.
    expect("persistDir" in cfg).toBe(false);
  });
});

describe("createAgentBridge — issuance carrier is registered and isolated", () => {
  it("attaches the issuance session when apiIssuance is configured (and only then)", () => {
    const withIssuance = createAgentBridge({ ...BASE, apiIssuance: buildApiIssuanceConfig() });
    expect(withIssuance.apiIssuanceSession).toBeDefined();
    // The other carrier sessions are absent — exactly one carrier is hosted.
    expect(withIssuance.actionWindowSession).toBeUndefined();
    expect(withIssuance.replySubmissionSession).toBeUndefined();
    expect(withIssuance.importHost).toBeUndefined();

    const without = createAgentBridge({ ...BASE });
    expect(without.apiIssuanceSession).toBeUndefined();
  });

  it("is mutually exclusive with every other carrier", () => {
    const issuance = () => buildApiIssuanceConfig();
    expect(() =>
      createAgentBridge({
        ...BASE,
        apiIssuance: issuance(),
        actionWindow: { runId: "run_export00001", channelCode: "synthetic", runCopyKey: "k", createDriver: () => new SyntheticProbeDriver() },
      }),
    ).toThrow(/mutually exclusive/);
    expect(() =>
      createAgentBridge({
        ...BASE,
        apiIssuance: issuance(),
        replySubmission: { runId: "run_reply000001", channelCode: "naver", createDriver: () => new SyntheticReplySubmitDriver() },
      }),
    ).toThrow(/mutually exclusive/);
  });
});
