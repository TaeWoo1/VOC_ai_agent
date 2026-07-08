import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  validateRunView,
  isSanitized,
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
});
