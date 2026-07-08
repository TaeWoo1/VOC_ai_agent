import { describe, it, expect } from "vitest";
import { findForbiddenFields, isSanitized, assertNoForbiddenFields } from "./privacy";
import { ACTION_WINDOW_SCENARIOS, SCENARIO_NAMES } from "./fixtures";

describe("privacy boundary", () => {
  it("rejects forbidden field names (structural)", () => {
    expect(findForbiddenFields({ cssSelector: ".x" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ xpath: "//a" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ frameUrl: "x" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ cookie: "x" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ token: "x" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ accountId: "x" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ filePath: "x" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ profileDir: "x" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ cdpTargetId: "x" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ nested: { innerHtml: "<b/>" } }).length).toBeGreaterThan(0);
  });

  it("allows opaque handles (runId/eventId/commandId/stepId)", () => {
    expect(isSanitized({ runId: "r", eventId: "e", commandId: "c", stepId: "s" })).toBe(true);
  });

  it("rejects URL / scheme / absolute-path string VALUES", () => {
    expect(findForbiddenFields({ title: "https://example.com/x" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ title: "file:///etc/passwd" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ note: "/Users/me/secret" }).length).toBeGreaterThan(0);
    expect(findForbiddenFields({ note: "C:\\Users\\me" }).length).toBeGreaterThan(0);
  });

  it("passes clean Korean copy", () => {
    expect(isSanitized({ title: "리뷰 내려받기 · ESM(지마켓)", message: "다시 로그인해 주세요." })).toBe(true);
  });

  it("assert throws on violation, passes when clean", () => {
    expect(() => assertNoForbiddenFields({ selector: "x" })).toThrow();
    expect(() => assertNoForbiddenFields({ runId: "x" })).not.toThrow();
  });

  it("every shared fixture is sanitized", () => {
    for (const name of SCENARIO_NAMES) {
      expect(isSanitized(ACTION_WINDOW_SCENARIOS[name])).toBe(true);
    }
  });
});
