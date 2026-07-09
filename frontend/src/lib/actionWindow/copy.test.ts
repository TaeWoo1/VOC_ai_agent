import { describe, it, expect } from "vitest";
import { COMMAND_TYPES, BLOCKER_CODES, RUN_STATUSES, STEP_STATUSES } from "./contract";
import {
  resolveCopy,
  hasCopy,
  COPY_FALLBACK,
  commandLabel,
  blockerView,
  runStatusView,
  stepStatusView,
  channelLabel,
  CHANNEL_FALLBACK,
  CONNECTION_VIEW,
  CONNECTION_RETRY_FAILED_NOTE,
} from "./copy";

describe("FE-owned copy registry", () => {
  it("resolves a known copy key", () => {
    expect(resolveCopy("actionWindow.review.run")).toBe("리뷰 내려받기");
    expect(hasCopy("actionWindow.review.run")).toBe(true);
  });

  it("falls back safely for an unknown copy key (never leaks the raw key)", () => {
    const out = resolveCopy("actionWindow.review.unknownKey");
    expect(out).toBe(COPY_FALLBACK);
    expect(out).not.toContain("actionWindow");
    expect(hasCopy("actionWindow.review.unknownKey")).toBe(false);
  });

  it("interpolates sanitized primitive params when present", () => {
    expect(resolveCopy("actionWindow.review.run", { marketplace: "esm_plus" })).toBe("리뷰 내려받기");
  });

  it("has an FE label for every command, blocker, run status, and step status", () => {
    for (const c of COMMAND_TYPES) expect(commandLabel(c).length).toBeGreaterThan(0);
    for (const b of BLOCKER_CODES) expect(blockerView(b).title.length).toBeGreaterThan(0);
    for (const s of RUN_STATUSES) expect(runStatusView(s).label.length).toBeGreaterThan(0);
    for (const s of STEP_STATUSES) expect(stepStatusView(s).label.length).toBeGreaterThan(0);
  });

  it("maps a known channel code and falls back to a safe label (never the raw code)", () => {
    expect(channelLabel("esm_plus")).toContain("ESM");
    expect(channelLabel("unknown_code")).toBe(CHANNEL_FALLBACK);
    expect(channelLabel("unknown_code")).not.toContain("unknown_code");
  });

  it("offline connection view carries a manual reconnect action; reconnecting has none", () => {
    expect(CONNECTION_VIEW.offline.action?.length).toBeGreaterThan(0);
    expect(CONNECTION_VIEW.offline.actionPending?.length).toBeGreaterThan(0);
    // Offline is terminal — its body no longer promises an automatic retry.
    expect(CONNECTION_VIEW.offline.body).not.toContain("자동");
    // Reconnecting is auto-retrying, so it offers no manual button.
    expect(CONNECTION_VIEW.reconnecting.action).toBeUndefined();
  });

  it("has a safe manual-reconnect failure note (never a raw transport reason)", () => {
    expect(CONNECTION_RETRY_FAILED_NOTE.length).toBeGreaterThan(0);
    expect(CONNECTION_RETRY_FAILED_NOTE).not.toContain("aw_");
    expect(CONNECTION_RETRY_FAILED_NOTE).not.toContain("offline");
  });
});
