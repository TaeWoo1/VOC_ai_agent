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

  it("claims only what the run proves and points at the surface that holds the number", () => {
    // The run view carries no acquired-row count, so this surface must not imply a finished
    // analysis. It previously said "정리·분석까지 끝냈어요" while showing nothing but step progress.
    render(<CompletedResult run={run} />);
    const region = screen.getByRole("region", { name: "완료 결과" });
    expect(region).toHaveTextContent("SellerOps에 넘겼어요");
    expect(region).toHaveTextContent("오늘 확인할 일");
    expect(region.textContent ?? "").not.toContain("분석까지 끝냈어요");
  });

  it("points at the worklist on THIS page, not at a channel screen under Settings", () => {
    // It used to read "채널 화면의 '오늘 확인할 일'에 표시돼요" — true at the time, and a dead end:
    // that screen lives under 연결·설정 and nothing in 운영 linked to it. The worklist is on the
    // operations home now, so the sentence has to stop sending people to Settings.
    render(<CompletedResult run={run} />);
    const region = screen.getByRole("region", { name: "완료 결과" });
    expect(region).toHaveTextContent("오늘 확인할 일");
    expect(region.textContent ?? "").not.toContain("채널 화면");
  });

  it("marks the ✓ result glyph decorative (aria-hidden)", () => {
    render(<CompletedResult run={run} />);
    expect(screen.getByText("✓")).toHaveAttribute("aria-hidden", "true");
  });
});
