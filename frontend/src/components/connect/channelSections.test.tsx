// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen, within } from "@testing-library/react";
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

  function reviewRow() {
    const section = screen.getByText("수집 설정").closest("section") as HTMLElement;
    return within(section).getByText("리뷰").closest("div") as HTMLElement;
  }

  it("gates on the connector capability alone — an acquisition path is not a schedule", () => {
    // The acquisition axis added for #107 lives on the capability OVERVIEW; the rows themselves come
    // from `connector_capabilities` and are what decides whether a schedule may be turned on. Coupang
    // 상품평 arrive through an operator-confirmed Action Window, which is not a thing a cadence can
    // run, so REVIEW must stay disabled here exactly as before.
    wrap(
      <CollectionSettingsSection
        accountId="acct-1"
        schedules={[]}
        capabilities={REVIEW_UNSUPPORTED as never}
        onChanged={vi.fn()}
        onReport={vi.fn()}
      />,
    );
    expect(enabledButtonsIn(reviewRow())).toHaveLength(0);
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

  it("explains the operator-run route where one exists, and still schedules nothing", async () => {
    getChannelCapabilityOverview.mockResolvedValue({
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
          acquisitionPaths: [{ method: "ACTION_WINDOW", verificationStatus: "LIVE_PROVEN" }],
        },
      ],
      unsupportedScopes: [],
    });
    wrap(
      <CollectionSettingsSection
        accountId="acct-1"
        channelCode="COUPANG"
        schedules={[]}
        capabilities={REVIEW_UNSUPPORTED as never}
        onChanged={vi.fn()}
        onReport={vi.fn()}
      />,
    );
    expect(await screen.findByText(/Action Window는 판매자가 직접 실행하는/)).toBeInTheDocument();
    // The sentence is an explanation, never a gate: the row is exactly as unschedulable as before.
    expect(enabledButtonsIn(reviewRow())).toHaveLength(0);
  });

  it("stays silent about a route the channel has not got", async () => {
    // Read strictly to explain: a channel with no acquisition path must not inherit Coupang's
    // sentence, and a failed read must leave the row as it was.
    getChannelCapabilityOverview.mockRejectedValue(new Error("backend down"));
    wrap(
      <CollectionSettingsSection
        accountId="acct-1"
        channelCode="NAVER"
        schedules={[]}
        capabilities={REVIEW_UNSUPPORTED as never}
        onChanged={vi.fn()}
        onReport={vi.fn()}
      />,
    );
    expect(await screen.findByText("자동 수집 미지원")).toBeInTheDocument();
    expect(screen.queryByText(/Action Window/)).toBeNull();
    expect(enabledButtonsIn(reviewRow())).toHaveLength(0);
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
