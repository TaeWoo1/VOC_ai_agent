// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { StatusPill } from "./StatusPill";

describe("StatusPill", () => {
  it("renders the label with the tone's palette classes", () => {
    const { container } = render(<StatusPill label="확인 필요" tone="human" />);
    expect(screen.getByText("확인 필요")).toBeInTheDocument();
    expect(container.firstChild).toHaveClass("bg-warn/10", "text-warn");
  });

  it("wraps an optional icon as decorative (aria-hidden)", () => {
    render(<StatusPill label="완료" tone="good" icon={<span>✓</span>} />);
    expect(screen.getByText("완료")).toBeInTheDocument();
    expect(screen.getByText("✓").closest("[aria-hidden='true']")).not.toBeNull();
  });

  it("omits the icon wrapper when no icon is given", () => {
    const { container } = render(<StatusPill label="시작 전" tone="neutral" />);
    expect(container.querySelector("[aria-hidden='true']")).toBeNull();
  });
});
