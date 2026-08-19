// @vitest-environment jsdom
import { describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { RootErrorBoundary } from "./RootErrorBoundary";

function Boom(): JSX.Element {
  throw new Error("render exploded: token=SECRET");
}

describe("RootErrorBoundary", () => {
  it("turns a render error into a seller-facing screen with a way out and no error text", () => {
    const spy = vi.spyOn(console, "error").mockImplementation(() => {});
    render(
      <RootErrorBoundary>
        <Boom />
      </RootErrorBoundary>,
    );
    expect(screen.getByRole("alert")).toHaveTextContent("화면을 표시하지 못했어요");
    expect(screen.getByRole("button", { name: "새로고침" })).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "홈으로" })).toHaveAttribute("href", "/");
    expect(document.body.textContent).not.toContain("SECRET");
    spy.mockRestore();
  });
});
