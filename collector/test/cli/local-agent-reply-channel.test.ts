/**
 * Reply-submission channel wiring in the local-agent boot: the pure resolver + config builder, and the
 * Bridge mutual-exclusion invariant (an agent hosts EITHER an export run OR a reply run, never both).
 */
import { describe, it, expect } from "vitest";
import {
  ACTION_WINDOW_REPLY_FLAG,
  buildReplySubmissionConfig,
  resolveReplySubmissionChannel,
} from "../../src/cli/local-agent";
import { createAgentBridge } from "../../src/agent/agent-bridge";
import { SyntheticProbeDriver } from "../../src/action-window/session";
import { SyntheticReplySubmitDriver } from "../../src/action-window/reply-submission/reply-driver";

describe("resolveReplySubmissionChannel", () => {
  it("hosts the reply channel only when the dev flag is present and not in production", () => {
    expect(resolveReplySubmissionChannel([ACTION_WINDOW_REPLY_FLAG], {})).toBe(true);
    expect(resolveReplySubmissionChannel([], {})).toBe(false);
    expect(resolveReplySubmissionChannel([ACTION_WINDOW_REPLY_FLAG], { NODE_ENV: "production" })).toBe(false);
  });
});

describe("buildReplySubmissionConfig", () => {
  it("builds a synthetic-driver config with a Runtime-assigned runId and the .reply-runs store", () => {
    const cfg = buildReplySubmissionConfig();
    expect(cfg.runId).toMatch(/^run_[0-9a-f]{12}$/);
    expect(cfg.channelCode).toBe("naver");
    expect(cfg.persistDir?.endsWith(".reply-runs")).toBe(true);
    // The default driver is synthetic — no browser, no live NAVER.
    expect(cfg.createDriver()).toBeInstanceOf(SyntheticReplySubmitDriver);
  });
});

describe("createAgentBridge — export and reply carriers are mutually exclusive", () => {
  it("throws if both actionWindow and replySubmission are configured", () => {
    expect(() =>
      createAgentBridge({
        port: 0,
        allowedOrigins: ["http://localhost:5173"],
        pairingFile: "/tmp/does-not-listen/pairings.json",
        agentVersion: "test",
        refSalt: "test-salt",
        now: () => 0,
        actionWindow: { runId: "run_export00001", channelCode: "synthetic", runCopyKey: "k", createDriver: () => new SyntheticProbeDriver() },
        replySubmission: { runId: "run_reply000001", channelCode: "naver", createDriver: () => new SyntheticReplySubmitDriver() },
      }),
    ).toThrow(/mutually exclusive/);
  });
});
