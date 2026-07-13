// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { renderWithRouter, screen, userEvent } from "../../test/renderWithRouter";
import { ActiveRunCard } from "./ActiveRunCard";
import {
  CHECKPOINT_PROMPT_TITLE,
  DESKTOP_ONLY_COPY,
  START_NEW_RUN_LABEL,
  channelLabel,
  resolveCopy,
  runStatusView,
} from "../../lib/actionWindow/copy";
import { UI_SCENARIOS } from "../../lib/actionWindow/fixtures";

// ActiveRunCard renders a <Link>, so it needs a Router in context (renderWithRouter).
const running = UI_SCENARIOS["observing"].run!; // RUNNING — active, non-terminal, not human
const checkpoint = UI_SCENARIOS["human-action-required"].run!; // WAITING_FOR_HUMAN
const completed = UI_SCENARIOS["completed"].run!; // COMPLETED — terminal

// NOTE: the start-new button lives in a `hidden … sm:inline-block` container and the
// desktop-only note in a `sm:hidden` one. jsdom does not apply Tailwind's stylesheet,
// so both are in the accessibility tree — we assert DOM presence/absence only, never
// visual (responsive) visibility.
describe("FE-11 ActiveRunCard (DOM/a11y)", () => {
  it("renders the labelled 현재 작업 region with the run title, status, and progress", () => {
    renderWithRouter(<ActiveRunCard run={running} onStartNew={() => {}} />);
    const region = screen.getByRole("region", { name: "현재 작업" });
    expect(region).toBeInTheDocument();
    expect(
      screen.getByRole("heading", {
        name: resolveCopy(running.runCopyKey, running.runCopyParams),
      }),
    ).toBeInTheDocument();
    expect(region).toHaveTextContent(runStatusView(running.status).label);
    expect(region).toHaveTextContent(channelLabel(running.channelCode));
    expect(region).toHaveTextContent(
      `진행 ${running.progress.completedSteps} / ${running.progress.totalSteps} 단계`,
    );
  });

  it("links to the run detail and offers no start-new affordance on a non-terminal run", () => {
    renderWithRouter(<ActiveRunCard run={running} onStartNew={() => {}} />);
    const link = screen.getByRole("link", { name: "자세히 보기" });
    expect(link).toHaveAttribute("href", "/operations/current");
    // Non-terminal ⇒ no start-new button, no desktop-only start-new note.
    expect(screen.queryByRole("button", { name: START_NEW_RUN_LABEL })).toBeNull();
    expect(screen.queryByText(DESKTOP_ONLY_COPY.startNew)).toBeNull();
  });

  it("surfaces the checkpoint prompt and a primary CTA when waiting for a human", () => {
    renderWithRouter(<ActiveRunCard run={checkpoint} onStartNew={() => {}} />);
    const region = screen.getByRole("region", { name: "현재 작업" });
    expect(region).toHaveTextContent(CHECKPOINT_PROMPT_TITLE);
    expect(region).toHaveTextContent(
      resolveCopy(checkpoint.currentStep!.copyKey, checkpoint.currentStep!.copyParams),
    );
    const link = screen.getByRole("link", { name: "확인하러 가기" });
    expect(link).toHaveAttribute("href", "/operations/current");
    // Still not terminal ⇒ no start-new affordance.
    expect(screen.queryByRole("button", { name: START_NEW_RUN_LABEL })).toBeNull();
  });

  it("offers the start-new action on a completed run and fires onStartNew", async () => {
    const onStartNew = vi.fn();
    renderWithRouter(<ActiveRunCard run={completed} onStartNew={onStartNew} />);
    const region = screen.getByRole("region", { name: "현재 작업" });
    // Completed-only hint that the finished run moves to recent activity.
    expect(region).toHaveTextContent("새 작업을 시작하면 이 작업은 최근 활동으로 이동해요.");
    await userEvent.click(screen.getByRole("button", { name: START_NEW_RUN_LABEL }));
    expect(onStartNew).toHaveBeenCalledTimes(1);
    // Desktop-only note is present, and the detail link still navigates.
    expect(region).toHaveTextContent(DESKTOP_ONLY_COPY.startNew);
    expect(screen.getByRole("link", { name: "자세히 보기" })).toHaveAttribute(
      "href",
      "/operations/current",
    );
  });

  it("hides the start-new action and desktop-only note when actions are disabled (offline)", () => {
    renderWithRouter(
      <ActiveRunCard run={completed} onStartNew={() => {}} actionsEnabled={false} />,
    );
    expect(screen.queryByRole("button", { name: START_NEW_RUN_LABEL })).toBeNull();
    expect(screen.queryByText(DESKTOP_ONLY_COPY.startNew)).toBeNull();
    // Navigation stays available even while offline.
    expect(screen.getByRole("link", { name: "자세히 보기" })).toBeInTheDocument();
  });
});
