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

describe("Guided Acquisition Reliability — blocker copy", () => {
  const RELIABILITY_CODES = [
    "SURFACE_OPEN_FAILED",
    "PREPARE_NOT_STARTED",
    "SURFACE_SETTLE_TIMEOUT",
    "GUIDANCE_PACK_REJECTED",
    "OVERLAY_MOUNT_FAILED",
    "OVERLAY_NOT_VISIBLE",
    "SURFACE_CLOSED",
  ] as const;

  it("gives every reliability code its own real copy, not the generic fallback", () => {
    for (const code of RELIABILITY_CODES) {
      const view = blockerView(code);
      expect(view.title).not.toBe("진행이 멈췄어요");
      expect(view.title.length).toBeGreaterThan(0);
      expect(view.body.length).toBeGreaterThan(0);
    }
  });

  it("never leaks a raw enum / selector / path into the copy", () => {
    for (const code of RELIABILITY_CODES) {
      const view = blockerView(code);
      expect(view.title).not.toMatch(/[A-Z_]{6,}/);
      expect(view.body).not.toContain("aw_");
      expect(view.body).not.toContain("http");
    }
  });

  it("names the real Korean screen and one recovery action for the closed-window case", () => {
    const view = blockerView("SURFACE_CLOSED");
    expect(view.title).toContain("판매자센터");
    expect(view.body).toContain("다시 확인");
  });
});
