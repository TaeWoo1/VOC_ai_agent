// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { WorkRows } from "./WorkRows";
import { REASON } from "../../lib/copy/customerOps";
import type { HomeWorkRow } from "../../lib/homeWork";

const NOW = new Date("2026-09-25T05:30:00Z"); // 14:30 KST

function row(over: Partial<HomeWorkRow> = {}): HomeWorkRow {
  return {
    key: "review:r-1",
    reason: REASON.review,
    // `sourceLabel` stops composing the star for these lists — the row carries `rating` on its own.
    source: "쿠팡 리뷰",
    // The two halves the caption composes from, carried beside the composed label exactly as production does.
    channel: "쿠팡",
    title: "사진이랑 색이 조금 달라요.",
    line: "바닥용 평면 몰딩",
    since: "2026-09-13",
    to: "/reviews/reply/r-1",
    owner: "/reviews/reply/r-1",
    caseId: null,
    verb: "확인",
    kind: "REVIEW",
    subject: "REVIEW",
    subjectId: "r-1",
    workItemId: null,
    rating: 1,
    ...over,
  };
}

function draw(rows: HomeWorkRow[], props: Partial<Parameters<typeof WorkRows>[0]> = {}) {
  return render(
    <MemoryRouter>
      <WorkRows rows={rows} selectedKey={null} wide={false} search="" now={NOW} ariaLabel="확인할 일" dense {...props} />
    </MemoryRouter>,
  );
}

/**
 * <b>Reference-based hierarchy v1.</b> Measured at 1440×900 before this: every one of the five rows printed
 * 「리뷰」 in a badge and 「쿠팡 리뷰 ★1」 beside it — the same two facts drawn ten times down a list whose content
 * is what the customers wrote — and the wait, the key this list is ORDERED by, had been given a column of its
 * own on the left. Put beside Linear's Triage list and Intercom's Inbox, both of which draw a work row as
 * content-left / metadata-right with nothing between, that third column is what makes a list read as a table.
 */
describe("WorkRows — what every row says identically is a fact about the list", () => {
  it("lifts the shared reason, source and rating off the rows and says them once", () => {
    draw([row(), row({ key: "review:r-2", subjectId: "r-2", title: "재단하다가 모서리가 깨졌습니다." })]);
    // Not on the rows…
    const list = screen.getByLabelText("확인할 일");
    expect(within(list).queryByText("리뷰")).toBeNull();
    expect(within(list).queryByText(/쿠팡 리뷰/)).toBeNull();
    expect(within(list).queryByText("★1")).toBeNull();
    // …once above them, composed from the channel, the star and the noun as one phrase — never by taking the
    // row's own composed `source` apart (product-owner decision, 2026-09-26).
    expect(screen.getByText("모두 쿠팡 ★1 리뷰")).toBeTruthy();
    // What actually differs stays on the row.
    expect(screen.getAllByText("바닥용 평면 몰딩")).toHaveLength(2);
  });

  it("stays silent when the screen's own heading already says it", () => {
    draw([row(), row({ key: "review:r-2", subjectId: "r-2" })], { captionSaysReason: true });
    expect(screen.queryByText(/^모두 /)).toBeNull();
    expect(screen.queryByText("리뷰")).toBeNull();
  });

  it("keeps every fact on the row when the rows differ — there they ARE the distinction", () => {
    draw([
      row(),
      row({ key: "inquiry:i-1", subjectId: "i-1", kind: "INQUIRY", subject: "INQUIRY", reason: REASON.reply, source: "카페24 문의", title: "주문 취소 가능할까요?", rating: null }),
    ]);
    expect(screen.getByText("리뷰")).toBeTruthy();
    expect(screen.getByText("답변 필요")).toBeTruthy();
    expect(screen.getByText(/쿠팡 리뷰/)).toBeTruthy();
    expect(screen.getByText("★1")).toBeTruthy();
    expect(screen.queryByText(/^모두 /)).toBeNull();
  });

  it("only lifts a fact that is true of the population the caption covers", () => {
    // Five drawn out of a list of six; the sixth is a different kind, so the heading above cannot say 「모두」.
    const drawn = [row(), row({ key: "review:r-2", subjectId: "r-2" })];
    draw(drawn, {
      sharedOver: [
        ...drawn,
        row({ key: "inquiry:i-9", subjectId: "i-9", kind: "INQUIRY", subject: "INQUIRY", reason: REASON.reply, source: "카페24 문의", rating: null }),
      ],
    });
    expect(screen.queryByText(/^모두 /)).toBeNull();
    expect(screen.getAllByText(/쿠팡 리뷰/)).toHaveLength(2);
  });

  it("puts the metadata on the right of a dense row, after the sentence — not in a column before it", () => {
    draw([row({ reason: REASON.reply, source: "카페24 문의", rating: null })]);
    const item = within(screen.getByLabelText("확인할 일")).getAllByRole("listitem")[0];
    const title = within(item).getByText("사진이랑 색이 조금 달라요.");
    const wait = within(item).getByText("12일 대기");
    expect(title.compareDocumentPosition(wait) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
  });

  it("keeps the three-line reading exactly as it was — nothing about it moved", () => {
    draw([row()], { dense: false });
    const item = within(screen.getByLabelText("확인할 일")).getAllByRole("listitem")[0];
    const wait = within(item).getByText("12일 대기");
    const title = within(item).getByText("사진이랑 색이 조금 달라요.");
    expect(title.compareDocumentPosition(wait) & Node.DOCUMENT_POSITION_FOLLOWING).toBeTruthy();
    // The tile and the badge are the row's own there, whatever the list shares.
    expect(within(item).getByText("리뷰")).toBeTruthy();
  });
});
