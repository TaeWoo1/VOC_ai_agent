// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { PageHeader } from "./PageHeader";

describe("PageHeader", () => {
  it("renders the title as the h1 and the optional description", () => {
    render(<PageHeader title="리뷰 운영" description="설명 문구" />);
    expect(screen.getByRole("heading", { level: 1, name: "리뷰 운영" })).toBeInTheDocument();
    expect(screen.getByText("설명 문구")).toBeInTheDocument();
  });

  it("renders the meta and action slots when provided", () => {
    render(
      <PageHeader
        title="제목"
        meta={<span>메타</span>}
        action={
          <button type="button">동작</button>
        }
      />,
    );
    expect(screen.getByText("메타")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "동작" })).toBeInTheDocument();
  });

  it("omits description/meta/action when not provided", () => {
    render(<PageHeader title="제목만" />);
    expect(screen.getByRole("heading", { level: 1, name: "제목만" })).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
