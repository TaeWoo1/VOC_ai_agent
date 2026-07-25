// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { GuidedImportCard } from "./GuidedImportCard";
import { api } from "../../lib/apiClient";
import type {
  ReviewImportPlanDetailView,
  ReviewImportSegmentView,
  SellerAccountResponse,
} from "../../lib/types";

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

    render(<GuidedImportCard account={account} plan={null} agent="ready" />);
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(discovery).toHaveBeenCalledWith("acc-1"));
    expect(next).not.toHaveBeenCalled();
  });

  it("with a plan in progress it resumes the next segment instead of re-discovering", async () => {
    const next = vi.spyOn(api, "launchNextReviewImportSegment").mockResolvedValue({
      launchRef: "9a8b7c6d5e4f3021", kind: "SEGMENT", status: "ISSUED", planId: "plan-1", segmentId: "s2",
      requiredStart: "2026-04-01", requiredEnd: "2026-04-30", discoveredStart: null, discoveredEnd: null,
      rangeEvidence: null,
    });
    const discovery = vi.spyOn(api, "startReviewImportDiscovery");

    render(
      <GuidedImportCard
        account={account}
        plan={plan([seg({ executionState: "COMPLETED", coverageState: "COVERED" }), seg({ id: "s2", segmentStart: "2026-04-01", segmentEnd: "2026-04-30" })])}
        agent="ready"
      />,
    );
    expect(screen.getByTestId("guided-import-cta")).toHaveTextContent("계속 가져오기");
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(next).toHaveBeenCalledWith("plan-1"));
    expect(discovery).not.toHaveBeenCalled();
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
    render(<GuidedImportCard account={account} plan={null} agent="ready" />);
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
    const { container } = render(<GuidedImportCard account={account} plan={null} agent="ready" />);
    await userEvent.click(screen.getByTestId("guided-import-cta"));

    await waitFor(() => expect(screen.getByTestId("guided-run-started")).toBeInTheDocument());
    // it authorizes action against a live marketplace — it is a credential, not a status line
    expect(container.textContent).not.toContain(ref);
  });
});
