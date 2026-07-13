// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { ReviewWorkCard } from "./ReviewWorkCard";
import {
  DESKTOP_ONLY_COPY,
  REVIEW_WORK_COPY,
  SECTION_TITLE,
  resolveCopy,
} from "../../lib/actionWindow/copy";

// The item title reuses the run copy key, so a seller sees the same name here as on the
// run/checkpoint/completed surfaces. Asserted via resolveCopy (not a hardcoded literal).
const TASK_TITLE = resolveCopy("actionWindow.review.run");

// NOTE: the primary action is `hidden … sm:inline-block` and the mobile note is `sm:hidden`.
// jsdom does not apply Tailwind, so both are in the accessibility tree — we assert DOM
// presence only, never visual (responsive) visibility.
describe("FE-12 ReviewWorkCard (DOM/a11y)", () => {
  it("renders the 리뷰 업무 현황 section as a current-task card: title, status, one current step", () => {
    render(<ReviewWorkCard connected onStart={() => {}} />);
    const region = screen.getByRole("region", { name: SECTION_TITLE.reviewWork });
    expect(region).toBeInTheDocument();
    // Section header (h2) and the task title (h3) — valid heading nesting, no extra headings.
    expect(
      screen.getByRole("heading", { level: 2, name: SECTION_TITLE.reviewWork }),
    ).toBeInTheDocument();
    expect(screen.getByRole("heading", { level: 3, name: TASK_TITLE })).toBeInTheDocument();
    // Overall status + the single current step (no explainer/preview of later steps).
    expect(region).toHaveTextContent(REVIEW_WORK_COPY.statusLabel);
    expect(region).toHaveTextContent(REVIEW_WORK_COPY.currentStepLabel);
    expect(region).toHaveTextContent(REVIEW_WORK_COPY.currentStepText);
    // No post-run outcomes/steps are previewed before a run exists.
    expect(screen.queryByRole("list")).toBeNull();
  });

  it("renders the 수집 시작 action and fires onStart when connected", async () => {
    const onStart = vi.fn();
    render(<ReviewWorkCard connected onStart={onStart} />);
    await userEvent.click(screen.getByRole("button", { name: REVIEW_WORK_COPY.actionLabel }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("omits the 수집 시작 action but keeps the desktop-only guidance when not connected", () => {
    render(<ReviewWorkCard connected={false} onStart={() => {}} />);
    expect(screen.queryByRole("button", { name: REVIEW_WORK_COPY.actionLabel })).toBeNull();
    expect(
      screen.getByRole("region", { name: SECTION_TITLE.reviewWork }),
    ).toHaveTextContent(DESKTOP_ONLY_COPY.start);
  });
});
