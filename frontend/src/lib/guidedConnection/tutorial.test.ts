// Tutorial content invariants (honesty + privacy). Pure/node-env.
import { describe, it, expect } from "vitest";
import {
  COUPANG_ISSUANCE_TUTORIAL,
  COUPANG_WING_URL,
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

/**
 * **The Coupang checklist had no test at all, and that is why it stayed wrong.**
 *
 * The guided Action Window copy is pinned character-for-character to the runtime by a cross-stack parity
 * test, so every live measurement reached it. This checklist — the text fallback the seller lands on the
 * moment guidance is impossible — was pinned to nothing, and kept the pre-measurement plan through every
 * correction: 자체개발 as the third step, 업체명/URL/호출 IP before 발급, and 발급 named as the press that
 * creates the key with "copy your keys" immediately after it.
 *
 * These assertions are about ORDER and CLAIMS, not phrasing, so the copy can still be improved.
 */
describe("Coupang WING issuance checklist content", () => {
  const ids = COUPANG_ISSUANCE_TUTORIAL.map((s) => s.id);
  const at = (id: string) => ids.indexOf(id);

  it("the WING URL is the official seller center over https", () => {
    expect(COUPANG_WING_URL).toMatch(/^https:\/\/wing\.coupang\.com\/?$/);
  });

  it("exactly one step opens WING, and it is the first step", () => {
    expect(COUPANG_ISSUANCE_TUTORIAL.filter((s) => s.opensCenter)).toHaveLength(1);
    expect(COUPANG_ISSUANCE_TUTORIAL[0]?.opensCenter).toBe(true);
  });

  it("walks the measured screen order: 발급 → 사용 목적 → 약관 → 업체 입력 방식 → 확인 → 복사", () => {
    expect(ids).toEqual([
      "open_wing",
      "reach_open_api",
      "reveal_form",
      "confirm_purpose",
      "terms_consent",
      "terms_issue_button",
      "vendor_method",
      "register_call_ip",
      "issue_checkpoint",
      "copy_keys",
      "return_to_sellerops",
    ]);
  });

  it("never offers 자체개발 before the vendor-method screen — the purpose screen does not have it", () => {
    for (const step of COUPANG_ISSUANCE_TUTORIAL.slice(0, at("vendor_method"))) {
      const text = `${step.title} ${step.hint}`;
      // An earlier step may NAME 자체개발 only to say the screen has none — never to ask for it.
      if (/자체개발/.test(text)) expect(text).toMatch(/자체개발.*없습니다/);
    }
    // …and the purpose step says so out loud, because a seller who has read the old wording will look.
    const purpose = COUPANG_ISSUANCE_TUTORIAL[at("confirm_purpose")]!;
    expect(purpose.hint).toMatch(/OPEN API/);
    expect(purpose.hint).toMatch(/자체개발.*없습니다/);
  });

  it("names 자체개발(직접입력) with its measured label, on the 업체 입력 방식 screen", () => {
    const step = COUPANG_ISSUANCE_TUTORIAL[at("vendor_method")]!;
    expect(`${step.title} ${step.hint}`).toMatch(/자체개발\(직접입력\)/);
    expect(step.hint).toMatch(/업체 입력 방식/);
  });

  it("does not claim 발급 or '약관 동의 및 Key 발급받기' creates the key — both were refuted live", () => {
    for (const id of ["reveal_form", "terms_issue_button"]) {
      const step = COUPANG_ISSUANCE_TUTORIAL[at(id)]!;
      expect(step.hint).toMatch(/키[가를].*(만들지 않|발급되지 않)/);
    }
  });

  it("puts the key-creating 확인 after the vendor fields and before copying anything", () => {
    expect(at("issue_checkpoint")).toBeGreaterThan(at("register_call_ip"));
    expect(at("issue_checkpoint")).toBeLessThan(at("copy_keys"));
    const step = COUPANG_ISSUANCE_TUTORIAL[at("issue_checkpoint")]!;
    expect(`${step.title} ${step.hint}`).toMatch(/발급됩니다|발급되어/); // the one place that claims it
    expect(step.hint).toMatch(/reviewnary는 대신 누르지 않습니다/); // …and never on the seller's behalf
  });

  it("registers the call IP on the screen that actually has the field, and requires the '추가' press", () => {
    expect(at("register_call_ip")).toBeGreaterThan(at("vendor_method"));
    const step = COUPANG_ISSUANCE_TUTORIAL[at("register_call_ip")]!;
    expect(step.hint).toMatch(/추가/); // without it the IP is never registered
    expect(step.hint).toMatch(/표시된 IP가 없으면|담당자에게 문의/); // fail-safe, never a fabricated IP
    expect(step.opensCenter).not.toBe(true);
  });

  it("every step carries an actionable hint", () => {
    for (const s of COUPANG_ISSUANCE_TUTORIAL) expect(s.hint.length).toBeGreaterThan(0);
  });
});
