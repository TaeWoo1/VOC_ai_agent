import { describe, it, expect } from "vitest";
import { describeBridgeDiagnostics, type BridgeDiagnosticsInput } from "./diagnostics";
import { channelLabel } from "./copy";
import { UI_SCENARIOS } from "./fixtures";

/** A connected live-bridge session with a bound run, built the SAME way the
 *  `BridgeDiagnostics` component builds it (channel *label*, plain revision,
 *  boolean run-bound) — never the raw view. */
function liveInput(overrides: Partial<BridgeDiagnosticsInput> = {}): BridgeDiagnosticsInput {
  const run = UI_SCENARIOS["human-action-required"].run!; // channelCode esm_plus, runId run_demo_esm
  return {
    sourceMode: "bridge",
    connection: "connected",
    bridgeModeEnabled: true,
    bootAttempted: true,
    retryPending: false,
    connectionTrail: ["connected"],
    connectionChangeCount: 0,
    revision: run.revision,
    channelLabel: channelLabel(run.channelCode),
    runBound: true,
    ...overrides,
  };
}

function fieldValue(view: ReturnType<typeof describeBridgeDiagnostics>, label: string): string {
  const field = view.fields.find((f) => f.label === label);
  if (!field) throw new Error(`missing diagnostics field: ${label}`);
  return field.value;
}

describe("FE-5 bridge diagnostics formatter", () => {
  it("verdict is LIVE when bridge mode is on and the source is the bridge", () => {
    const view = describeBridgeDiagnostics(liveInput());
    expect(view.verdict).toBe("live");
    expect(view.verdictLabel.length).toBeGreaterThan(0);
  });

  it("verdict is FIXTURE FALLBACK when bridge mode is on but the source is the fixture", () => {
    const view = describeBridgeDiagnostics(liveInput({ sourceMode: "fixture" }));
    expect(view.verdict).toBe("fixture-fallback");
  });

  it("verdict is FIXTURE DEMO when bridge mode is off (regardless of source mode)", () => {
    expect(describeBridgeDiagnostics(liveInput({ bridgeModeEnabled: false })).verdict).toBe(
      "fixture-demo",
    );
    expect(
      describeBridgeDiagnostics(liveInput({ bridgeModeEnabled: false, sourceMode: "bridge" }))
        .verdict,
    ).toBe("fixture-demo");
  });

  it("renders the sanitized field values (source mode, connection, booleans as 예/아니오)", () => {
    const view = describeBridgeDiagnostics(
      liveInput({ connection: "offline", bootAttempted: true, retryPending: true, runBound: true }),
    );
    expect(fieldValue(view, "소스 모드")).toBe("bridge");
    expect(fieldValue(view, "연결 상태")).toBe("offline");
    expect(fieldValue(view, "브리지 모드")).toBe("예");
    expect(fieldValue(view, "부트 시도됨")).toBe("예");
    expect(fieldValue(view, "재연결 대기")).toBe("예");
    expect(fieldValue(view, "실행 바인딩됨")).toBe("예");
  });

  it("last transition reads prev → current from the trail; the current state alone with no prior", () => {
    expect(fieldValue(describeBridgeDiagnostics(liveInput({ connectionTrail: ["connected"] })), "마지막 전이")).toBe(
      "connected",
    );
    expect(
      fieldValue(
        describeBridgeDiagnostics(
          liveInput({ connectionTrail: ["connected", "reconnecting", "offline"] }),
        ),
        "마지막 전이",
      ),
    ).toBe("reconnecting → offline");
  });

  it("change counter and revision render as plain integers; empty run fields render a dash", () => {
    const bound = describeBridgeDiagnostics(liveInput({ connectionChangeCount: 3, revision: 7 }));
    expect(fieldValue(bound, "연결 변경 횟수")).toBe("3");
    expect(fieldValue(bound, "리비전")).toBe("7");

    const unbound = describeBridgeDiagnostics(
      liveInput({ revision: null, channelLabel: null, runBound: false }),
    );
    expect(fieldValue(unbound, "리비전")).toBe("—");
    expect(fieldValue(unbound, "채널")).toBe("—");
    expect(fieldValue(unbound, "실행 바인딩됨")).toBe("아니오");
  });

  it("shows the channel DISPLAY LABEL, never the raw channel code", () => {
    const view = describeBridgeDiagnostics(liveInput());
    expect(fieldValue(view, "채널")).toBe("ESM (지마켓·옥션)");
    expect(fieldValue(view, "채널")).not.toBe("esm_plus");
  });

  it("leak-guard: no field value exposes a raw identifier, url, token, or wire frame", () => {
    // Feed a fully-populated live session derived from a run whose raw channelCode
    // is "esm_plus" and runId is "run_demo_esm" — the formatter must never surface
    // either, nor any transport/network/secret token, in ANY field.
    const view = describeBridgeDiagnostics(
      liveInput({
        connection: "offline",
        connectionTrail: ["connected", "reconnecting", "offline"],
        connectionChangeCount: 5,
      }),
    );
    const forbidden = [
      "run_demo", // raw runId
      "esm_plus", // raw channelCode
      "http", // urls / ws bases
      "ws://",
      "wss://",
      "127.0.0.1",
      "ticket",
      "token",
      "Bearer",
      "aw_", // wire frame kinds (aw_view / aw_command / ...)
      "/bridge/",
    ];
    const haystack = [view.verdictLabel, ...view.fields.map((f) => `${f.label}=${f.value}`)]
      .join("\n")
      .toLowerCase();
    for (const needle of forbidden) {
      expect(haystack).not.toContain(needle.toLowerCase());
    }
  });

  it("every field value is drawn from the bounded sanitized vocabulary", () => {
    // Across all verdicts and connection states, values stay within a known set —
    // proof the formatter cannot emit free-form/raw content.
    const allowed = new Set([
      "bridge",
      "fixture",
      "connected",
      "reconnecting",
      "offline",
      "예",
      "아니오",
      "—",
      "connected → reconnecting",
      "reconnecting → offline",
      "offline → connected",
      "ESM (지마켓·옥션)",
    ]);
    const cases: BridgeDiagnosticsInput[] = [
      liveInput(),
      liveInput({ sourceMode: "fixture", bridgeModeEnabled: false }),
      liveInput({ connection: "reconnecting", connectionTrail: ["connected", "reconnecting"] }),
      liveInput({ revision: null, channelLabel: null, runBound: false }),
    ];
    for (const input of cases) {
      const view = describeBridgeDiagnostics(input);
      for (const f of view.fields) {
        // Integers (change count / revision) are allowed too.
        if (/^\d+$/.test(f.value)) continue;
        expect(allowed.has(f.value)).toBe(true);
      }
    }
  });
});
