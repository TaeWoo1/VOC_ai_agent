// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Disclosure } from "./Disclosure";

/**
 * The one property this component exists for: a collapsed section must LOOK collapsed.
 *
 * Four `<details>` shipped in the previous package with `list-none` and no replacement marker, and
 * readers given the screens with no explanation read all of them as labels with nothing behind them.
 * A `list-none` summary with no drawn marker is the defect, so that is what is asserted here.
 */
describe("Disclosure", () => {
  it("draws a marker of its own, since list-none removes the browser's", () => {
    const { container } = render(
      <Disclosure label="AI가 확인한 내용">
        <p>내용</p>
      </Disclosure>,
    );
    const summary = container.querySelector("summary");
    expect(summary).not.toBeNull();
    // The native marker is suppressed…
    expect(summary!.className).toContain("list-none");
    // …so one has to be drawn, inside the summary, and hidden from screen readers because
    // <summary> already announces expanded state.
    const marker = summary!.querySelector("svg");
    expect(marker).not.toBeNull();
    expect(marker!.getAttribute("aria-hidden")).toBe("true");
  });

  it("keeps the label readable and shows the note beside it", () => {
    render(
      <Disclosure label="필터" note=" · 답변 필요">
        <p>내용</p>
      </Disclosure>,
    );
    expect(screen.getByText("필터")).toBeInTheDocument();
    expect(screen.getByText("· 답변 필요")).toBeInTheDocument();
  });

  it("is closed until pressed", () => {
    const { container } = render(
      <Disclosure label="자동 분류">
        <p>안쪽</p>
      </Disclosure>,
    );
    expect(container.querySelector("details")!.open).toBe(false);
  });
});
