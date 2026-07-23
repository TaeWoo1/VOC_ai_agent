// @vitest-environment jsdom
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { render, screen, waitFor } from "@testing-library/react";
import { ImportHistoryList } from "./ImportHistoryList";
import { api } from "../../lib/apiClient";
import type { ReviewImport } from "../../lib/types";

// The seller's own record of what their imports brought. Two properties matter beyond rendering:
// a failed READ must never read as "you have never imported", and history must survive a remount —
// the exact property the previous in-memory activity rail failed.

function anImport(over: Partial<ReviewImport> = {}): ReviewImport {
  return {
    id: `import-${Math.random()}`,
    method: "SELLER_CENTER_EXPORT",
    status: "SUCCESS",
    totalRows: 6,
    successRows: 6,
    skippedRows: 0,
    failedRows: 0,
    startedAt: "2026-05-10T00:00:00Z",
    finishedAt: "2026-05-10T00:00:05Z",
    ...over,
  };
}

beforeEach(() => {
  vi.restoreAllMocks();
});
afterEach(() => {
  vi.restoreAllMocks();
});

describe("ImportHistoryList", () => {
  it("shows what each import brought, with its provenance", async () => {
    vi.spyOn(api, "getReviewImportsStrict").mockResolvedValue([
      anImport({ successRows: 6 }),
      anImport({ method: "MANUAL_UPLOAD", successRows: 2, skippedRows: 4 }),
    ]);

    render(<ImportHistoryList />);

    expect(await screen.findByText("새 리뷰 6건")).toBeInTheDocument();
    expect(screen.getByText("새 리뷰 2건")).toBeInTheDocument();
    // Scoped to the ROWS: the section's own sub-heading names both acquisition paths, so a
    // document-wide text query would match the heading and pass without any row rendering.
    const rows = screen.getAllByTestId("import-history-row");
    expect(rows[0]).toHaveTextContent("셀러센터 내보내기");
    expect(rows[1]).toHaveTextContent("직접 업로드 · 중복 4건");
  });

  it("shows an empty export and an all-duplicate import as the distinct successes they are", async () => {
    vi.spyOn(api, "getReviewImportsStrict").mockResolvedValue([
      anImport({ successRows: 0, skippedRows: 0, totalRows: 0 }),
      anImport({ successRows: 0, skippedRows: 6, totalRows: 6 }),
    ]);

    render(<ImportHistoryList />);

    // Neither is hidden, neither reads as a failure, and they do not collapse into one sentence.
    expect(await screen.findByText("새 리뷰 없음")).toBeInTheDocument();
    expect(screen.getByText("새로 추가된 리뷰 없음")).toBeInTheDocument();
  });

  it("shows partial, failed and running imports rather than omitting them", async () => {
    vi.spyOn(api, "getReviewImportsStrict").mockResolvedValue([
      anImport({ status: "PARTIAL", successRows: 4, failedRows: 2 }),
      anImport({ status: "FAILED", successRows: 0, failedRows: 3 }),
      anImport({ status: "RUNNING", successRows: 0, totalRows: 0, finishedAt: null }),
    ]);

    render(<ImportHistoryList />);

    expect(await screen.findByText(/일부만 저장됐어요/)).toBeInTheDocument();
    expect(screen.getByText("가져오지 못했어요")).toBeInTheDocument();
    // An unfinalized row never claims progress — nothing polls, so "진행 중" would keep saying a
    // days-old crashed import is still running.
    expect(screen.getByText("완료되지 않았어요")).toBeInTheDocument();
    expect(screen.getAllByTestId("import-history-row")).toHaveLength(3);
  });

  it("says 방식 미상 for a row older than the provenance column", async () => {
    vi.spyOn(api, "getReviewImportsStrict").mockResolvedValue([anImport({ method: null })]);

    render(<ImportHistoryList />);

    expect(await screen.findByText(/방식 미상/)).toBeInTheDocument();
  });

  it("a FAILED read is an ERROR, never the calm empty state", async () => {
    // THE FAIL-CLOSED RULE. "아직 가져온 리뷰가 없어요" is a claim about the seller's history; saying
    // it when the read simply failed is a reassuring lie about their own work.
    vi.spyOn(api, "getReviewImportsStrict").mockRejectedValue(new Error("backend down"));

    render(<ImportHistoryList />);

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(screen.getByRole("alert")).toHaveTextContent(/불러오지 못했어요/);
    expect(screen.queryByText(/아직 가져온 리뷰가 없어요/)).not.toBeInTheDocument();
    expect(screen.queryAllByTestId("import-history-row")).toHaveLength(0);
  });

  it("an operator who has never imported sees a calm empty state, distinct from the error", async () => {
    vi.spyOn(api, "getReviewImportsStrict").mockResolvedValue([]);

    render(<ImportHistoryList />);

    expect(await screen.findByText(/아직 가져온 리뷰가 없어요/)).toBeInTheDocument();
    expect(screen.queryByRole("alert")).not.toBeInTheDocument();
  });

  it("SURVIVES A REMOUNT — the property the in-memory rail failed", async () => {
    // The old activity rail lived in the operations store, so a reload started it empty and
    // yesterday's import left no trace. History is a read, so a fresh mount sees it again.
    const spy = vi.spyOn(api, "getReviewImportsStrict").mockResolvedValue([anImport({ successRows: 6 })]);

    const first = render(<ImportHistoryList />);
    expect(await screen.findByText("새 리뷰 6건")).toBeInTheDocument();
    first.unmount();

    render(<ImportHistoryList />);

    expect(await screen.findByText("새 리뷰 6건")).toBeInTheDocument();
    expect(spy).toHaveBeenCalledTimes(2); // re-read on mount, not replayed from memory
  });

  it("asks for a bounded page — this is recent history, not an archive", async () => {
    const spy = vi.spyOn(api, "getReviewImportsStrict").mockResolvedValue([]);

    render(<ImportHistoryList />);

    await waitFor(() => expect(spy).toHaveBeenCalled());
    // A bound the test actually checks — "is a number" passes for 1_000_000.
    const requested = spy.mock.calls[0]?.[0] as number;
    expect(requested).toBeGreaterThan(0);
    expect(requested).toBeLessThanOrEqual(20);
    expect(screen.getByRole("heading", { name: "최근 가져오기 기록" })).toBeInTheDocument();
  });
});
