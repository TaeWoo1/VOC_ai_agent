// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { HumanCheckpointCard } from "./HumanCheckpointCard";
import { UI_SCENARIOS } from "../../lib/actionWindow/fixtures";
import { blockerView, commandLabel } from "../../lib/actionWindow/copy";

// NOTE: the action buttons live in a `hidden sm:flex` container. jsdom does not
// apply Tailwind's stylesheet, so there is no computed `display:none` — the buttons
// are in the accessibility tree and queryable. We assert DOM presence only, never
// visual (responsive) visibility, which jsdom cannot represent.
describe("FE-6 HumanCheckpointCard (DOM/a11y)", () => {
  it("has the labelled 확인이 필요한 작업 section and heading", () => {
    const run = UI_SCENARIOS["human-action-required"].run!;
    render(<HumanCheckpointCard run={run} onCommand={() => {}} />);
    expect(screen.getByRole("region", { name: "확인이 필요한 작업" })).toBeInTheDocument();
    expect(screen.getByRole("heading", { name: "지금 해주실 일이 있어요" })).toBeInTheDocument();
  });

  it("renders the recheck + manual buttons when both are allowed; no blocker region", () => {
    const run = UI_SCENARIOS["human-action-required"].run!; // recheck + manual allowed, no blocker
    render(<HumanCheckpointCard run={run} onCommand={() => {}} />);
    expect(
      screen.getByRole("button", { name: commandLabel("REQUEST_STEP_RECHECK") }),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: commandLabel("SWITCH_TO_MANUAL") })).toBeInTheDocument();
    expect(screen.queryByRole("status")).toBeNull(); // no blocker → no status region
  });

  it("dispatches the matching CommandType for each button", async () => {
    const run = UI_SCENARIOS["human-action-required"].run!;
    const onCommand = vi.fn();
    render(<HumanCheckpointCard run={run} onCommand={onCommand} />);
    await userEvent.click(screen.getByRole("button", { name: commandLabel("REQUEST_STEP_RECHECK") }));
    await userEvent.click(screen.getByRole("button", { name: commandLabel("SWITCH_TO_MANUAL") }));
    expect(onCommand).toHaveBeenNthCalledWith(1, "REQUEST_STEP_RECHECK");
    expect(onCommand).toHaveBeenNthCalledWith(2, "SWITCH_TO_MANUAL");
  });

  it("a recoverable blocker renders a status region with the FE blocker copy", () => {
    const run = UI_SCENARIOS["ui-drift"].run!; // blocker UI_DRIFT, recoverable
    render(<HumanCheckpointCard run={run} onCommand={() => {}} />);
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent(blockerView("UI_DRIFT").title);
    expect(status).toHaveTextContent("다시 시도할 수 있어요");
  });

  it("a non-recoverable blocker shows the non-recoverable copy and gates the action buttons", () => {
    const run = UI_SCENARIOS["failed"].run!; // blocker ARTIFACT_INVALID, not recoverable, only CANCEL_RUN
    render(<HumanCheckpointCard run={run} onCommand={() => {}} />);
    expect(screen.getByRole("status")).toHaveTextContent("복구할 수 없어요");
    // recheck/manual are not in allowedCommands → the card renders no action button.
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("only renders the buttons named in allowedCommands (recheck yes, manual no)", () => {
    const run = UI_SCENARIOS["login-required"].run!; // allowedCommands: recheck + cancel (no manual)
    render(<HumanCheckpointCard run={run} onCommand={() => {}} />);
    expect(
      screen.getByRole("button", { name: commandLabel("REQUEST_STEP_RECHECK") }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: commandLabel("SWITCH_TO_MANUAL") })).toBeNull();
  });
});
