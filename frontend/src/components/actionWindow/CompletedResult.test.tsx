// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { CompletedResult } from "./CompletedResult";
import { channelLabel } from "../../lib/actionWindow/copy";
import { UI_SCENARIOS } from "../../lib/actionWindow/fixtures";

// The completed fixture is a contract-valid COMPLETED run (channel esm_plus, 4/4 steps).
const run = UI_SCENARIOS["completed"].run!;

describe("FE-11 CompletedResult (DOM/a11y)", () => {
  it("renders the labelled 완료 결과 region with the completion heading", () => {
    render(<CompletedResult run={run} />);
    expect(screen.getByRole("region", { name: "완료 결과" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "리뷰 내려받기를 마쳤어요" }),
    ).toBeInTheDocument();
  });

  it("shows the channel label and completed/total step counts", () => {
    render(<CompletedResult run={run} />);
    const region = screen.getByRole("region", { name: "완료 결과" });
    expect(region).toHaveTextContent(channelLabel(run.channelCode));
    expect(region).toHaveTextContent(
      `${run.progress.completedSteps} / ${run.progress.totalSteps}`,
    );
  });

  it("marks the ✓ result glyph decorative (aria-hidden)", () => {
    render(<CompletedResult run={run} />);
    expect(screen.getByText("✓")).toHaveAttribute("aria-hidden", "true");
  });
});
