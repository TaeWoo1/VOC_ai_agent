import { describe, it, expect } from "vitest";
import {
  daysRemainingLabel,
  expiryNeedsAttention,
  expiryStateView,
  renewRecommendedForState,
  shouldOfferRenewal,
} from "./coupangExpiry";
import type { CoupangExpiryState, CoupangExpiryStatusView } from "./types";

const ALL_STATES: CoupangExpiryState[] = [
  "UNKNOWN",
  "OK",
  "WARN_30",
  "WARN_14",
  "WARN_7",
  "WARN_1",
  "DATE_PASSED",
  "EXPIRED",
];

describe("expiryStateView — state → Korean label + tone (all states)", () => {
  it("maps every state to a non-empty label + tone (no blank render possible)", () => {
    for (const state of ALL_STATES) {
      const view = expiryStateView(state);
      expect(view.label.length).toBeGreaterThan(0);
      expect(view.tone).toBeTruthy();
    }
  });

  it("uses the four operator buckets (정상 / 만료 예정 / 조치 필요 / 만료됨) plus honest UNKNOWN", () => {
    expect(expiryStateView("OK")).toEqual({ label: "정상", tone: "ok" });
    expect(expiryStateView("WARN_30").tone).toBe("warn");
    expect(expiryStateView("WARN_14").label).toBe("만료 예정");
    expect(expiryStateView("WARN_7").tone).toBe("warn");
    expect(expiryStateView("WARN_1").tone).toBe("warn");
    expect(expiryStateView("DATE_PASSED")).toEqual({ label: "조치 필요", tone: "attention" });
    expect(expiryStateView("EXPIRED")).toEqual({ label: "만료됨", tone: "expired" });
    expect(expiryStateView("UNKNOWN")).toEqual({ label: "만료일 미확인", tone: "unknown" });
  });
});

describe("expiryNeedsAttention — operational-surface flag", () => {
  it("flags WARN_* / DATE_PASSED / EXPIRED, not OK / UNKNOWN", () => {
    expect(expiryNeedsAttention("OK")).toBe(false);
    expect(expiryNeedsAttention("UNKNOWN")).toBe(false);
    for (const s of ["WARN_30", "WARN_14", "WARN_7", "WARN_1", "DATE_PASSED", "EXPIRED"] as const) {
      expect(expiryNeedsAttention(s)).toBe(true);
    }
  });
});

describe("renewRecommendedForState — renewal offered from WARN_14 onward", () => {
  it("is false before WARN_14 and true from WARN_14 on", () => {
    expect(renewRecommendedForState("OK")).toBe(false);
    expect(renewRecommendedForState("UNKNOWN")).toBe(false);
    expect(renewRecommendedForState("WARN_30")).toBe(false);
    for (const s of ["WARN_14", "WARN_7", "WARN_1", "DATE_PASSED", "EXPIRED"] as const) {
      expect(renewRecommendedForState(s)).toBe(true);
    }
  });
});

describe("shouldOfferRenewal — prefers backend renewRecommended, falls back to state", () => {
  const view = (over: Partial<CoupangExpiryStatusView>): CoupangExpiryStatusView => ({
    expiresAt: null,
    daysRemaining: null,
    state: "OK",
    authFailing: false,
    renewRecommended: false,
    ...over,
  });

  it("false for null/undefined", () => {
    expect(shouldOfferRenewal(null)).toBe(false);
    expect(shouldOfferRenewal(undefined)).toBe(false);
  });

  it("uses the backend boolean when present", () => {
    expect(shouldOfferRenewal(view({ state: "OK", renewRecommended: true }))).toBe(true);
    expect(shouldOfferRenewal(view({ state: "WARN_14", renewRecommended: false }))).toBe(false);
  });

  it("falls back to the state derivation when the boolean is absent", () => {
    const noBool = { expiresAt: null, daysRemaining: null, state: "WARN_14", authFailing: false } as unknown as CoupangExpiryStatusView;
    expect(shouldOfferRenewal(noBool)).toBe(true);
  });
});

describe("daysRemainingLabel — honest day-count, never fabricated", () => {
  it("null → null (never a guess)", () => {
    expect(daysRemainingLabel(null)).toBeNull();
    expect(daysRemainingLabel(undefined)).toBeNull();
  });
  it("positive / zero / negative phrase distinctly", () => {
    expect(daysRemainingLabel(12)).toBe("약 12일 남았어요");
    expect(daysRemainingLabel(0)).toBe("오늘 만료돼요");
    expect(daysRemainingLabel(-3)).toBe("만료일이 3일 지났어요");
  });
});
