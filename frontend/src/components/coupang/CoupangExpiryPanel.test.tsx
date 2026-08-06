// @vitest-environment jsdom
// The credential-expiry block on the Coupang completion screen: it shows the expiry date + state, offers an
// operator-confirmation date input when the state is UNKNOWN (never auto-estimated), and surfaces the guided
// renewal CTA from WARN_14 onward. Offline + controlled (no api, no router).
import { describe, it, expect, vi } from "vitest";
import { render, screen, fireEvent } from "@testing-library/react";
import { expectNoAxeViolations } from "../../test/axe";
import { CoupangExpiryPanel } from "./CoupangExpiryPanel";
import type { CoupangExpiryStatusView } from "../../lib/types";

function expiry(over: Partial<CoupangExpiryStatusView>): CoupangExpiryStatusView {
  return {
    expiresAt: null,
    daysRemaining: null,
    state: "OK",
    authFailing: false,
    renewRecommended: false,
    ...over,
  };
}

describe("CoupangExpiryPanel", () => {
  it("shows the expiry date + day-count when the state is known", () => {
    render(
      <CoupangExpiryPanel
        expiry={expiry({ state: "OK", expiresAt: "2026-12-31T23:59:59Z", daysRemaining: 40 })}
      />,
    );
    expect(screen.getByText(/만료일 2026-12-31/)).toBeInTheDocument();
    expect(screen.getByText(/약 40일 남았어요/)).toBeInTheDocument();
    expect(screen.getByTestId("coupang-expiry-chip")).toHaveTextContent("정상");
    // No renewal CTA below WARN_14.
    expect(screen.queryByRole("button", { name: "WING에서 API 키 갱신하기" })).toBeNull();
    // No operator-confirm input when the date is known.
    expect(screen.queryByTestId("coupang-expiry-confirm")).toBeNull();
  });

  it("UNKNOWN → an operator-confirmation date input that stores the exact date (never estimated)", () => {
    const onConfirmExpiry = vi.fn();
    render(<CoupangExpiryPanel expiry={expiry({ state: "UNKNOWN" })} onConfirmExpiry={onConfirmExpiry} />);
    expect(screen.getByTestId("coupang-expiry-confirm")).toBeInTheDocument();
    const input = screen.getByLabelText("만료일을 확인해 입력") as HTMLInputElement;
    fireEvent.change(input, { target: { value: "2026-12-31" } });
    fireEvent.click(screen.getByRole("button", { name: "만료일 저장" }));
    expect(onConfirmExpiry).toHaveBeenCalledTimes(1);
    expect(onConfirmExpiry.mock.calls[0][0]).toMatch(/^2026-12-31T/);
  });

  it("the confirm button is disabled until a date is entered", () => {
    render(<CoupangExpiryPanel expiry={expiry({ state: "UNKNOWN" })} onConfirmExpiry={vi.fn()} />);
    expect(screen.getByRole("button", { name: "만료일 저장" })).toBeDisabled();
  });

  it("surfaces the renewal CTA from WARN_14 (renewRecommended)", () => {
    const onRenew = vi.fn();
    render(<CoupangExpiryPanel expiry={expiry({ state: "WARN_14", renewRecommended: true })} onRenew={onRenew} />);
    const cta = screen.getByRole("button", { name: "WING에서 API 키 갱신하기" });
    fireEvent.click(cta);
    expect(onRenew).toHaveBeenCalledTimes(1);
  });

  it("does NOT surface the renewal CTA at WARN_30 (before renewRecommended)", () => {
    render(<CoupangExpiryPanel expiry={expiry({ state: "WARN_30", renewRecommended: false })} onRenew={vi.fn()} />);
    expect(screen.queryByRole("button", { name: "WING에서 API 키 갱신하기" })).toBeNull();
  });

  it("has no accessibility violations (UNKNOWN operator-confirm state)", async () => {
    const { container } = render(
      <CoupangExpiryPanel expiry={expiry({ state: "UNKNOWN" })} onConfirmExpiry={vi.fn()} />,
    );
    await expectNoAxeViolations(container);
  });

  it("has no accessibility violations (WARN_14 renewal state)", async () => {
    const { container } = render(
      <CoupangExpiryPanel
        expiry={expiry({ state: "WARN_14", renewRecommended: true, expiresAt: "2026-08-20T00:00:00Z", daysRemaining: 13 })}
        onRenew={vi.fn()}
      />,
    );
    await expectNoAxeViolations(container);
  });
});
