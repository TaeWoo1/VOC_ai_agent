// @vitest-environment jsdom
// The guided-renewal flow: guided walkthrough → masked REPLACE form (+ operator-confirm expiry) → the
// backend atomic replace → done. Secrets flow straight from the form to onReplace (never a reducer/event).
// A failure keeps the old credential (backend rollback) and lets the operator retry. Offline: the
// walkthrough is driven by a controlled `run` prop; the bridge is mocked inert.
import { describe, it, expect, vi, beforeEach, afterEach } from "vitest";
import { render, act } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import { expectNoAxeViolations } from "../../test/axe";
import type { BridgeState } from "../../lib/bridge/bridgeClient";
import type { ActionWindowRunView } from "../../lib/actionWindow/contract";
import type { CredentialTemplateView } from "../../lib/types";

vi.mock("../../hooks/useBridge", () => ({
  useBridge: () => ({
    state: { phase: "paired", maybeNeedsLocalNetworkAccess: false } as BridgeState,
    requestPairing: vi.fn(),
    revoke: vi.fn(),
    retry: vi.fn(),
  }),
}));

import { CoupangRenewalFlow } from "./CoupangRenewalFlow";

const TEMPLATE: CredentialTemplateView = {
  channelCode: "COUPANG",
  connectorClass: "API",
  authType: "HMAC",
  fields: [
    { key: "access_key", label: "액세스 키", required: true, secret: false, helpText: "" },
    { key: "secret_key", label: "시크릿 키", required: true, secret: true, helpText: "" },
    { key: "vendor_id", label: "업체 코드", required: true, secret: false, helpText: "" },
  ],
  notes: "",
};

const completedRun: ActionWindowRunView = {
  protocolVersion: 1,
  runId: "run_x",
  revision: 1,
  channelCode: "coupang",
  runCopyKey: "actionWindow.coupangRenewal.run",
  status: "COMPLETED",
  executionMode: "ACTION_WINDOW",
  currentStep: undefined,
  guidanceEnabled: true,
  allowedCommands: [],
  progress: { completedSteps: 6, totalSteps: 6 },
  updatedAt: "2026-01-01T00:00:00Z",
};

async function fillCredentials() {
  await userEvent.type(screen.getByLabelText("액세스 키"), "AK-new");
  await userEvent.type(screen.getByLabelText("시크릿 키"), "SK-new");
  await userEvent.type(screen.getByLabelText("업체 코드"), "A00099999");
}

beforeEach(() => vi.clearAllMocks());
afterEach(() => vi.restoreAllMocks());

describe("CoupangRenewalFlow", () => {
  it("guide → replace: completing the walkthrough reveals the masked REPLACE form", async () => {
    render(
      <CoupangRenewalFlow
        template={TEMPLATE}
        onReplace={vi.fn()}
        onDone={vi.fn()}
        walkthroughSeam={{ run: completedRun, onCommand: vi.fn() }}
      />,
    );
    expect(screen.getByTestId("coupang-renewal")).toHaveAttribute("data-phase", "guide");
    await userEvent.click(screen.getByRole("button", { name: "SellerOps로 돌아가 새 키 입력하기" }));
    expect(screen.getByTestId("coupang-renewal")).toHaveAttribute("data-phase", "replace");
    expect(screen.getByRole("heading", { name: "새 키로 교체" })).toBeInTheDocument();
  });

  it("replace success → done: secrets + confirmed expiry flow to onReplace; account/orders kept", async () => {
    const onReplace = vi.fn(async (_s: Record<string, string>, _t: string | undefined) => ({
      status: "SUCCESS" as const,
      reasonCode: null,
    }));
    const onDone = vi.fn();
    render(
      <CoupangRenewalFlow
        template={TEMPLATE}
        onReplace={onReplace}
        onDone={onDone}
        walkthroughSeam={{ run: completedRun }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "SellerOps로 돌아가 새 키 입력하기" }));

    // Operator-confirm the new key's expiry date.
    const dateInput = screen.getByLabelText("만료일을 확인해 입력") as HTMLInputElement;
    await userEvent.clear(dateInput);
    await userEvent.type(dateInput, "2027-06-30");

    await fillCredentials();
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "연결 정보 저장" }));
    });

    expect(onReplace).toHaveBeenCalledTimes(1);
    const [secrets, tokenExpiresAt] = onReplace.mock.calls[0];
    expect(secrets).toEqual({ access_key: "AK-new", secret_key: "SK-new", vendor_id: "A00099999" });
    expect(tokenExpiresAt).toMatch(/^2027-06-30T/);

    expect(screen.getByTestId("coupang-renewal")).toHaveAttribute("data-phase", "done");
    expect(screen.getByText("키 교체가 완료됐어요")).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "연결 상태 보기" }));
    expect(onDone).toHaveBeenCalledTimes(1);
  });

  it("replace failure → a safe reason banner, old credential kept, and a retry path", async () => {
    const onReplace = vi.fn(async (_s: Record<string, string>, _t: string | undefined) => ({
      status: "FAILED" as const,
      reasonCode: "INVALID_CREDENTIAL",
    }));
    render(
      <CoupangRenewalFlow
        template={TEMPLATE}
        onReplace={onReplace}
        onDone={vi.fn()}
        walkthroughSeam={{ run: completedRun }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "SellerOps로 돌아가 새 키 입력하기" }));
    await fillCredentials();
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "연결 정보 저장" }));
    });
    expect(screen.getByTestId("coupang-renewal")).toHaveAttribute("data-phase", "replace_error");
    expect(screen.getByTestId("coupang-renewal-error")).toBeInTheDocument();
    // Reuses the connection-test recovery copy for the reason code (never a raw provider body).
    expect(screen.getByText("연결 정보가 올바르지 않아요")).toBeInTheDocument();
    // The form is still available to retry.
    expect(screen.getByRole("button", { name: "연결 정보 저장" })).toBeInTheDocument();
  });

  it("omits tokenExpiresAt when the operator leaves the expiry blank (never estimated)", async () => {
    const onReplace = vi.fn(async (_s: Record<string, string>, _t: string | undefined) => ({
      status: "SUCCESS" as const,
      reasonCode: null,
    }));
    render(
      <CoupangRenewalFlow
        template={TEMPLATE}
        onReplace={onReplace}
        onDone={vi.fn()}
        walkthroughSeam={{ run: completedRun }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "SellerOps로 돌아가 새 키 입력하기" }));
    await fillCredentials();
    await act(async () => {
      await userEvent.click(screen.getByRole("button", { name: "연결 정보 저장" }));
    });
    expect(onReplace.mock.calls[0][1]).toBeUndefined();
  });

  it("has no accessibility violations (replace form state)", async () => {
    const { container } = render(
      <CoupangRenewalFlow
        template={TEMPLATE}
        onReplace={vi.fn()}
        onDone={vi.fn()}
        walkthroughSeam={{ run: completedRun }}
      />,
    );
    await userEvent.click(screen.getByRole("button", { name: "SellerOps로 돌아가 새 키 입력하기" }));
    await expectNoAxeViolations(container);
  });
});
