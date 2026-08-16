// @vitest-environment jsdom
import { beforeEach, describe, expect, it, vi } from "vitest";
import { act, render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { ChannelStatusSection } from "./ChannelStatusSection";
import { CollectionSettingsSection } from "./CollectionSettingsSection";
import { CollectionHistorySection } from "./CollectionHistorySection";
import { DATA_TYPES, nextActionFor } from "./channelShared";
import { expectNoAxeViolations } from "../../test/axe";
import type { ConnectionStatusView, SyncRunView } from "../../lib/types";

const getChannelCapabilityOverview = vi.fn(async (_code: string) => null as unknown);
vi.mock("../../lib/apiClient", () => ({
  api: {
    putSchedule: vi.fn(),
    manualSync: vi.fn(),
    retryRun: vi.fn(),
    getChannelCapabilityOverview: (code: string) => getChannelCapabilityOverview(code),
  },
  getToken: () => null,
}));

/**
 * The safety net the single-file 채널 상세 page never had.
 *
 * The Slice 6 decomposition moved these blocks verbatim; before it there were no tests on this
 * surface at all, so typecheck was the only thing standing between a transcription slip and a
 * live-verified connection flow. These assertions pin the states that matter: loading, failed, and
 * loaded are three DIFFERENT renders, and a failed read must never look like a healthy channel.
 */

const STATUS = {
  state: "HEALTHY",
  lastSyncedAt: "2026-08-03T00:00:00Z",
  nextScheduledAt: "2026-08-04T00:00:00Z",
  consecutiveFailures: 0,
  lastError: null,
} as unknown as ConnectionStatusView;

function wrap(ui: React.ReactElement) {
  return render(<MemoryRouter>{ui}</MemoryRouter>);
}

// Each capability-overview stub is scoped to its own test. Without this the last `mockResolvedValue`
// in the file becomes every later test's backend, and the suite silently depends on its own order.
beforeEach(() => {
  getChannelCapabilityOverview.mockReset();
  getChannelCapabilityOverview.mockResolvedValue(null);
});

describe("연결 상태 섹션", () => {
  it("shows the figures the server reported", () => {
    wrap(<ChannelStatusSection status={STATUS} loading={false} error={false} />);
    expect(screen.getByText("마지막 수집")).toBeInTheDocument();
    expect(screen.getByText("다음 자동 수집")).toBeInTheDocument();
    expect(screen.getByText("0회")).toBeInTheDocument();
  });

  it("keeps loading, failed and loaded as three distinct renders", () => {
    const { rerender } = wrap(
      <ChannelStatusSection status={null} loading={true} error={false} />,
    );
    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <ChannelStatusSection status={null} loading={false} error={true} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/연결 상태를 불러오지 못했습니다/)).toBeInTheDocument();
    // A failed read must not render as a healthy channel.
    expect(screen.queryByText("마지막 수집")).toBeNull();
  });

  it("surfaces the last failure the server reported", () => {
    wrap(
      <ChannelStatusSection
        status={{ ...STATUS, consecutiveFailures: 3, lastError: "인증이 만료되었습니다" } as ConnectionStatusView}
        loading={false}
        error={false}
      />,
    );
    expect(screen.getByText("3회")).toBeInTheDocument();
    expect(screen.getByText("인증이 만료되었습니다")).toBeInTheDocument();
  });

  it("has no axe violations", async () => {
    const { container } = wrap(
      <ChannelStatusSection status={STATUS} loading={false} error={false} />,
    );
    await expectNoAxeViolations(container);
  });
});

describe("수집 설정 섹션", () => {
  it("renders one row per data type", () => {
    wrap(
      <CollectionSettingsSection
        accountId="acct-1"
        schedules={[]}
        capabilities={null}
        onChanged={vi.fn()}
        onReport={vi.fn()}
      />,
    );
    const section = screen.getByText("수집 설정").closest("section") as HTMLElement;
    for (const type of DATA_TYPES) {
      expect(within(section).getByText(type.label)).toBeInTheDocument();
    }
  });

  const REVIEW_UNSUPPORTED = [
    {
      channelCode: "COUPANG",
      connectorClass: "API",
      dataType: "REVIEW",
      supported: false,
      verificationStatus: "UNSUPPORTED",
      notes: null,
    },
  ];

  function enabledButtonsIn(row: HTMLElement) {
    return Array.from(row.querySelectorAll("button")).filter((b) => !b.hasAttribute("disabled"));
  }

  /**
   * The whole REVIEW row — the `<li>`, not the label's own div. The controls this section gates live
   * in a SIBLING of the label, so a locator that stops at the label returns a subtree with no buttons
   * in it and reports zero enabled controls whatever the row actually rendered.
   */
  function reviewRow(label = "리뷰") {
    const section = screen.getByText("수집 설정").closest("section") as HTMLElement;
    return within(section).getByText(label).closest("li") as HTMLElement;
  }

  it("gates on the connector capability alone — an acquisition path is not a schedule", () => {
    // The acquisition axis added for #107 lives on the capability OVERVIEW; the rows themselves come
    // from `connector_capabilities` and are what decides whether a schedule may be turned on. Coupang
    // 상품평 arrive through an operator-confirmed Action Window, which is not a thing a cadence can
    // run, so REVIEW must stay disabled here exactly as before.
    const { container } = wrap(
      <CollectionSettingsSection
        accountId="acct-1"
        schedules={[]}
        capabilities={REVIEW_UNSUPPORTED as never}
        onChanged={vi.fn()}
        onReport={vi.fn()}
      />,
    );
    // The cadence select and both action buttons are what "disabled" means here — assert they are
    // absent, not merely that some subtree has no enabled button.
    expect(reviewRow().querySelector("select")).toBeNull();
    expect(reviewRow().querySelectorAll("button")).toHaveLength(0);
    expect(enabledButtonsIn(reviewRow())).toHaveLength(0);
    // Without a channelCode there is no overview to read, so the section says nothing about routes.
    expect(container.textContent).not.toContain("Action Window");
  });

  it("says the cadence is unsupported, not the channel", async () => {
    // 이 채널 미지원 sat one scroll under a panel counting 22 collected 상품평 — both rendered from
    // true facts, and together they read as a contradiction. What this row can actually vouch for is
    // the cadence.
    wrap(
      <CollectionSettingsSection
        accountId="acct-1"
        schedules={[]}
        capabilities={REVIEW_UNSUPPORTED as never}
        onChanged={vi.fn()}
        onReport={vi.fn()}
      />,
    );
    expect(await screen.findByText("자동 수집 미지원")).toBeInTheDocument();
    expect(screen.queryByText("이 채널 미지원")).toBeNull();
  });

  /** An overview whose REVIEW carries exactly the given acquisition paths. */
  function overviewWithReviewPaths(paths: Array<{ method: string; verificationStatus: string }>) {
    return {
      channelCode: "COUPANG",
      channelNameKo: "쿠팡",
      connectorClass: "API",
      autoCollectSupported: true,
      dataTypes: [
        {
          dataType: "REVIEW",
          label: "리뷰",
          supported: false,
          verificationStatus: "UNSUPPORTED",
          acquisitionPaths: paths,
        },
      ],
      unsupportedScopes: [],
    };
  }

  function renderSection(channelCode?: string) {
    return wrap(
      <CollectionSettingsSection
        accountId="acct-1"
        channelCode={channelCode}
        schedules={[]}
        capabilities={REVIEW_UNSUPPORTED as never}
        onChanged={vi.fn()}
        onReport={vi.fn()}
      />,
    );
  }

  it("explains the operator-run route where one exists, and still schedules nothing", async () => {
    getChannelCapabilityOverview.mockResolvedValue(
      overviewWithReviewPaths([{ method: "ACTION_WINDOW", verificationStatus: "LIVE_PROVEN" }]),
    );
    renderSection("COUPANG");
    expect(await screen.findByText(/Action Window는 판매자가 직접 실행하는/)).toBeInTheDocument();
    // The sentence is an explanation, never a gate: the row still offers no cadence and no controls.
    // Coupang's row is labelled 상품평, the same word as the badge and the record panel.
    expect(reviewRow("상품평").querySelector("select")).toBeNull();
    expect(reviewRow("상품평").querySelectorAll("button")).toHaveLength(0);
  });

  it("says Action Window only about an Action Window", async () => {
    // The sentence names one route and describes how that route is run. A path with a different
    // method is a different story — a file export is not something the seller performs on the
    // marketplace — so the row must not narrate it with Action Window's words.
    getChannelCapabilityOverview.mockResolvedValue(
      overviewWithReviewPaths([{ method: "EXPORT", verificationStatus: "LIVE_PROVEN" }]),
    );
    renderSection("COUPANG");
    expect(await screen.findByText("자동 수집 미지원")).toBeInTheDocument();
    expect(screen.queryByText(/Action Window/)).toBeNull();
  });

  it("stays silent about a channel that has no acquisition path at all", async () => {
    // A successful read that returns no path — not a failure. The row must not inherit Coupang's
    // sentence just because it is also unschedulable.
    getChannelCapabilityOverview.mockResolvedValue(overviewWithReviewPaths([]));
    renderSection("NAVER");
    expect(await screen.findByText("자동 수집 미지원")).toBeInTheDocument();
    expect(screen.queryByText(/Action Window/)).toBeNull();
    expect(reviewRow().querySelectorAll("button")).toHaveLength(0);
  });

  it("drops the previous channel's route the moment the account changes", async () => {
    // `useApiData` keeps the last successful payload across a deps change, so between an account
    // switch and the new read landing, the OLD channel's overview is still in state. If the row read
    // it, a channel with no Action Window would be told it has one — a claim about the wrong channel,
    // which is the one thing "read strictly to explain" must not produce.
    let landNaver: (v: unknown) => void = () => {};
    const naverPending = new Promise((resolve) => {
      landNaver = resolve;
    });
    getChannelCapabilityOverview.mockImplementation((code: string) =>
      code === "COUPANG"
        ? Promise.resolve(
            overviewWithReviewPaths([{ method: "ACTION_WINDOW", verificationStatus: "LIVE_PROVEN" }]),
          )
        : naverPending,
    );
    const { rerender } = renderSection("COUPANG");
    await screen.findByText(/Action Window는 판매자가 직접 실행하는/);

    rerender(
      <MemoryRouter>
        <CollectionSettingsSection
          accountId="acct-2"
          channelCode="NAVER"
          schedules={[]}
          capabilities={REVIEW_UNSUPPORTED as never}
          onChanged={vi.fn()}
          onReport={vi.fn()}
        />
      </MemoryRouter>,
    );
    // NAVER's read has not landed, and Coupang's sentence is already gone.
    expect(screen.queryByText(/Action Window/)).toBeNull();
    await act(async () => {
      landNaver(overviewWithReviewPaths([]));
    });
    expect(screen.queryByText(/Action Window/)).toBeNull();
  });

  it("leaves the row as it was when the overview cannot be read", async () => {
    // Read strictly to explain: a failed read subtracts a sentence, never a control, and never
    // invents one.
    getChannelCapabilityOverview.mockRejectedValue(new Error("backend down"));
    renderSection("NAVER");
    expect(await screen.findByText("자동 수집 미지원")).toBeInTheDocument();
    expect(screen.queryByText(/Action Window/)).toBeNull();
    expect(reviewRow().querySelectorAll("button")).toHaveLength(0);
  });

  it("keeps controls disabled until capabilities are known", () => {
    // An absent capability row means "allowed" on the server, so the UI must not guess before the
    // list has loaded.
    const { container } = wrap(
      <CollectionSettingsSection
        accountId="acct-1"
        schedules={[]}
        capabilities={null}
        onChanged={vi.fn()}
        onReport={vi.fn()}
      />,
    );
    const enabled = Array.from(container.querySelectorAll("button")).filter(
      (b) => !b.hasAttribute("disabled"),
    );
    expect(enabled).toHaveLength(0);
  });
});

describe("수집 이력 섹션", () => {
  const run = {
    id: "run-1",
    dataType: "REVIEW",
    status: "SUCCESS",
    trigger: "SCHEDULED",
    startedAt: "2026-08-03T00:00:00Z",
    finishedAt: "2026-08-03T00:00:05Z",
  } as unknown as SyncRunView;

  it("keeps loading, failed, empty and loaded as four distinct renders", () => {
    const { rerender } = wrap(
      <CollectionHistorySection
        runs={[]}
        loading
        error={false}
        onChanged={vi.fn()}
        onReport={vi.fn()}
      />,
    );
    expect(screen.getByText("불러오는 중…")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <CollectionHistorySection
          runs={[]}
          loading={false}
          error
          onChanged={vi.fn()}
          onReport={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.getByText(/수집 이력을 불러오지 못했습니다/)).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <CollectionHistorySection
          runs={[]}
          loading={false}
          error={false}
          onChanged={vi.fn()}
          onReport={vi.fn()}
        />
      </MemoryRouter>,
    );
    // "No history yet" and "could not read" are different sentences on purpose.
    expect(screen.getByText("아직 수집 이력이 없습니다.")).toBeInTheDocument();

    rerender(
      <MemoryRouter>
        <CollectionHistorySection
          runs={[run]}
          loading={false}
          error={false}
          onChanged={vi.fn()}
          onReport={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByText("아직 수집 이력이 없습니다.")).toBeNull();
  });
});

describe("다음 조치 결정", () => {
  it("is derived from the connection status, not from the catalog", () => {
    // Preserved verbatim through the decomposition; this pins that it still resolves.
    const action = nextActionFor(STATUS);
    expect(action).toBeTruthy();
    expect(typeof action.title).toBe("string");
  });
});
