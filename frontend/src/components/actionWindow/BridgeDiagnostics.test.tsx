// @vitest-environment jsdom
import { describe, it, expect, beforeEach, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { BridgeDiagnostics } from "./BridgeDiagnostics";
import {
  getOperationsState,
  loadRunScenario,
  resetOperationsStateForTests,
  type OperationsState,
} from "../../lib/actionWindow/operationsStore";

// The panel reads the env helper `isBridgeModeEnabled` at render — mock just that so
// the verdict is deterministic without a real DEV/bridge environment. `부트 시도됨` now
// comes from REACTIVE store state (`state.bootAttempted`), so it is set via the state
// prop below, not a module mock. The verdict LOGIC + privacy leak-guard stay covered by
// the node-env `diagnostics.test.ts`; these tests assert the rendered DOM/aria only.
const { mockBridgeModeEnabled } = vi.hoisted(() => ({
  mockBridgeModeEnabled: vi.fn(() => false),
}));
vi.mock("../../lib/actionWindow/devMode", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../lib/actionWindow/devMode")>()),
  isBridgeModeEnabled: mockBridgeModeEnabled,
}));

/** A valid OperationsState with a bound run (revision 4, channel esm_plus), built
 *  through the real store the same way the pages do — then optionally overridden. */
function bridgeState(overrides: Partial<OperationsState> = {}): OperationsState {
  resetOperationsStateForTests();
  loadRunScenario("human-action-required");
  return { ...getOperationsState(), ...overrides };
}

function fieldValue(label: string): HTMLElement {
  const dt = screen.getByText(label);
  expect(dt.tagName).toBe("DT");
  const dd = dt.nextElementSibling as HTMLElement | null;
  if (!dd) throw new Error(`no <dd> sibling for ${label}`);
  return dd;
}

describe("FE-6 BridgeDiagnostics (DOM/a11y)", () => {
  beforeEach(() => {
    mockBridgeModeEnabled.mockReturnValue(false);
  });

  it("renders a labelled diagnostics section with a definition list of 11 fields", () => {
    mockBridgeModeEnabled.mockReturnValue(true);
    const { container } = render(<BridgeDiagnostics state={bridgeState({ sourceMode: "bridge" })} />);
    expect(screen.getByRole("region", { name: "브리지 진단 (개발용)" })).toBeInTheDocument();
    expect(container.querySelectorAll("dl dt")).toHaveLength(11);
    expect(container.querySelectorAll("dl dd")).toHaveLength(11);
  });

  it("verdict LIVE: bridge mode on + bridge source shows the live label and 소스 모드 = bridge", () => {
    mockBridgeModeEnabled.mockReturnValue(true);
    render(<BridgeDiagnostics state={bridgeState({ sourceMode: "bridge" })} />);
    expect(screen.getByText("라이브 브리지 사용 중")).toBeInTheDocument();
    expect(fieldValue("소스 모드")).toHaveTextContent("bridge");
  });

  it("verdict FIXTURE FALLBACK: bridge mode on but fixture source", () => {
    mockBridgeModeEnabled.mockReturnValue(true);
    render(<BridgeDiagnostics state={bridgeState({ sourceMode: "fixture" })} />);
    expect(screen.getByText("픽스처로 폴백됨")).toBeInTheDocument();
    expect(fieldValue("소스 모드")).toHaveTextContent("fixture");
  });

  it("renders 부트 시도됨 from REACTIVE store state (예 on the fixture-fallback path)", () => {
    mockBridgeModeEnabled.mockReturnValue(true);
    render(<BridgeDiagnostics state={bridgeState({ sourceMode: "fixture", bootAttempted: true })} />);
    expect(screen.getByText("픽스처로 폴백됨")).toBeInTheDocument();
    expect(fieldValue("부트 시도됨")).toHaveTextContent("예");
  });

  it("verdict FIXTURE DEMO: bridge mode off", () => {
    mockBridgeModeEnabled.mockReturnValue(false);
    render(<BridgeDiagnostics state={bridgeState({ sourceMode: "bridge" })} />);
    expect(screen.getByText("픽스처 데모 (브리지 꺼짐)")).toBeInTheDocument();
    expect(fieldValue("브리지 모드")).toHaveTextContent("아니오");
  });

  it("shows the channel DISPLAY LABEL in the DOM, never the raw channel code", () => {
    mockBridgeModeEnabled.mockReturnValue(true);
    const { container } = render(
      <BridgeDiagnostics state={bridgeState({ sourceMode: "bridge" })} />,
    );
    expect(fieldValue("채널")).toHaveTextContent("ESM (지마켓·옥션)");
    expect(fieldValue("리비전")).toHaveTextContent("4");
    // the raw code must not appear anywhere in the rendered panel
    expect(container.textContent ?? "").not.toContain("esm_plus");
  });
});
