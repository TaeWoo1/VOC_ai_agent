// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { act, cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidedImportCard } from "./GuidedImportCard";
import { api } from "../../lib/apiClient";
import type {
  GuidedImportKind,
  GuidedImportRuntime,
  GuidedImportSnapshot,
} from "../../lib/actionWindow/import/importRuntime";
import type { AwGuidancePack } from "../../../../contracts/action-window/v2/transport";
import type {
  ReviewImportPlanDetailView,
  ReviewImportSegmentView,
  SellerAccountResponse,
} from "../../lib/types";

/**
 * A guided runtime under test control.
 *
 * The card is injected with this instead of opening a socket, so a component test never needs a local agent —
 * and so the two things worth asserting are directly observable: WHICH launch ref and kind reached `START_RUN`,
 * and that every rendered command came from `allowedCommands`.
 */
function fakeRuntime(opts: { attach?: boolean; startRejects?: Error } = {}) {
  const listeners = new Set<(s: GuidedImportSnapshot | null) => void>();
  let snapshot: GuidedImportSnapshot | null = null;
  const starts: { launchRef: string; kind: GuidedImportKind }[] = [];
  const sent: string[] = [];
  const packs: AwGuidancePack[] = [];
  const runtime: GuidedImportRuntime = {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
    },
    setGuidancePack(pack) {
      packs.push(pack);
    },
    async start(input) {
      starts.push(input);
      if (opts.startRejects) throw opts.startRejects;
    },
    send(type) {
      sent.push(type);
    },
    resync() {},
    dispose() {},
  };
  const publish = (next: Partial<GuidedImportSnapshot> | null): void => {
    snapshot =
      next === null
        ? null
        : {
            runId: "run_abc123abc123",
            status: "WAITING_FOR_HUMAN",
            intent: "INITIAL_REVIEW_IMPORT_SEGMENT",
            step: null,
            blocker: null,
            allowedCommands: [],
            revision: 3,
            ...next,
          };
    for (const l of [...listeners]) l(snapshot);
  };
  return { runtime, starts, sent, packs, publish, attach: opts.attach ?? true };
}

const account: SellerAccountResponse = {
  id: "acc-1",
  channelId: "chan-1",
  channelNameKo: "네이버 스마트스토어",
  alias: "내 스토어",
  connectionStatus: "CONNECTED",
  lastSyncedAt: null,
  fileUpload: true,
};

const seg = (over: Partial<ReviewImportSegmentView> = {}): ReviewImportSegmentView => ({
  id: "s1",
  ordinal: 0,
  segmentStart: "2026-03-01",
  segmentEnd: "2026-03-31",
  executionState: "PENDING",
  coverageState: "UNVERIFIED",
  coveredRows: null,
  rowsReconciled: false,
  superseded: false,
  parentSegmentId: null,
  ...over,
});

const plan = (segments: ReviewImportSegmentView[]): ReviewImportPlanDetailView => ({
  plan: {
    id: "plan-1",
    sellerAccountId: account.id,
    channelId: account.channelId,
    requestedStart: "2026-03-01",
    requestedEnd: "2026-04-30",
    status: "ACTIVE",
    createdAt: "2026-07-25T00:00:00Z",
  } as ReviewImportPlanDetailView["plan"],
  segments,
  coverage: {
    covered: [],
    missing: [],
    remaining: [],
    lastCoveredDate: null,
    coveredRows: 0,
    coveredSegments: 0,
    remainingSegments: segments.length,
    missingSegments: 0,
  },
});

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

describe("GuidedImportCard — one action carries the import", () => {
  /**
   * With no plan the card asks the ONE question, and asks it here rather than in the marketplace window.
   *
   * This reverses what shipped on 2026-07-25, where the first press opened the seller center and walked the
   * seller through NAVER's date pickers to find the earliest date it allowed. The live run established that it
   * allows everything, so the question was about a limit that does not exist (finding 16).
   */
  it("asks how far back to import before any plan exists, instead of offering a run", async () => {
    vi.spyOn(api, "previewReviewImportRange").mockResolvedValue({
      start: "2025-07-01", end: "2026-07-26", segmentCount: 13,
    });
    render(<GuidedImportCard account={account} plan={null} agent="ready" />);

    expect(screen.getByTestId("range-chooser")).toBeInTheDocument();
    // No guided run is offered yet: there is nothing to guide until the seller has decided a period.
    expect(screen.queryByTestId("guided-import-cta")).toBeNull();
    // And the choice is a MONTH, because segments are calendar months.
    expect(screen.getByTestId("range-start-month")).toBeInTheDocument();
  });

  /** The count is the fact that makes the choice a decision: 13 months is 13 exports done by hand. */
  it("shows the period AND how many monthly exports it becomes, before creating anything", async () => {
    const preview = vi.spyOn(api, "previewReviewImportRange").mockResolvedValue({
      start: "2025-07-01", end: "2026-07-26", segmentCount: 13,
    });
    const create = vi.spyOn(api, "selectReviewImportRange");
    render(<GuidedImportCard account={account} plan={null} agent="ready" />);

    await waitFor(() => expect(screen.getByTestId("range-preview")).toHaveTextContent("13개 구간"));
    expect(screen.getByTestId("range-preview")).toHaveTextContent("2025-07-01 ~ 2026-07-26");
    expect(preview).toHaveBeenCalled();
    // Nothing was created by looking.
    expect(create).not.toHaveBeenCalled();
  });

  it("creates the plan only when the seller confirms the period they were shown", async () => {
    vi.spyOn(api, "previewReviewImportRange").mockResolvedValue({
      start: "2025-07-01", end: "2026-07-26", segmentCount: 13,
    });
    const create = vi.spyOn(api, "selectReviewImportRange").mockResolvedValue(plan([seg()]));
    const onPlanCreated = vi.fn();
    render(<GuidedImportCard account={account} plan={null} agent="ready" onPlanCreated={onPlanCreated} />);
    await waitFor(() => expect(screen.getByTestId("range-preview")).toBeInTheDocument());

    await userEvent.click(screen.getByTestId("range-confirm"));

    await waitFor(() => expect(onPlanCreated).toHaveBeenCalled());
    expect(create).toHaveBeenCalledWith("acc-1", expect.stringMatching(/^\d{4}-\d{2}$/));
  });

  /**
   * Deciding how far back to import needs no local helper. Gating the question on pairing would make an
   * onboarding step a dead end for a seller who has not installed anything yet.
   */
  it("asks the question even when no agent is available", () => {
    vi.spyOn(api, "previewReviewImportRange").mockResolvedValue({
      start: "2025-07-01", end: "2026-07-26", segmentCount: 13,
    });
    render(<GuidedImportCard account={account} plan={null} agent="not_running" />);
    expect(screen.getByTestId("range-chooser")).toBeInTheDocument();
  });

  it("with a plan it launches the next segment", async () => {
    const next = vi.spyOn(api, "launchNextReviewImportSegment").mockResolvedValue({
      launchRef: "9a8b7c6d5e4f3021", kind: "SEGMENT", status: "ISSUED", planId: "plan-1", segmentId: "s2",
      requiredStart: "2026-04-01", requiredEnd: "2026-04-30", discoveredStart: null, discoveredEnd: null,
      rangeEvidence: null,
    });
    const fake = fakeRuntime();

    render(
      <GuidedImportCard
        account={account}
        plan={plan([seg({ executionState: "COMPLETED", coverageState: "COVERED" }), seg({ id: "s2", segmentStart: "2026-04-01", segmentEnd: "2026-04-30" })])}
        agent="ready"
        runtime={fake.runtime}
      />,
    );
    expect(screen.getByTestId("guided-import-cta")).toHaveTextContent("계속 가져오기");
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(next).toHaveBeenCalledWith("plan-1"));
    expect(fake.starts).toEqual([{ launchRef: "9a8b7c6d5e4f3021", kind: "SEGMENT" }]);
    // The words the seller will read in their SmartStore window went down BEFORE the run started.
    expect(fake.packs.length).toBe(1);
    expect(fake.packs[0]!.steps["actionWindow.import.export"]).toContain("엑셀");
  });

  it("shows progress, the CHOSEN period, and the next segment — not segment management", () => {
    render(
      <GuidedImportCard
        account={account}
        plan={plan([seg({ executionState: "COMPLETED", coverageState: "COVERED" }), seg({ id: "s2", segmentStart: "2026-04-01", segmentEnd: "2026-04-30" })])}
        agent="ready"
      />,
    );
    expect(screen.getByTestId("import-progress")).toHaveTextContent("2개 구간 중 1개 완료");
    // "가져올 기간" — the seller's own choice. Nothing here has measured what the marketplace allows.
    expect(screen.getByTestId("selected-range")).toHaveTextContent("2026-03-01 ~ 2026-04-30");
    expect(screen.queryByText("가져올 수 있는 기간")).toBeNull();
    // Newest month first: whoever stops half-way through 13 exports keeps the half that matters.
    expect(screen.getByTestId("next-segment-range")).toHaveTextContent("2026-04-01 ~ 2026-04-30");
    // no split / merge / missing controls on the seller's card
    expect(screen.queryByText(/나누기|합치기/)).toBeNull();
  });

  it("never asks the seller to find or upload a file on the guided path", () => {
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" />);
    expect(screen.queryByTestId("file-fallback-link")).toBeNull();
    expect(document.querySelector('input[type="file"]')).toBeNull();
  });
});

describe("GuidedImportCard — honest unavailability", () => {
  it.each([
    ["not_running", /실행되지 않았어요/],
    ["unpaired", /연결이 필요해요/],
    ["incompatible", /버전이 맞지 않아요/],
  ] as const)("explains %s and disables the CTA rather than failing silently", (agent, pattern) => {
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent={agent} />);
    expect(screen.getByTestId("agent-unavailable")).toHaveTextContent(pattern);
    expect(screen.getByTestId("guided-import-cta")).toBeDisabled();
  });

  it("offers the manual file path ONLY when a guided run cannot happen", () => {
    const onUseFileFallback = vi.fn();
    const { rerender } = render(
      <GuidedImportCard account={account} plan={plan([seg()])} agent="ready" onUseFileFallback={onUseFileFallback} />,
    );
    expect(screen.queryByTestId("file-fallback-link")).toBeNull();

    rerender(
      <GuidedImportCard account={account} plan={plan([seg()])} agent="not_running" onUseFileFallback={onUseFileFallback} />,
    );
    expect(screen.getByTestId("file-fallback-link")).toHaveTextContent("파일로 가져오기");
  });

  it("surfaces a launch failure instead of leaving the button looking successful", async () => {
    vi.spyOn(api, "launchNextReviewImportSegment").mockRejectedValue(new Error("boom"));
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fakeRuntime().runtime} />);
    await userEvent.click(screen.getByTestId("guided-import-cta"));
    await waitFor(() => expect(screen.getByRole("alert")).toHaveTextContent(/시작하지 못했어요/));
    expect(screen.queryByTestId("guided-run-started")).toBeNull();
  });
});

describe("GuidedImportCard — completion is claimed honestly", () => {
  it("states only that the selectable periods were imported, and hides the CTA", () => {
    render(
      <GuidedImportCard
        account={account}
        plan={plan([
          seg({ executionState: "COMPLETED", coverageState: "COVERED" }),
          seg({ id: "s2", executionState: "COMPLETED", coverageState: "MISSING" }),
        ])}
        agent="ready"
      />,
    );
    const summary = screen.getByTestId("completion-summary");
    expect(summary).toHaveTextContent("NAVER에서 현재 선택 가능한 기간의 리뷰 파일을 가져왔습니다.");
    expect(summary.textContent).not.toMatch(/100%|모든 리뷰|전체 리뷰/);
    expect(screen.queryByTestId("guided-import-cta")).toBeNull();
  });

  it("does not claim completion while a segment still remains", () => {
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" />);
    expect(screen.queryByTestId("completion-summary")).toBeNull();
    expect(screen.getByTestId("guided-import-cta")).toBeInTheDocument();
  });
});

describe("GuidedImportCard — the launch ref is not seller-facing", () => {
  it("never renders the opaque authorization it just minted", async () => {
    const ref = "0f1e2d3c4b5a6978";
    vi.spyOn(api, "launchNextReviewImportSegment").mockResolvedValue({
      launchRef: ref, kind: "SEGMENT", status: "ISSUED", planId: "plan-1", segmentId: "s1",
      requiredStart: "2026-03-01", requiredEnd: "2026-03-31", discoveredStart: null, discoveredEnd: null,
      rangeEvidence: null,
    });
    const fake = fakeRuntime();
    const { container } = render(
      <GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />,
    );
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(screen.getByTestId("guided-run-started")).toBeInTheDocument());
    // it authorizes action against a live marketplace — it is a credential, not a status line
    expect(container.textContent).not.toContain(ref);
  });
});

/* ─────────────── the run itself, once the agent is driving it ─────────────── */

const SEGMENT_LAUNCH = {
  launchRef: "0f1e2d3c4b5a6978", kind: "SEGMENT" as const, status: "ISSUED" as const, planId: "plan-1",
  segmentId: "s1", requiredStart: "2026-03-01", requiredEnd: "2026-03-31", discoveredStart: null,
  discoveredEnd: null, rangeEvidence: null,
};

describe("GuidedImportCard — it renders what the runtime publishes", () => {
  it("shows the current step from the runtime's own copy key and counter", async () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />);

    act(() => {
      fake.publish({
        step: {
          stepNumber: 3,
          totalSteps: 8,
          copyKey: "actionWindow.import.setStartDate",
          copyParams: { targetKind: "start_date" },
          status: "AWAITING_USER",
        },
      });
    });

    expect(screen.getByTestId("guided-step-count")).toHaveTextContent("8단계 중 3");
    expect(screen.getByTestId("guided-run-progress")).toHaveTextContent(/시작일/);
    // The dotted key itself is never shown to the seller — the FE owns every word.
    expect(screen.getByTestId("guided-run-progress").textContent).not.toContain("actionWindow.");
  });

  it("shows the window a segment run is asking for, so a highlighted date field is not a guess", async () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />);

    act(() => {
      fake.publish({
        step: {
          stepNumber: 3, totalSteps: 8, copyKey: "actionWindow.import.setStartDate",
          copyParams: { targetKind: "start_date", requiredStart: "2026-06-01", requiredEnd: "2026-06-30" },
          status: "AWAITING_USER",
        },
      });
    });

    expect(screen.getByTestId("guided-required-range")).toHaveTextContent("2026-06-01 ~ 2026-06-30");
  });

  /**
   * The gap the live run exposed: the runtime reported `SCOPE_MISMATCH` correctly and the seller's screen did
   * not change, so they could not tell why nothing advanced.
   */
  it("explains a SCOPE_MISMATCH and names the repair", async () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />);

    act(() => {
      fake.publish({
        status: "WAITING_FOR_HUMAN",
        blocker: { code: "SCOPE_MISMATCH", recoverable: true },
        allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN", "PAUSE_RUN"],
      });
    });

    const card = screen.getByTestId("guided-run-blocker");
    expect(card).toHaveTextContent("선택한 기간이 달라요");
    expect(card).toHaveTextContent(/날짜를 다시 선택해 주세요/);
  });

  it("renders command buttons only from allowedCommands, and sends what it renders", async () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />);

    act(() => {
      fake.publish({ allowedCommands: ["REQUEST_STEP_RECHECK", "PAUSE_RUN", "SET_GUIDANCE_ENABLED"] });
    });
    // Offered: the recheck. Not offered: CANCEL_RUN (absent from allowedCommands) and everything the card
    // deliberately does not put in front of a seller.
    expect(screen.getByTestId("guided-command-REQUEST_STEP_RECHECK")).toBeInTheDocument();
    expect(screen.queryByTestId("guided-command-CANCEL_RUN")).toBeNull();

    await userEvent.click(screen.getByTestId("guided-command-REQUEST_STEP_RECHECK"));
    expect(fake.sent).toEqual(["REQUEST_STEP_RECHECK"]);
  });

  it("offers no command at all when the runtime allows none", async () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />);
    act(() => fake.publish({ allowedCommands: [] }));
    expect(screen.getByTestId("guided-run-commands")).toBeEmptyDOMElement();
  });

  it("hides the CTA while a run is in flight, so one seller cannot start two", async () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />);
    act(() => fake.publish({ status: "WAITING_FOR_HUMAN" }));
    expect(screen.queryByTestId("guided-import-cta")).toBeNull();
  });

  it("re-reads the plan once when a run reaches a terminal state", async () => {
    const onRunSettled = vi.fn();
    const fake = fakeRuntime();
    render(
      <GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} onRunSettled={onRunSettled} />,
    );

    act(() => fake.publish({ status: "WAITING_FOR_HUMAN" }));
    expect(onRunSettled).not.toHaveBeenCalled();

    act(() => fake.publish({ status: "COMPLETED", allowedCommands: [] }));
    act(() => fake.publish({ status: "COMPLETED", allowedCommands: [], revision: 9 }));
    // One run, one refresh — a repeated terminal view must not spam the backend.
    expect(onRunSettled).toHaveBeenCalledTimes(1);
    // And the CTA comes back, because the next segment is the next press.
    expect(screen.getByTestId("guided-import-cta")).toBeInTheDocument();
  });
});

describe("GuidedImportCard — the seller can act on what they are told", () => {
  /**
   * The recheck control names what the seller just did. A single fixed label ("확인 완료") was wording the
   * 2026-07-25 operator could not match to anything on their screen.
   */
  it("labels the recheck control for the step it is offered at", () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />);

    act(() => {
      fake.publish({
        step: {
          stepNumber: 6,
          totalSteps: 8,
          copyKey: "actionWindow.import.export",
          copyParams: { targetKind: "export" },
          status: "AWAITING_USER",
        },
        allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
      });
    });

    expect(screen.getByTestId("guided-command-REQUEST_STEP_RECHECK")).toHaveTextContent("엑셀 다운로드 눌렀어요");
  });

  /** A stop at the scope gate is nominally still a date step; what the seller must do is fix the dates. */
  it("labels it for the BLOCKER when the run is stopped", () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />);

    act(() => {
      fake.publish({
        step: {
          stepNumber: 4,
          totalSteps: 8,
          copyKey: "actionWindow.import.setEndDate",
          copyParams: { targetKind: "end_date" },
          status: "AWAITING_USER",
        },
        blocker: { code: "SCOPE_MISMATCH", recoverable: true },
        allowedCommands: ["REQUEST_STEP_RECHECK", "CANCEL_RUN"],
      });
    });

    expect(screen.getByTestId("guided-command-REQUEST_STEP_RECHECK")).toHaveTextContent("날짜 다시 확인");
  });

  /**
   * The pairing action appears on the card that is blocked without it. Before this, connecting a local helper
   * was reachable only behind a developer env flag, so a seller had no way to start at all (finding 14).
   */
  it("offers the pairing action right where the run is blocked", async () => {
    const onConnect = vi.fn();
    render(
      <GuidedImportCard
        account={account}
        plan={plan([seg()])}
        agent="unpaired"
        pairing={{ phase: "unpaired", confirmationCode: null, onConnect, onRetry: vi.fn() }}
      />,
    );

    expect(screen.getByTestId("agent-unavailable")).toBeInTheDocument();
    await userEvent.click(screen.getByTestId("agent-pairing-connect"));
    expect(onConnect).toHaveBeenCalled();
  });

  it("hides the pairing action once an agent can host the run", () => {
    render(
      <GuidedImportCard
        account={account}
        plan={plan([seg()])}
        agent="ready"
        pairing={{ phase: "paired", confirmationCode: null, onConnect: vi.fn(), onRetry: vi.fn() }}
      />,
    );
    expect(screen.queryByTestId("agent-pairing")).toBeNull();
  });

  /**
   * The seller works in the SmartStore window from here on, so the card must not tell them to watch this one.
   * The old copy did, and the result was an operator alternating between two tabs and missing the tab that
   * mattered.
   */
  it("sends the seller to the marketplace window and does not ask them to come back", async () => {
    vi.spyOn(api, "launchNextReviewImportSegment").mockResolvedValue(SEGMENT_LAUNCH);
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />);

    await userEvent.click(screen.getByTestId("guided-import-cta"));
    await waitFor(() => expect(screen.getByTestId("guided-run-started")).toBeInTheDocument());
    const text = screen.getByTestId("guided-run-started").textContent ?? "";
    // The agent raises that window itself when the run starts, so the copy says it is up rather than asking the
    // seller to go and find it.
    expect(text).toMatch(/판매자센터 창을 띄웠어요/);
    expect(text).toMatch(/돌아오지 않아도/);
    expect(text).not.toMatch(/이동해 주세요/);
  });
});

describe("GuidedImportCard — a launch ticket is never wasted", () => {
  /** Connect first: a refused attach after minting leaves an unspent authorization the seller must wait out. */
  it("does not mint a ticket when no agent can host the run", async () => {
    const mint = vi.spyOn(api, "launchNextReviewImportSegment");
    // An injected runtime models an attached agent, so the refusal is modelled by withholding it: the card
    // falls back to the real hook, which cannot reach a bridge in jsdom.
    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" />);
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(screen.getByTestId("agent-unavailable")).toBeInTheDocument());
    expect(mint).not.toHaveBeenCalled();
  });

  it("hands the ticket back when the agent refuses START_RUN", async () => {
    vi.spyOn(api, "launchNextReviewImportSegment").mockResolvedValue(SEGMENT_LAUNCH);
    const expire = vi.spyOn(api, "expireReviewImportLaunch").mockResolvedValue({
      ...SEGMENT_LAUNCH,
      status: "EXPIRED",
    });
    const fake = fakeRuntime({ startRejects: new Error("INVALID_FOR_STATE") });

    render(<GuidedImportCard account={account} plan={plan([seg()])} agent="ready" runtime={fake.runtime} />);
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(expire).toHaveBeenCalledWith(SEGMENT_LAUNCH.launchRef));
    expect(screen.getByRole("alert")).toHaveTextContent(/시작하지 못했어요/);
    expect(screen.queryByTestId("guided-run-started")).toBeNull();
  });
});
