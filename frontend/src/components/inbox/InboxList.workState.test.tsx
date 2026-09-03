// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { InboxList, isOldBacklog, rowState } from "./InboxList";
import type { FeedItem } from "../../lib/types";

const daysAgo = (n: number) => new Date(Date.now() - n * 86_400_000).toISOString();
const item = (id: string, over: Partial<FeedItem>): FeedItem => ({
  id, type: "INQUIRY", channelNameKo: "카페24 자사몰", productName: "상품 미지정", snippet: `문의 ${id}`, rating: null, status: "UNANSWERED", receivedAt: daysAgo(1), ...over,
});

describe("문의 목록 — work-state first (docs/reviewnary_design.md §7)", () => {
  // CONTRACT CHANGED (Operational Workspace UX System v1). This used to read "the state word comes
  // from the work item's PHASE before the feed's status", and that was the defect: `PROPOSED` is
  // written when a proposal is recorded, a proposal stores no reply text, and eight of the demo org's
  // ten 「초안 준비됨」 rows had no draft. The word now needs the draft's own answer.
  it("초안 준비됨 needs a draft, not a phase", () => {
    expect(rowState(item("a", {}), true)).toEqual({ text: "초안 준비됨", tone: "info" });
    expect(rowState(item("a", {}), false)).toEqual({ text: "답변 필요", tone: "warn" });
    expect(rowState(item("a", { status: "ANSWERED" }), false)).toEqual({ text: "답변함", tone: "neutral" });
    expect(rowState(item("r", { type: "REVIEW", status: "NEGATIVE", rating: 1 }), false)).toEqual({ text: "확인 필요", tone: "bad" });
  });

  it("an answered inquiry never claims a draft is waiting", () => {
    // hasDraft is true and the customer already has their answer: the row is a record, not work.
    expect(rowState(item("a", { status: "ANSWERED" }), true)).toEqual({ text: "답변함", tone: "neutral" });
  });

  it("old open work sits under its own divider, after recent open work and before settled rows", () => {
    const rows = [
      item("old", { receivedAt: daysAgo(500) }),
      item("done", { status: "ANSWERED", receivedAt: daysAgo(2) }),
      item("new", { receivedAt: daysAgo(1) }),
    ];
    render(
      <MemoryRouter>
        <InboxList items={rows} selectedId={null} basePath="/inquiries" showType={false} />
      </MemoryRouter>,
    );
    const list = screen.getByLabelText("문의 목록");
    const texts = Array.from(list.querySelectorAll("li")).map((li) => li.textContent ?? "");
    expect(isOldBacklog(rows[0])).toBe(true);
    expect(texts[0]).toContain("문의 new");
    expect(texts[1]).toContain("1년 넘게 지난 답변 필요 문의 1건");
    expect(texts[2]).toContain("문의 old");
    // The work ends and the record begins, and the list says so rather than running them together.
    expect(texts[3]).toContain("답변한 문의 1건");
    expect(texts[4]).toContain("문의 done");
    // The divider is not a heading — the detail pane keeps the only h2 on the screen.
    expect(within(list).queryByRole("heading")).toBeNull();
  });

  it("the rail drops the product name — the detail beside it already says it", () => {
    const rows = [item("a", { productName: "선바로 몰딩" })];
    const { rerender } = render(
      <MemoryRouter>
        <InboxList items={rows} selectedId={null} showType={false} />
      </MemoryRouter>,
    );
    expect(screen.getByText(/선바로 몰딩/)).toBeInTheDocument();
    rerender(
      <MemoryRouter>
        <InboxList items={rows} selectedId="a" showType={false} dense />
      </MemoryRouter>,
    );
    expect(screen.queryByText(/선바로 몰딩/)).toBeNull();
  });
});
