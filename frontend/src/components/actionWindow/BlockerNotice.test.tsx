// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { BlockerNotice } from "./BlockerNotice";

describe("FE-10 BlockerNotice (DOM/a11y)", () => {
  it("is a status live region carrying the title + body", () => {
    render(
      <BlockerNotice title="화면이 바뀐 것 같아요" body="다시 확인해 주세요." recoverable variant="standalone" />,
    );
    const status = screen.getByRole("status");
    expect(status).toHaveTextContent("화면이 바뀐 것 같아요");
    expect(status).toHaveTextContent("다시 확인해 주세요.");
  });

  it("shows the recoverable badge wording when recoverable", () => {
    render(<BlockerNotice title="t" body="b" recoverable variant="nested" />);
    expect(screen.getByRole("status")).toHaveTextContent("다시 시도할 수 있어요");
  });

  it("shows the non-recoverable wording when not recoverable", () => {
    render(<BlockerNotice title="t" body="b" recoverable={false} variant="standalone" />);
    expect(screen.getByRole("status")).toHaveTextContent("복구할 수 없어요");
  });

  it("applies the variant-specific wrapper classes", () => {
    const { rerender } = render(
      <BlockerNotice title="t" body="b" recoverable variant="standalone" />,
    );
    expect(screen.getByRole("status")).toHaveClass("rounded-2xl", "p-4");

    rerender(<BlockerNotice title="t" body="b" recoverable variant="nested" />);
    expect(screen.getByRole("status")).toHaveClass("mt-3", "rounded-xl", "p-3");
  });
});
