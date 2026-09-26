// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { resolve } from "node:path";
import { render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { MasterDetail } from "./MasterDetail";

/**
 * <b>The preview pane's docked action is navigation, and is drawn as navigation</b> (product-owner decision,
 * 2026-09-26).
 *
 * <p>Nothing this control does is irreversible: it opens the screen that owns the object. It used to be a
 * full-bleed `brand-700` block, which made it the heaviest element in a 440px panel whose subject is the
 * customer's own sentence at 22px/800 — heavier than the sentence. Linear's Peek carries no action at all and
 * Intercom's Details rail ends where its rows end, so there is no reference for a primary commit button here.
 *
 * <p>Two things are pinned: how it is drawn, and that it follows the content instead of standing on the floor of
 * the column. The second is what makes a short preview end where its content ends.
 */
describe("the preview pane's one action", () => {
  const source = readFileSync(resolve(__dirname, "../customerOperations/CustomerOpsHome.tsx"), "utf8");

  it("is never solid and never says 처리하기", () => {
    // `solid` is reserved for «the thing this screen is for», and no screen is for pressing a link.
    expect(source).toContain('<BtnLink to={open.to} variant="outline"');
    expect(source).not.toContain('variant={open.primary');
    // 「처리 방법 미정」 stands ~150px above this button; one screen may not use 처리 as the noun for the
    // disposition and as the verb on the control beside it.
    expect(source).not.toContain("전체 화면에서 처리하기");
    expect(source).toContain('review: "전체 화면에서 판단하기"');
    expect(source).toContain('other: "전체 화면에서 열기"');
  });

  it("follows the content and pins only when the content runs past it — inside the one scroller", () => {
    render(
      <MemoryRouter>
        <MasterDetail
          preview
          list={<p>목록</p>}
          detail={<p>미리보기</p>}
          detailLabel="선택한 항목"
          wide
          paneFooter={<a href="/x">전체 화면에서 판단하기</a>}
        />
      </MemoryRouter>,
    );
    const footer = screen.getByTestId("pane-footer");
    // Sticky, not a `shrink-0` bar outside the scroll region: with no overflow it does not move, so a short
    // preview ends where its content ends instead of at the floor of the column.
    expect(footer.className).toContain("sticky");
    expect(footer.className).toContain("bottom-0");
    // …and it is INSIDE the scroller, which is what makes that true. One scroll region, not two.
    const scroller = footer.closest("[class*='overflow-y-auto']");
    expect(scroller).not.toBeNull();
    expect(scroller!.contains(screen.getByText("미리보기"))).toBe(true);
    // It draws its own surface, because content passes under it when there IS overflow.
    expect(footer.querySelector("[class*='bg-surface']")).not.toBeNull();
  });
});
