// @vitest-environment jsdom
/**
 * Working Context v1 §1 — the bar renders the object and offers the one way out of it. 「해제」 is a
 * real state change, so it must reach the provider; a bar that could only stop drawing itself would
 * leave the next turn anchored on something the seller believes they released.
 */
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { MemoryRouter } from "react-router-dom";
import { ContextBar } from "./ContextBar";
import type { CurrentContext } from "../../lib/conversation/currentContext";

const anchor: CurrentContext = {
  kind: "ANCHOR", label: "현금영수증 발행 부탁드립니다", meta: "네이버 스마트스토어 · 실리콘 몰딩 2호",
  task: "답변 준비 중", to: "/inquiries/i-1", clearable: true,
};

describe("ContextBar", () => {
  it("names the object, where it came from and the step in flight, and releases it on 「해제」", async () => {
    const onClear = vi.fn();
    render(<MemoryRouter><ContextBar context={anchor} onClear={onClear} /></MemoryRouter>);
    expect(screen.getByTestId("context-bar-label")).toHaveTextContent("현금영수증 발행 부탁드립니다");
    expect(screen.getByTestId("context-bar-label")).toHaveAttribute("href", "/inquiries/i-1");
    expect(screen.getByTestId("context-bar")).toHaveTextContent("네이버 스마트스토어 · 실리콘 몰딩 2호");
    expect(screen.getByTestId("context-bar-task")).toHaveTextContent("답변 준비 중");
    await userEvent.click(screen.getByRole("button", { name: "해제" }));
    expect(onClear).toHaveBeenCalledTimes(1);
  });

  it("a set is described but cannot be released, and no step means no step word", () => {
    render(
      <MemoryRouter>
        <ContextBar
          context={{ kind: "SET", label: "화면에 있는 문의", meta: "'현금영수증' 관련 · 3건", task: null, to: null, clearable: false }}
          onClear={vi.fn()}
        />
      </MemoryRouter>,
    );
    expect(screen.queryByRole("button", { name: "해제" })).toBeNull();
    expect(screen.queryByTestId("context-bar-task")).toBeNull();
    expect(screen.getByTestId("context-bar-label").tagName).toBe("SPAN");
  });

  it("without a handler there is no control — the bar never pretends to release anything", () => {
    render(<MemoryRouter><ContextBar context={anchor} /></MemoryRouter>);
    expect(screen.queryByRole("button", { name: "해제" })).toBeNull();
  });
});
