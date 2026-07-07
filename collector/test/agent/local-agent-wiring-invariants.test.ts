import { describe, it, expect } from "vitest";
import { createLocalAgentConnectorStartup, parseConnectorConnections } from "../../src/agent/local-agent-connector-startup";

describe("loginMode provenance invariant", () => {
  it("loginMode comes from the descriptor, never from a capture marketplace", () => {
    // An (irrelevant) marketplace field is present; the descriptor's own loginMode must win unchanged.
    const raw = JSON.stringify([
      {
        connectionId: "c",
        channel: "ESM",
        loginMode: "ESM_PLUS",
        autoReconnectConsent: true,
        autoSubmitConsent: false,
        assistedReconnectConsent: true,
        marketplace: "GMARKET",
      },
    ]);
    const r = parseConnectorConnections(raw);
    expect(r.ok).toBe(true);
    if (r.ok) {
      expect(r.value.connections[0]!.browserConnection?.loginMode).toBe("ESM_PLUS"); // not derived from marketplace
    }
  });
});

describe("LocalAgentConnectorStartup.humanCompleted null-safety", () => {
  it("returns null when no browser service was realized (API/discovery-only or unbooted)", async () => {
    const startup = createLocalAgentConnectorStartup({}); // no browser runtime config
    expect(await startup.humanCompleted("A", "SELECT_SAVED_CREDENTIAL")).toBeNull();
  });
});
