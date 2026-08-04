// @vitest-environment jsdom
// The existing-app guided offer: an ADDITIVE choice above the credential form. Guided dispatches into the
// shared Action Window walkthrough; text simply dismisses the offer (no reducer event — text is already the
// rendered default). It never carries a credential value or an account id.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import { expectNoAxeViolations } from "../../test/axe";
import { ExistingAppGuidanceOffer } from "./ExistingAppGuidanceOffer";

afterEach(() => vi.restoreAllMocks());

describe("ExistingAppGuidanceOffer", () => {
  it("guided choice dispatches APPLICATION_ISSUANCE_MODE{mode:'guided'} (the shared walkthrough)", async () => {
    const dispatch = vi.fn();
    render(<ExistingAppGuidanceOffer dispatch={dispatch} />);
    await userEvent.click(screen.getByRole("button", { name: "화면을 보며 확인" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
  });

  it("text choice dismisses the offer and dispatches NO reducer event (text is already the default)", async () => {
    const dispatch = vi.fn();
    render(<ExistingAppGuidanceOffer dispatch={dispatch} />);
    expect(screen.getByRole("button", { name: "화면을 보며 확인" })).toBeInTheDocument();
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 확인" }));
    // The whole offer is gone; the form below (rendered by the wizard) stands alone.
    expect(screen.queryByRole("button", { name: "화면을 보며 확인" })).toBeNull();
    expect(screen.queryByRole("button", { name: "텍스트로 직접 확인" })).toBeNull();
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("both actions are disabled while busy", () => {
    render(<ExistingAppGuidanceOffer dispatch={vi.fn()} busy />);
    expect(screen.getByRole("button", { name: "화면을 보며 확인" })).toBeDisabled();
    expect(screen.getByRole("button", { name: "텍스트로 직접 확인" })).toBeDisabled();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<ExistingAppGuidanceOffer dispatch={vi.fn()} />);
    await expectNoAxeViolations(container);
  });
});
