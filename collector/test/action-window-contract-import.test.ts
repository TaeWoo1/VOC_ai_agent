import { describe, it, expect } from "vitest";
import {
  PROTOCOL_VERSION,
  validateRunView,
  parseCommand,
  parseEvent,
  isSanitized,
  ACTION_WINDOW_SCENARIOS,
  SCENARIO_NAMES,
} from "../../contracts/action-window/v1/index";

// Proves the collector consumes the exact same contract source as the frontend,
// with no locally-redefined protocol types.
describe("collector consumes the shared Action Window contract", () => {
  it("imports the shared protocol version and validates a shared fixture", () => {
    expect(PROTOCOL_VERSION).toBe("1.0.0");
    const view = ACTION_WINDOW_SCENARIOS["human-action-required"];
    expect(validateRunView(view).ok).toBe(true);
    expect(isSanitized(view)).toBe(true);
  });

  it("exposes the same parsers the frontend uses", () => {
    expect(typeof parseCommand).toBe("function");
    expect(typeof parseEvent).toBe("function");
    expect(SCENARIO_NAMES).toHaveLength(12);
  });
});
