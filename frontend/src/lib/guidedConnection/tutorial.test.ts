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

  it("covers the full issuance path (open → login → app list → create → API group → credentials → return)", () => {
    const ids = NAVER_ISSUANCE_TUTORIAL.map((s) => s.id);
    expect(ids).toEqual([
      "open_center",
      "login",
      "open_app_list",
      "create_app",
      "select_api_group",
      "view_credentials",
      "return_to_sellerops",
    ]);
  });

  it("the existing-app walk never tells the seller to create a second app", () => {
    const text = NAVER_EXISTING_APP_TUTORIAL.map((s) => `${s.title} ${s.hint}`).join(" ");
    expect(text).toMatch(/새 애플리케이션을 만들지 마세요|새로 만들지/);
    expect(NAVER_EXISTING_APP_TUTORIAL.some((s) => s.id === "create_app")).toBe(false);
  });

  it("every step carries an actionable hint; the qualifier warns labels may differ (no hardcoded verbatim UI)", () => {
    for (const s of [...NAVER_ISSUANCE_TUTORIAL, ...NAVER_EXISTING_APP_TUTORIAL]) {
      expect(s.hint.length).toBeGreaterThan(0);
    }
    expect(TUTORIAL_HINT_QUALIFIER).toMatch(/다를 수 있으니/);
  });
});
