// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { renderWithRouter, screen } from "../../test/renderWithRouter";
import { HomeReviewOpsCard } from "./HomeReviewOpsCard";
import { UI_SCENARIOS } from "../../lib/actionWindow/fixtures";
import {
  CHECKPOINT_PROMPT_TITLE,
  HOME_REVIEW_OPS_COPY,
  resolveCopy,
} from "../../lib/actionWindow/copy";

// These scenarios always carry a run (unlike the null-run "ready-to-start").
const CHECKPOINT_RUN = UI_SCENARIOS["human-action-required"].run!;
const RUNNING_RUN = UI_SCENARIOS["observing"].run!;

describe("HomeReviewOpsCard", () => {
  it("empty state (run=null): calm message + a link to open the workbench, no status", () => {
    renderWithRouter(<HomeReviewOpsCard run={null} />);
    const region = screen.getByRole("region", { name: HOME_REVIEW_OPS_COPY.sectionTitle });
    expect(region).toHaveTextContent(HOME_REVIEW_OPS_COPY.emptyBody);
    expect(screen.queryByText(CHECKPOINT_PROMPT_TITLE)).toBeNull();
    expect(
      screen.getByRole("link", { name: new RegExp(HOME_REVIEW_OPS_COPY.open) }),
    ).toHaveAttribute("href", "/connect/imports");
  });

  it("checkpoint run: shows the run title, checkpoint prompt, and a link to the run detail", () => {
    renderWithRouter(<HomeReviewOpsCard run={CHECKPOINT_RUN} />);
    expect(
      screen.getByText(resolveCopy(CHECKPOINT_RUN.runCopyKey, CHECKPOINT_RUN.runCopyParams)),
    ).toBeInTheDocument();
    expect(screen.getByText(CHECKPOINT_PROMPT_TITLE)).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: new RegExp(HOME_REVIEW_OPS_COPY.goToCheckpoint) }),
    ).toHaveAttribute("href", "/connect/imports/current");
  });

  it("non-checkpoint run: shows progress and links to the landing, no checkpoint prompt", () => {
    renderWithRouter(<HomeReviewOpsCard run={RUNNING_RUN} />);
    const region = screen.getByRole("region", { name: HOME_REVIEW_OPS_COPY.sectionTitle });
    expect(region).toHaveTextContent("진행");
    expect(screen.queryByText(CHECKPOINT_PROMPT_TITLE)).toBeNull();
    expect(
      screen.getByRole("link", { name: new RegExp(HOME_REVIEW_OPS_COPY.open) }),
    ).toHaveAttribute("href", "/connect/imports");
  });
});
