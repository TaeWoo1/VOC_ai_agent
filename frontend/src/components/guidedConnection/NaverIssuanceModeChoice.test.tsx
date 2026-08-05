// @vitest-environment jsdom
// The issuance mode fork: guided (Action Window) dispatches into the guided phase; text reveals the existing
// static checklist IN PLACE (a component-local toggle, NOT a reducer event, so today's text flow is unchanged).
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import { expectNoAxeViolations } from "../../test/axe";
import { NaverIssuanceModeChoice } from "./NaverIssuanceModeChoice";

afterEach(() => vi.restoreAllMocks());

describe("NaverIssuanceModeChoice", () => {
  it("guided choice dispatches APPLICATION_ISSUANCE_MODE{mode:'guided'} (the Action Window)", async () => {
    const dispatch = vi.fn();
    render(<NaverIssuanceModeChoice dispatch={dispatch} />);
    await userEvent.click(screen.getByRole("button", { name: "화면을 보며 안내받기" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "APPLICATION_ISSUANCE_MODE", mode: "guided" });
  });

  it("text choice reveals the static checklist IN PLACE and dispatches NO reducer event", async () => {
    const dispatch = vi.fn();
    render(<NaverIssuanceModeChoice dispatch={dispatch} />);
    // Before: the checklist is not shown.
    expect(screen.queryByRole("checkbox")).toBeNull();
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    // After: the checklist renders, unchanged behavior; still no reducer event dispatched by the toggle.
    expect(screen.getAllByRole("checkbox").length).toBeGreaterThanOrEqual(3);
    expect(dispatch).not.toHaveBeenCalled();
  });

  it("the text checklist's completion dispatches ISSUANCE_COMPLETE (unchanged text hand-off)", async () => {
    const dispatch = vi.fn();
    render(<NaverIssuanceModeChoice dispatch={dispatch} />);
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    await userEvent.click(screen.getByRole("button", { name: "발급을 완료했어요" }));
    expect(dispatch).toHaveBeenCalledWith({ type: "ISSUANCE_COMPLETE" });
  });

  it("can return from the text checklist back to the mode fork", async () => {
    render(<NaverIssuanceModeChoice dispatch={vi.fn()} />);
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    await userEvent.click(screen.getByRole("button", { name: "화면 안내로 다시 보기" }));
    expect(screen.getByRole("button", { name: "화면을 보며 안내받기" })).toBeInTheDocument();
  });

  it("has no accessibility violations (fork and text views)", async () => {
    const { container } = render(<NaverIssuanceModeChoice dispatch={vi.fn()} />);
    await expectNoAxeViolations(container);
    await userEvent.click(screen.getByRole("button", { name: "텍스트로 직접 진행하기" }));
    await expectNoAxeViolations(container);
  });
});
