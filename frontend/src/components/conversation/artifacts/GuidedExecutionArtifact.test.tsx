// @vitest-environment jsdom
import { describe, it, expect, vi, beforeEach } from "vitest";
import { render, screen, waitFor, act } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { GuidedExecutionArtifact, STAGE_WORDS, stageOf } from "./GuidedExecutionArtifact";
import type { GuidedExecutionArtifact as Guided } from "../../../lib/conversation/types";
import type { ReplyRuntime, ReplySignal } from "../../../lib/actionWindow/reply/replyRuntime";

const startReviewReplySubmissionRun = vi.fn();
const getReviewReplyExecution = vi.fn();
const recordReviewReplyOutcome = vi.fn();
const getReviewReplyPrep = vi.fn();
vi.mock("../../../lib/apiClient", () => ({
  api: {
    startReviewReplySubmissionRun: (...a: unknown[]) => startReviewReplySubmissionRun(...a),
    getReviewReplyExecution: (...a: unknown[]) => getReviewReplyExecution(...a),
    recordReviewReplyOutcome: (...a: unknown[]) => recordReviewReplyOutcome(...a),
    getReviewReplyPrep: (...a: unknown[]) => getReviewReplyPrep(...a),
  },
  getToken: () => null,
}));

const ARTIFACT: Guided = {
  artifactId: "g-1",
  type: "GUIDED_EXECUTION",
  title: "네이버에서 답변 등록",
  actionType: "REVIEW_REPLY",
  objectKind: "REVIEW",
  channelCode: "NAVER",
  channelNameKo: "네이버",
  accountId: "acc-nv",
  reviewId: "rv-1",
  actionRef: "ref-1",
  draftVersion: 2,
  contentFingerprint: "fp-2",
  requiresLocalAgent: true,
  to: "/reviews/rv-1",
};

/** A fake runtime that records commands and lets the test emit sanitized signals. */
function fakeRuntime() {
  const listeners = new Set<(s: ReplySignal) => void>();
  const calls: string[] = [];
  const runtime: ReplyRuntime & { emit: (s: ReplySignal) => void; calls: string[] } = {
    calls,
    start: vi.fn(async () => {
      calls.push("START_RUN");
      return { runId: "run_abc" };
    }),
    report: vi.fn(async (_id: string, outcome) => {
      calls.push(outcome);
      return { runId: "run_abc", operatorOutcome: outcome, verification: "UNVERIFIED" as const };
    }),
    dispose: vi.fn(),
    observe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    emit: (s) => listeners.forEach((l) => l(s)),
  };
  return runtime;
}

beforeEach(() => {
  startReviewReplySubmissionRun.mockReset().mockResolvedValue({ actionRef: "ref-1", submissionRef: "sub-1", approvedVersion: 2 });
  getReviewReplyExecution.mockReset().mockResolvedValue(null);
  recordReviewReplyOutcome.mockReset().mockResolvedValue({ actionRef: "ref-1", recorded: true, replayed: false });
  getReviewReplyPrep.mockReset();
});

describe("stageOf — which stage a sanitized signal proves", () => {
  it("maps run events to the four stage words and ignores anything else", () => {
    expect(stageOf({ type: "RUN_STARTED", stepId: null })).toBe(0);
    expect(stageOf({ type: "TARGET_HIGHLIGHTED", stepId: "aw.open_review_row" })).toBe(0);
    expect(stageOf({ type: "HUMAN_ACTION_REQUIRED", stepId: "aw.user_reply_submit" })).toBe(1);
    expect(stageOf({ type: "COMPOSER_FILLED", stepId: "aw.user_reply_submit" })).toBe(2);
    expect(stageOf({ type: "SELLER_SUBMISSION_OBSERVED", stepId: "aw.user_reply_submit" })).toBe(3);
    expect(stageOf({ type: "RUN_BLOCKED", stepId: null })).toBeNull();
    expect(STAGE_WORDS[3]).toBe("등록은 판매자님이 누릅니다");
  });
});

describe("guided execution artifact — NAVER review reply, seller submits", () => {
  it("primary mints the submission run, starts REPLY_SUBMISSION, shows stage words, and never a submit control", async () => {
    const runtime = fakeRuntime();
    render(<MemoryRouter><GuidedExecutionArtifact artifact={ARTIFACT} replyRuntime={runtime} /></MemoryRouter>);
    expect(startReviewReplySubmissionRun).not.toHaveBeenCalled();
    await userEvent.click(screen.getByRole("button", { name: "네이버에서 답변하기" }));
    await waitFor(() => expect(startReviewReplySubmissionRun).toHaveBeenCalledWith("acc-nv", "ref-1"));
    await waitFor(() => expect(runtime.start).toHaveBeenCalledWith({ channelCode: "naver", submissionRef: "sub-1" }));
    expect(await screen.findByTestId("guided-execution-run")).toBeInTheDocument();
    for (const word of STAGE_WORDS) expect(screen.getByText(word)).toBeInTheDocument();
    for (const name of ["등록하기", "전송", "발송", "답변 보내기"]) {
      expect(screen.queryByRole("button", { name })).toBeNull();
    }
    act(() => runtime.emit({ type: "COMPOSER_FILLED", stepId: "aw.user_reply_submit" }));
    // Stage 2 reached: the first two are checked, the third is current.
    const items = screen.getAllByRole("listitem");
    expect(items[0]!.textContent).toContain("✓");
    expect(items[2]!.textContent).toContain("○");
    expect(runtime.calls).toEqual(["START_RUN"]);
  });

  it("the helper observing the seller's submit ends in EXECUTION_RESULT with SELLER_SUBMISSION_OBSERVED", async () => {
    const runtime = fakeRuntime();
    render(<MemoryRouter><GuidedExecutionArtifact artifact={ARTIFACT} replyRuntime={runtime} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "네이버에서 답변하기" }));
    await screen.findByTestId("guided-execution-run");
    act(() => runtime.emit({ type: "SELLER_SUBMISSION_OBSERVED", stepId: "aw.user_reply_submit" }));
    expect(await screen.findByTestId("guided-execution-result")).toBeInTheDocument();
    expect(screen.getByText("등록 확인")).toBeInTheDocument();
    expect(screen.getByText(/등록된 내용이 초안과 같은지는 확인하지 않습니다/)).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "리뷰 화면에서 확인" })).toHaveAttribute("href", "/reviews/rv-1");
    // No report command was sent by the client for an observed submit.
    expect(runtime.report).not.toHaveBeenCalled();
  });

  it("「그만두기」 reports the abort through the runtime (intent, not completion) and records nothing as sent", async () => {
    const runtime = fakeRuntime();
    render(<MemoryRouter><GuidedExecutionArtifact artifact={ARTIFACT} replyRuntime={runtime} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "네이버에서 답변하기" }));
    await screen.findByTestId("guided-execution-run");
    await userEvent.click(screen.getByRole("button", { name: "그만두기" }));
    await waitFor(() => expect(runtime.report).toHaveBeenCalledWith("run_abc", "SUBMISSION_ABORTED"));
    expect(await screen.findByText(/등록하지 않고 마쳤습니다/)).toBeInTheDocument();
    expect(recordReviewReplyOutcome.mock.calls[0]![2]).toMatchObject({ submissionRef: "sub-1", operatorOutcome: "SUBMISSION_ABORTED", awRunRef: "run_abc" });
  });

  it("a mint that fails falls back to the copy path, no run started", async () => {
    startReviewReplySubmissionRun.mockRejectedValue(new Error("409"));
    const runtime = fakeRuntime();
    render(<MemoryRouter><GuidedExecutionArtifact artifact={ARTIFACT} replyRuntime={runtime} /></MemoryRouter>);
    await userEvent.click(screen.getByRole("button", { name: "네이버에서 답변하기" }));
    expect(await screen.findByText(/답변 안내를 시작하지 못했습니다/)).toBeInTheDocument();
    expect(runtime.start).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: "승인한 답변 복사" })).toBeInTheDocument();
  });
});
