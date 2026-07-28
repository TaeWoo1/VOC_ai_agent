// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { IssueFeedbackControl } from "./IssueFeedbackControl";
import { api } from "../../lib/apiClient";
import { expectNoAxeViolations } from "../../test/axe";

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("IssueFeedbackControl", () => {
  it("records the chosen feedback with a command id and confirms it", async () => {
    const spy = vi
      .spyOn(api, "recordReviewIssueFeedback")
      .mockResolvedValue({ issueId: "issue-1", kind: "USEFUL", replayed: false });
    render(<IssueFeedbackControl issueId="issue-1" />);

    await userEvent.click(screen.getByRole("button", { name: "유용함" }));

    await waitFor(() => expect(spy).toHaveBeenCalledTimes(1));
    const [issueId, body] = spy.mock.calls[0];
    expect(issueId).toBe("issue-1");
    expect(body.kind).toBe("USEFUL");
    expect(body.commandId).toMatch(/[0-9a-f-]{36}/);
    expect(screen.getByRole("button", { name: "유용함" })).toHaveAttribute("aria-pressed", "true");
    expect(screen.getByText(/기록했습니다. 감사합니다/)).toBeInTheDocument();
  });

  it("reuses one command id when the same answer is retried, so it replays rather than duplicating", async () => {
    let calls = 0;
    const spy = vi.spyOn(api, "recordReviewIssueFeedback").mockImplementation(async () => {
      calls += 1;
      if (calls === 1) {
        throw new Error("transient");
      }
      return { issueId: "issue-1", kind: "LATER", replayed: calls > 2 };
    });
    render(<IssueFeedbackControl issueId="issue-1" />);

    const later = screen.getByRole("button", { name: "나중에 보기" });
    await userEvent.click(later);
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/기록하지 못했습니다/));
    await userEvent.click(later);
    await waitFor(() => expect(screen.getByText(/기록했습니다/)).toBeInTheDocument());

    expect(spy.mock.calls[0][1].commandId).toBe(spy.mock.calls[1][1].commandId);
  });

  it("shows an actionable failure rather than a false success", async () => {
    vi.spyOn(api, "recordReviewIssueFeedback").mockRejectedValue(new Error("boom"));
    render(<IssueFeedbackControl issueId="issue-1" />);

    await userEvent.click(screen.getByRole("button", { name: "관련 없음" }));

    await waitFor(() =>
      expect(screen.getByRole("alert")).toHaveTextContent(/피드백을 기록하지 못했습니다/),
    );
    expect(screen.getByRole("button", { name: "관련 없음" })).toHaveAttribute("aria-pressed", "false");
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<IssueFeedbackControl issueId="issue-1" />);
    await expectNoAxeViolations(container);
  });
});
