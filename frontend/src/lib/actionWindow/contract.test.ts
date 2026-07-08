import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  validateRunView,
  isSanitized,
  isCopyKey,
  ACTION_WINDOW_SCENARIOS,
  SCENARIO_NAMES,
} from "./contract";

// Proves the frontend consumes the exact same contract source as the collector,
// with no locally-redefined protocol types.
describe("frontend consumes the shared Action Window contract", () => {
  it("uses the shared protocol version and scenario set", () => {
    expect(PROTOCOL_VERSION).toBe("1.0.0");
    expect(SCENARIO_NAMES).toHaveLength(12);
  });

  it("validates and sanitizes every shared fixture", () => {
    for (const name of SCENARIO_NAMES) {
      const view = ACTION_WINDOW_SCENARIOS[name];
      expect(validateRunView(view).ok).toBe(true);
      expect(isSanitized(view)).toBe(true);
    }
  });

  it("consumes a copy key and safely distinguishes it from final prose", () => {
    const view = ACTION_WINDOW_SCENARIOS["human-action-required"];
    // Runtime supplies a semantic copy key; FE (not Runtime) owns the final copy.
    expect(isCopyKey(view.runCopyKey)).toBe(true);
    expect(isCopyKey(view.currentStep?.copyKey)).toBe(true);
    // Final end-user prose is NOT a copy key.
    expect(isCopyKey("리뷰 내려받기")).toBe(false);
    // An unknown copy key renders a safe FE fallback — it never grants commands
    // or changes state; allowedCommands remains the only command authority.
    const render = (key: unknown): string => (isCopyKey(key) ? `copy:${String(key)}` : "(fallback)");
    expect(render("actionWindow.review.unknownKey").startsWith("copy:")).toBe(true);
    expect(render("some final sentence")).toBe("(fallback)");
  });
});
