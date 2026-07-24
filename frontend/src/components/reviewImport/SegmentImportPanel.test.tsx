// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { SegmentImportPanel } from "./SegmentImportPanel";
import { api } from "../../lib/apiClient";
import type { ReviewImportSegmentView } from "../../lib/types";

const segment: ReviewImportSegmentView = {
  id: "seg-1",
  ordinal: 0,
  segmentStart: "2026-03-01",
  segmentEnd: "2026-03-31",
  executionState: "PENDING",
  coverageState: "UNVERIFIED",
  coveredRows: null,
  rowsReconciled: false,
  superseded: false,
  parentSegmentId: null,
};

afterEach(() => {
  cleanup();
  vi.restoreAllMocks();
});

function chooseFile() {
  const input = screen.getByLabelText("내보낸 리뷰 파일") as HTMLInputElement;
  const file = new File(["x"], "export.xlsx", { type: "text/csv" });
  fireEvent.change(input, { target: { files: [file] } });
  return file;
}

describe("SegmentImportPanel — the scope-confirmation gate", () => {
  it("keeps the import button disabled until scope is confirmed AND a file is chosen", () => {
    render(<SegmentImportPanel segment={segment} onImported={() => {}} />);
    const button = screen.getByRole("button", { name: "이 구간 가져오기" });
    expect(button).toBeDisabled();

    chooseFile();
    expect(button).toBeDisabled(); // file alone is not enough — scope must be confirmed

    fireEvent.click(screen.getByRole("checkbox"));
    expect(button).toBeEnabled();
  });

  it("shows the exact planned range and never suggests an automatic click", () => {
    render(<SegmentImportPanel segment={segment} onImported={() => {}} />);
    expect(screen.getByText("2026-03-01 ~ 2026-03-31")).toBeInTheDocument();
    expect(screen.getByText(/자동 클릭 없음/)).toBeInTheDocument();
  });

  it("uploads with scopeConfirmed=true and refreshes on success", async () => {
    const spy = vi.spyOn(api, "importReviewImportSegment").mockResolvedValue({
      attemptNo: 1,
      result: "SUCCEEDED",
      syncJobId: "job-1",
      scopeConfirmed: true,
      rowsNew: 5,
      rowsDuplicate: 0,
      rowsFailed: 0,
      errorMessage: null,
      startedAt: null,
      finishedAt: null,
    });
    const onImported = vi.fn();
    render(<SegmentImportPanel segment={segment} onImported={onImported} />);

    const file = chooseFile();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "이 구간 가져오기" }));

    await waitFor(() => expect(spy).toHaveBeenCalledWith("seg-1", true, file));
    await waitFor(() => expect(onImported).toHaveBeenCalled());
  });

  it("surfaces a failure without claiming success", async () => {
    vi.spyOn(api, "importReviewImportSegment").mockRejectedValue(new Error("boom"));
    const onImported = vi.fn();
    render(<SegmentImportPanel segment={segment} onImported={onImported} />);

    chooseFile();
    fireEvent.click(screen.getByRole("checkbox"));
    fireEvent.click(screen.getByRole("button", { name: "이 구간 가져오기" }));

    await waitFor(() => expect(screen.getByRole("alert")).toBeInTheDocument());
    expect(onImported).not.toHaveBeenCalled();
  });
});
