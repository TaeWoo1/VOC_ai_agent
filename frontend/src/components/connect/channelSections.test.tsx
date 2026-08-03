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

vi.mock("../../lib/apiClient", () => ({
  api: {
    putSchedule: vi.fn(),
    manualSync: vi.fn(),
    retryRun: vi.fn(),
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
