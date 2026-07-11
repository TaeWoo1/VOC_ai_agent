// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ActionWindowControlPanel } from "./ActionWindowControlPanel";
import { UI_SCENARIOS } from "../../lib/actionWindow/fixtures";
import { commandLabel } from "../../lib/actionWindow/copy";

/** FE-6: the control panel renders one button per `allowedCommands` (Runtime is the
 *  sole authority). These tests assert the rendered buttons match the fixture's
 *  allowedCommands and that a click dispatches the exact CommandType. */
describe("FE-6 ActionWindowControlPanel (DOM/a11y)", () => {
  it("has the labelled 가능한 동작 section", () => {
    const run = UI_SCENARIOS["human-action-required"].run!;
    render(<ActionWindowControlPanel run={run} onCommand={() => {}} />);
    expect(screen.getByRole("region", { name: "가능한 동작" })).toBeInTheDocument();
  });

  it("renders exactly one button per allowedCommand, each with the FE command label", () => {
    const run = UI_SCENARIOS["human-action-required"].run!;
    render(<ActionWindowControlPanel run={run} onCommand={() => {}} />);
    const buttons = screen.getAllByRole("button");
    expect(buttons).toHaveLength(run.allowedCommands.length);
    for (const type of run.allowedCommands) {
      // aria-label is the same FE label as the visible text — assert the accessible name.
      expect(screen.getByRole("button", { name: commandLabel(type) })).toBeInTheDocument();
    }
  });

  it("shows the empty-state copy and no buttons when no command is allowed", () => {
    const run = UI_SCENARIOS["completed"].run!; // allowedCommands: []
    render(<ActionWindowControlPanel run={run} onCommand={() => {}} />);
    expect(screen.queryByRole("button")).toBeNull();
    expect(screen.getByText("지금은 할 수 있는 동작이 없어요.")).toBeInTheDocument();
  });

  it("clicking a command button dispatches that exact CommandType", async () => {
    const run = UI_SCENARIOS["human-action-required"].run!; // includes REQUEST_STEP_RECHECK
    const onCommand = vi.fn();
    render(<ActionWindowControlPanel run={run} onCommand={onCommand} />);
    await userEvent.click(screen.getByRole("button", { name: commandLabel("REQUEST_STEP_RECHECK") }));
    expect(onCommand).toHaveBeenCalledTimes(1);
    expect(onCommand).toHaveBeenCalledWith("REQUEST_STEP_RECHECK");
  });
});
