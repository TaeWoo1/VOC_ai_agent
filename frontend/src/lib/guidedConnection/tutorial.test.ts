// Tutorial content invariants (honesty + privacy). Pure/node-env.
import { describe, it, expect } from "vitest";
import {
  NAVER_API_CENTER_URL,
  NAVER_EXISTING_APP_TUTORIAL,
  NAVER_ISSUANCE_TUTORIAL,
  TUTORIAL_HINT_QUALIFIER,
} from "./tutorial";

describe("NAVER issuance tutorial content", () => {
  it("the API-center URL is the official commerce center over https", () => {
    expect(NAVER_API_CENTER_URL).toMatch(/^https:\/\/[^/]*commerce\.naver\.com/);
  });

  it("exactly one step opens the center (the external-tab action), and it is the first step", () => {
    const openers = NAVER_ISSUANCE_TUTORIAL.filter((s) => s.opensCenter);
    expect(openers).toHaveLength(1);
    expect(NAVER_ISSUANCE_TUTORIAL[0]?.opensCenter).toBe(true);
  });

  it("covers the full issuance path (open → login → app list → create → usage check → API group → call IP → credentials → return)", () => {
    const ids = NAVER_ISSUANCE_TUTORIAL.map((s) => s.id);
    expect(ids).toEqual([
      "open_center",
      "login",
      "open_app_list",
      "create_app",
      "app_usage_check",
      "select_api_group",
      "register_call_ip",
      "view_credentials",
      "return_to_sellerops",
    ]);
  });

  it("both walks put the call-IP registration step right after the API-group step, before reading credentials", () => {
    for (const walk of [NAVER_ISSUANCE_TUTORIAL, NAVER_EXISTING_APP_TUTORIAL]) {
      const ids = walk.map((s) => s.id);
      const apiGroup = ids.findIndex((id) => id === "select_api_group" || id === "verify_api_group");
      const callIp = ids.indexOf("register_call_ip");
      const credentials = ids.indexOf("view_credentials");
      expect(callIp).toBe(apiGroup + 1); // immediately after the API-group step
      expect(callIp).toBeLessThan(credentials); // before reading the ID/Secret
      // Honest + non-fabricating: it references the displayed fixed IP and hedges when none is shown.
      const step = walk.find((s) => s.id === "register_call_ip")!;
      expect(step.hint).toMatch(/API 호출 IP/);
      expect(step.hint).toMatch(/표시된 (고정 )?IP가 없으면|담당자에게 문의/);
      expect(step.opensCenter).not.toBe(true);
    }
  });

  it("the existing-app walk never tells the seller to create a second app", () => {
    const text = NAVER_EXISTING_APP_TUTORIAL.map((s) => `${s.title} ${s.hint}`).join(" ");
    expect(text).toMatch(/새 애플리케이션을 만들지 마세요|새로 만들지/);
    expect(NAVER_EXISTING_APP_TUTORIAL.some((s) => s.id === "create_app")).toBe(false);
  });

  it("both walks insert the usage-state check right after opening/creating the app, before the API-group step", () => {
    for (const walk of [NAVER_ISSUANCE_TUTORIAL, NAVER_EXISTING_APP_TUTORIAL]) {
      const ids = walk.map((s) => s.id);
      const usage = ids.indexOf("app_usage_check");
      const apiGroup = ids.findIndex((id) => id === "select_api_group" || id === "verify_api_group");
      expect(usage).toBeGreaterThan(0); // present, never first
      expect(usage).toBeLessThan(apiGroup); // before the API-group step
    }
  });

  it("the usage-state check advises reactivation but never claims the app is active (absence ≠ active)", () => {
    for (const walk of [NAVER_ISSUANCE_TUTORIAL, NAVER_EXISTING_APP_TUTORIAL]) {
      const step = walk.find((s) => s.id === "app_usage_check")!;
      expect(step.hint).toMatch(/다시사용/); // points the seller at the reactivate control
      expect(step.hint).toMatch(/단정하지는 않습니다/); // and does NOT assert the app is active
      expect(step.opensCenter).not.toBe(true); // text-only advisory — never the tab-opening step
    }
  });

  it("every step carries an actionable hint; the qualifier warns labels may differ (no hardcoded verbatim UI)", () => {
    for (const s of [...NAVER_ISSUANCE_TUTORIAL, ...NAVER_EXISTING_APP_TUTORIAL]) {
      expect(s.hint.length).toBeGreaterThan(0);
    }
    expect(TUTORIAL_HINT_QUALIFIER).toMatch(/다를 수 있으니/);
  });
});
