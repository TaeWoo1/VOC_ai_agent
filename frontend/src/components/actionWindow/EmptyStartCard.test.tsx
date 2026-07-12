// @vitest-environment jsdom
import { describe, it, expect, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { EmptyStartCard } from "./EmptyStartCard";
import { DESKTOP_ONLY_COPY, EMPTY_START_COPY } from "../../lib/actionWindow/copy";

// NOTE: the 시작 button lives in a `hidden … sm:inline-block` container and the note in
// a `sm:hidden` one. jsdom does not apply Tailwind's stylesheet, so both are in the
// accessibility tree and queryable. We assert DOM presence only, never visual
// (responsive) visibility, which jsdom cannot represent.
describe("FE-10 EmptyStartCard (DOM/a11y)", () => {
  it("has the labelled 시작하기 region with the FE-owned empty-start copy", () => {
    render(<EmptyStartCard connected onStart={() => {}} />);
    const region = screen.getByRole("region", { name: "시작하기" });
    expect(region).toBeInTheDocument();
    // FE-10 Slice 4: the title is a real heading (was a styled <p>).
    expect(screen.getByRole("heading", { name: EMPTY_START_COPY.title })).toBeInTheDocument();
    expect(region).toHaveTextContent(EMPTY_START_COPY.title);
    expect(region).toHaveTextContent(EMPTY_START_COPY.body);
    expect(region).toHaveTextContent(DESKTOP_ONLY_COPY.start);
  });

  it("renders the 시작 button and fires onStart when connected", async () => {
    const onStart = vi.fn();
    render(<EmptyStartCard connected onStart={onStart} />);
    await userEvent.click(screen.getByRole("button", { name: "시작" }));
    expect(onStart).toHaveBeenCalledTimes(1);
  });

  it("omits the 시작 button when not connected", () => {
    render(<EmptyStartCard connected={false} onStart={() => {}} />);
    expect(screen.queryByRole("button", { name: "시작" })).toBeNull();
    // still labelled + still shows the desktop-only guidance
    expect(screen.getByRole("region", { name: "시작하기" })).toHaveTextContent(
      DESKTOP_ONLY_COPY.start,
    );
  });
});
