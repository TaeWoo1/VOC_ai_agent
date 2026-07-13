// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { OperationRunTimeline } from "./OperationRunTimeline";
import { resolveCopy, stepStatusView, SECTION_TITLE } from "../../lib/actionWindow/copy";
import { UI_SCENARIOS } from "../../lib/actionWindow/fixtures";

// A mid-flight run: step 3 is current (AWAITING_USER), steps 1–2 done, step 4 upcoming.
const run = UI_SCENARIOS["human-action-required"].run!;
const step = run.currentStep!;

describe("FE-11 OperationRunTimeline (DOM/a11y)", () => {
  it("renders the labelled 진행 단계 region with one list item per step", () => {
    render(<OperationRunTimeline run={run} />);
    expect(
      screen.getByRole("region", { name: SECTION_TITLE.timeline }),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: SECTION_TITLE.timeline }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("listitem")).toHaveLength(run.progress.totalSteps);
  });

  it("shows the completed / total progress count", () => {
    render(<OperationRunTimeline run={run} />);
    expect(screen.getByRole("region", { name: SECTION_TITLE.timeline })).toHaveTextContent(
      `${run.progress.completedSteps} / ${run.progress.totalSteps}`,
    );
  });

  it("marks the current step with aria-current and its FE-owned step copy", () => {
    render(<OperationRunTimeline run={run} />);
    const current = screen
      .getAllByRole("listitem")
      .find((li) => li.getAttribute("aria-current") === "step");
    expect(current).toBeDefined();
    expect(current!).toHaveTextContent(resolveCopy(step.copyKey, step.copyParams));
    expect(current!).toHaveTextContent("진행 중");
  });

  it("labels done steps 완료 and renders upcoming steps with a generic number label", () => {
    render(<OperationRunTimeline run={run} />);
    // Done state label appears once per completed step (current step is not "done").
    expect(screen.getAllByText("완료")).toHaveLength(run.progress.completedSteps);
    // Step 4 is upcoming: generic "N단계" label + "예정" state.
    expect(screen.getByText(`${run.progress.totalSteps}단계`)).toBeInTheDocument();
    expect(screen.getByText("예정")).toBeInTheDocument();
  });

  it("shows the current step's status in the footer", () => {
    render(<OperationRunTimeline run={run} />);
    expect(screen.getByRole("region", { name: SECTION_TITLE.timeline })).toHaveTextContent(
      `현재 단계 상태: ${stepStatusView(step.status).label}`,
    );
  });
});
