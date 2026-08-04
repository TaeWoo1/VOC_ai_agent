import { describe, it, expect } from "vitest";
import {
  compareAgentVersions,
  runtimeSelfCheck,
  RUNTIME_SELF_CHECK_RECOVERY,
  type RuntimeSelfCheckInput,
  type RuntimeSelfCheckIssue,
} from "../../src/runtime/self-check";

const healthy: RuntimeSelfCheckInput = {
  appUrl: "http://localhost:5173",
  allowedOrigins: ["http://localhost:5173"],
  backendReachable: true,
  agentVersion: "1.0.0",
  reviewUrlPresent: true,
  browserAvailable: true,
  profileDirWritable: true,
  approvalChannelAvailable: true,
};

describe("compareAgentVersions", () => {
  it("orders by major.minor.patch", () => {
    expect(compareAgentVersions("1.2.3", "1.2.4")).toBe(-1);
    expect(compareAgentVersions("2.0.0", "1.9.9")).toBe(1);
    expect(compareAgentVersions("1.0.0", "1.0.0")).toBe(0);
  });

  it("treats a pre-release as lower than the same release numerics", () => {
    expect(compareAgentVersions("0.0.1-poc", "0.0.1")).toBe(-1);
    expect(compareAgentVersions("0.0.1", "0.0.1-poc")).toBe(1);
  });

  it("un-parseable versions compare equal (never a false 'unsupported')", () => {
    expect(compareAgentVersions("weird", "1.0.0")).toBe(0);
  });
});

describe("runtimeSelfCheck", () => {
  it("a fully-wired agent has no issues", () => {
    expect(runtimeSelfCheck(healthy)).toEqual({ ok: true, issues: [] });
  });

  it("surfaces connectivity issues from the guided pre-flight first", () => {
    const r = runtimeSelfCheck({ ...healthy, backendReachable: false, allowedOrigins: [] });
    expect(r.ok).toBe(false);
    expect(r.issues[0]).toBe("BACKEND_UNREACHABLE");
    expect(r.issues).toContain("BRIDGE_ORIGINS_EMPTY");
  });

  it("flags an unsupported version only when a required minimum is supplied AND this build is older", () => {
    expect(runtimeSelfCheck({ ...healthy, agentVersion: "0.0.1-poc" }).issues).not.toContain(
      "AGENT_VERSION_UNSUPPORTED",
    );
    expect(
      runtimeSelfCheck({ ...healthy, agentVersion: "0.0.1-poc", requiredAgentVersion: "1.0.0" }).issues,
    ).toContain("AGENT_VERSION_UNSUPPORTED");
    expect(
      runtimeSelfCheck({ ...healthy, agentVersion: "1.2.0", requiredAgentVersion: "1.0.0" }).issues,
    ).not.toContain("AGENT_VERSION_UNSUPPORTED");
  });

  it("flags the approval-channel gap (the Windows pairing blocker)", () => {
    const r = runtimeSelfCheck({ ...healthy, approvalChannelAvailable: false });
    expect(r.issues).toContain("APPROVAL_CHANNEL_UNAVAILABLE");
  });

  it("flags each missing capability", () => {
    const r = runtimeSelfCheck({
      ...healthy,
      reviewUrlPresent: false,
      browserAvailable: false,
      profileDirWritable: false,
    });
    expect(r.issues).toEqual(
      expect.arrayContaining(["REVIEW_URL_MISSING", "BROWSER_UNAVAILABLE", "PROFILE_DIR_UNWRITABLE"]),
    );
  });

  it("every issue has a recovery action key", () => {
    const r = runtimeSelfCheck({
      appUrl: "http://localhost:5173",
      allowedOrigins: [],
      backendReachable: false,
      agentVersion: "0.0.1-poc",
      requiredAgentVersion: "1.0.0",
      reviewUrlPresent: false,
      browserAvailable: false,
      profileDirWritable: false,
      approvalChannelAvailable: false,
    });
    for (const issue of r.issues as RuntimeSelfCheckIssue[]) {
      expect(RUNTIME_SELF_CHECK_RECOVERY[issue]?.length).toBeGreaterThan(0);
    }
  });
});
