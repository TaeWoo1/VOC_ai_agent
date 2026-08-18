// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { CompletedResult } from "./CompletedResult";
import { channelLabel } from "../../lib/actionWindow/copy";
import { UI_SCENARIOS } from "../../lib/actionWindow/fixtures";

// The completed fixture is a contract-valid COMPLETED run (channel esm_plus, 4/4 steps).
const run = UI_SCENARIOS["completed"].run!;

describe("FE-11 CompletedResult (DOM/a11y)", () => {
  it("renders the labelled 완료 결과 region with the completion heading", () => {
    render(<MemoryRouter><CompletedResult run={run} /></MemoryRouter>);
    expect(screen.getByRole("region", { name: "완료 결과" })).toBeInTheDocument();
    expect(
      screen.getByRole("heading", { name: "리뷰 내려받기를 마쳤어요" }),
    ).toBeInTheDocument();
  });

  it("shows the channel label and completed/total step counts", () => {
    render(<MemoryRouter><CompletedResult run={run} /></MemoryRouter>);
    const region = screen.getByRole("region", { name: "완료 결과" });
    expect(region).toHaveTextContent(channelLabel(run.channelCode));
    expect(region).toHaveTextContent(
      `${run.progress.completedSteps} / ${run.progress.totalSteps}`,
    );
  });

  it("claims only what the run proves and points at the surface that holds the number", () => {
    // The run view carries no acquired-row count, so this surface must not imply a finished
    // analysis. It previously said "정리·분석까지 끝냈어요" while showing nothing but step progress.
    render(<MemoryRouter><CompletedResult run={run} /></MemoryRouter>);
    const region = screen.getByRole("region", { name: "완료 결과" });
    expect(region).toHaveTextContent("SellerOps에 넘겼어요");
    expect(region).toHaveTextContent("리뷰 화면");
    expect(region.textContent ?? "").not.toContain("분석까지 끝냈어요");
  });

  it("points at the 리뷰 screen's 확인 필요 list — where review work starts (A6), not at a worklist here", () => {
    // It used to say the reviews appear "아래 '오늘 확인할 일'" on this page. That worklist moved:
    // this workbench collects, the 리뷰 screen is where the seller looks and replies.
    render(<MemoryRouter><CompletedResult run={run} /></MemoryRouter>);
    const region = screen.getByRole("region", { name: "완료 결과" });
    expect(screen.getByRole("link", { name: "리뷰 화면" })).toHaveAttribute("href", "/reviews?tier=NEEDS_ATTENTION");
    expect(region.textContent ?? "").not.toContain("오늘 확인할 일");
    expect(region.textContent ?? "").not.toContain("채널 화면");
  });

  it("marks the ✓ result glyph decorative (aria-hidden)", () => {
    render(<MemoryRouter><CompletedResult run={run} /></MemoryRouter>);
    expect(screen.getByText("✓")).toHaveAttribute("aria-hidden", "true");
  });
});
