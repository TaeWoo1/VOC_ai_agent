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
  const runtime: GuidedImportRuntime = {
    snapshot: () => snapshot,
    subscribe(listener) {
      listeners.add(listener);
      return () => listeners.delete(listener);
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
  return { runtime, starts, sent, publish, attach: opts.attach ?? true };
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
  it("offers the full import before any plan exists, and asks for no period", async () => {
    render(<GuidedImportCard account={account} plan={null} agent="ready" />);
    expect(screen.getByTestId("guided-import-cta")).toHaveTextContent("과거 리뷰 전체 연동하기");
    // the seller is never asked to choose a historical period — discovery finds it
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.queryByLabelText(/시작일|기간/)).toBeNull();
  });

  it("starting with no plan runs DISCOVERY (there is no plan to resume yet)", async () => {
    const discovery = vi.spyOn(api, "startReviewImportDiscovery").mockResolvedValue({
      launchRef: "0f1e2d3c4b5a6978", kind: "DISCOVERY", status: "ISSUED", planId: null, segmentId: null,
      requiredStart: null, requiredEnd: null, discoveredStart: null, discoveredEnd: null, rangeEvidence: null,
    });
    const next = vi.spyOn(api, "launchNextReviewImportSegment");
    const fake = fakeRuntime();

    render(<GuidedImportCard account={account} plan={null} agent="ready" runtime={fake.runtime} />);
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(discovery).toHaveBeenCalledWith("acc-1"));
    expect(next).not.toHaveBeenCalled();
    // The ticket is not merely minted — it is bound to a real run on the agent.
    expect(fake.starts).toEqual([{ launchRef: "0f1e2d3c4b5a6978", kind: "DISCOVERY" }]);
  });

  it("with a plan in progress it resumes the next segment instead of re-discovering", async () => {
    const next = vi.spyOn(api, "launchNextReviewImportSegment").mockResolvedValue({
      launchRef: "9a8b7c6d5e4f3021", kind: "SEGMENT", status: "ISSUED", planId: "plan-1", segmentId: "s2",
      requiredStart: "2026-04-01", requiredEnd: "2026-04-30", discoveredStart: null, discoveredEnd: null,
      rangeEvidence: null,
    });
    const discovery = vi.spyOn(api, "startReviewImportDiscovery");
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
    expect(discovery).not.toHaveBeenCalled();
    expect(fake.starts).toEqual([{ launchRef: "9a8b7c6d5e4f3021", kind: "SEGMENT" }]);
  });

  it("shows progress, the allowed range, and the next segment — not segment management", () => {
    render(
      <GuidedImportCard
        account={account}
        plan={plan([seg({ executionState: "COMPLETED", coverageState: "COVERED" }), seg({ id: "s2", segmentStart: "2026-04-01", segmentEnd: "2026-04-30" })])}
        agent="ready"
      />,
    );
    expect(screen.getByTestId("import-progress")).toHaveTextContent("2개 구간 중 1개 완료");
    expect(screen.getByTestId("discovered-range")).toHaveTextContent("2026-03-01 ~ 2026-04-30");
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
    render(<GuidedImportCard account={account} plan={null} agent={agent} />);
    expect(screen.getByTestId("agent-unavailable")).toHaveTextContent(pattern);
    expect(screen.getByTestId("guided-import-cta")).toBeDisabled();
  });

  it("offers the manual file path ONLY when a guided run cannot happen", () => {
    const onUseFileFallback = vi.fn();
    const { rerender } = render(
      <GuidedImportCard account={account} plan={null} agent="ready" onUseFileFallback={onUseFileFallback} />,
    );
    expect(screen.queryByTestId("file-fallback-link")).toBeNull();

    rerender(
      <GuidedImportCard account={account} plan={null} agent="not_running" onUseFileFallback={onUseFileFallback} />,
    );
    expect(screen.getByTestId("file-fallback-link")).toHaveTextContent("파일로 가져오기");
  });

  it("surfaces a launch failure instead of leaving the button looking successful", async () => {
    vi.spyOn(api, "startReviewImportDiscovery").mockRejectedValue(new Error("boom"));
    render(<GuidedImportCard account={account} plan={null} agent="ready" runtime={fakeRuntime().runtime} />);
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
    vi.spyOn(api, "startReviewImportDiscovery").mockResolvedValue({
      launchRef: ref, kind: "DISCOVERY", status: "ISSUED", planId: null, segmentId: null,
      requiredStart: null, requiredEnd: null, discoveredStart: null, discoveredEnd: null, rangeEvidence: null,
    });
    const fake = fakeRuntime();
    const { container } = render(
      <GuidedImportCard account={account} plan={null} agent="ready" runtime={fake.runtime} />,
    );
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(screen.getByTestId("guided-run-started")).toBeInTheDocument());
    // it authorizes action against a live marketplace — it is a credential, not a status line
    expect(container.textContent).not.toContain(ref);
  });
});

/* ─────────────── the run itself, once the agent is driving it ─────────────── */

const DISCOVERY_LAUNCH = {
  launchRef: "0f1e2d3c4b5a6978", kind: "DISCOVERY" as const, status: "ISSUED" as const, planId: null,
  segmentId: null, requiredStart: null, requiredEnd: null, discoveredStart: null, discoveredEnd: null,
  rangeEvidence: null,
};

describe("GuidedImportCard — it renders what the runtime publishes", () => {
  it("shows the current step from the runtime's own copy key and counter", async () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={null} agent="ready" runtime={fake.runtime} />);

    act(() => {
      fake.publish({
        intent: "INITIAL_REVIEW_IMPORT_DISCOVERY",
        step: {
          stepNumber: 3,
          totalSteps: 5,
          copyKey: "actionWindow.importDiscovery.setEarliest",
          copyParams: { targetKind: "start_date" },
          status: "AWAITING_USER",
        },
      });
    });

    expect(screen.getByTestId("guided-step-count")).toHaveTextContent("5단계 중 3");
    expect(screen.getByTestId("guided-run-progress")).toHaveTextContent(/가장 이전 날짜/);
    // The dotted key itself is never shown to the seller — the FE owns every word.
    expect(screen.getByTestId("guided-run-progress").textContent).not.toContain("actionWindow.");
  });

  it("shows the window a segment run is asking for, so a highlighted date field is not a guess", async () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={null} agent="ready" runtime={fake.runtime} />);

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
    render(<GuidedImportCard account={account} plan={null} agent="ready" runtime={fake.runtime} />);

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
    render(<GuidedImportCard account={account} plan={null} agent="ready" runtime={fake.runtime} />);

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
    render(<GuidedImportCard account={account} plan={null} agent="ready" runtime={fake.runtime} />);
    act(() => fake.publish({ allowedCommands: [] }));
    expect(screen.getByTestId("guided-run-commands")).toBeEmptyDOMElement();
  });

  it("hides the CTA while a run is in flight, so one seller cannot start two", async () => {
    const fake = fakeRuntime();
    render(<GuidedImportCard account={account} plan={null} agent="ready" runtime={fake.runtime} />);
    act(() => fake.publish({ status: "WAITING_FOR_HUMAN" }));
    expect(screen.queryByTestId("guided-import-cta")).toBeNull();
  });

  it("re-reads the plan once when a run reaches a terminal state", async () => {
    const onRunSettled = vi.fn();
    const fake = fakeRuntime();
    render(
      <GuidedImportCard account={account} plan={null} agent="ready" runtime={fake.runtime} onRunSettled={onRunSettled} />,
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

describe("GuidedImportCard — a launch ticket is never wasted", () => {
  /** Connect first: a refused attach after minting leaves an unspent authorization the seller must wait out. */
  it("does not mint a ticket when no agent can host the run", async () => {
    const discovery = vi.spyOn(api, "startReviewImportDiscovery");
    const fake = fakeRuntime();
    // An injected runtime models an attached agent, so the refusal is modelled by withholding it: the card
    // falls back to the real hook, which cannot reach a bridge in jsdom.
    render(<GuidedImportCard account={account} plan={null} agent="ready" />);
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(screen.getByTestId("agent-unavailable")).toBeInTheDocument());
    expect(discovery).not.toHaveBeenCalled();
    expect(fake.starts).toEqual([]);
  });

  it("hands the ticket back when the agent refuses START_RUN", async () => {
    vi.spyOn(api, "startReviewImportDiscovery").mockResolvedValue(DISCOVERY_LAUNCH);
    const expire = vi.spyOn(api, "expireReviewImportLaunch").mockResolvedValue({
      ...DISCOVERY_LAUNCH,
      status: "EXPIRED",
    });
    const fake = fakeRuntime({ startRejects: new Error("INVALID_FOR_STATE") });

    render(<GuidedImportCard account={account} plan={null} agent="ready" runtime={fake.runtime} />);
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(expire).toHaveBeenCalledWith(DISCOVERY_LAUNCH.launchRef));
    expect(screen.getByRole("alert")).toHaveTextContent(/시작하지 못했어요/);
    expect(screen.queryByTestId("guided-run-started")).toBeNull();
  });
});
