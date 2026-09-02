// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { AcquisitionResultArtifact } from "./AcquisitionResultArtifact";
import type { AcquisitionResultArtifact as AcquisitionResult } from "../../../lib/conversation/types";

const base: AcquisitionResult = {
  artifactId: "a-acquisition-naver", type: "ACQUISITION_RESULT", title: "네이버 리뷰 가져오기 결과", titleSaid: true,
  channelCode: "NAVER", channelNameKo: "네이버",
  periodStart: "2026-08-20", periodEnd: "2026-09-02",
  rowsNew: 115, rowsDuplicate: 33, rowsFailed: 0,
};

describe("acquisition result — the numbers are values, not a sentence", () => {
  it("renders the window and the tallies, and derives nothing from them", () => {
    render(<AcquisitionResultArtifact artifact={base} />);
    expect(screen.getByTestId("acquisition-period").textContent).toBe("8월 20일~9월 2일");
    const card = screen.getByTestId("acquisition-result");
    expect(card.textContent).toContain("115");
    expect(card.textContent).toContain("새로 들어옴");
    expect(card.textContent).toContain("33");
    expect(card.textContent).toContain("이미 있던 리뷰");
    // 115 + 33 is a third number nobody observed.
    expect(card.textContent).not.toContain("148");
    // A failure that did not happen is not a row to read.
    expect(card.textContent).not.toContain("못 읽음");
    // Not one internal word, and not one raw ISO date.
    expect(card.textContent).not.toMatch(/2026-|sync|run|segment|SUCCEEDED/i);
  });

  it("a failure gets its own figure", () => {
    render(<AcquisitionResultArtifact artifact={{ ...base, rowsFailed: 3 }} />);
    const card = screen.getByTestId("acquisition-result");
    expect(card.textContent).toContain("못 읽음");
    expect(card.textContent).toContain("3");
  });

  it("no window means no period clause — never a placeholder one", () => {
    render(<AcquisitionResultArtifact artifact={{ ...base, periodStart: null, periodEnd: null }} />);
    expect(screen.queryByTestId("acquisition-period")).toBeNull();
    const card = screen.getByTestId("acquisition-result");
    expect(card.textContent).not.toContain("0000-00-00");
    expect(card.textContent).not.toContain("9999-99-99");
    // The result itself is still readable.
    expect(card.textContent).toContain("115");
  });

  it("a tally the record does not hold renders nothing at all — never a zero we did not observe", () => {
    render(<AcquisitionResultArtifact artifact={{ ...base, rowsDuplicate: null, rowsFailed: null }} />);
    const card = screen.getByTestId("acquisition-result");
    expect(card.textContent).toContain("새로 들어옴");
    expect(card.textContent).not.toContain("이미 있던 리뷰");
    expect(card.textContent).not.toContain("못 읽음");
  });
});
