// @vitest-environment jsdom
import { describe, expect, it } from "vitest";
import { render, screen } from "@testing-library/react";
import { Status } from "./Status";

describe("Status — the only way a state is coloured", () => {
  it("always carries a word; the colour is never the only carrier", () => {
    render(<Status tone="good">연결됨</Status>);
    expect(screen.getByText("연결됨").className).toContain("text-good");
  });
  it("the word variant draws a dot beside the word for the first slot of a dense row", () => {
    const { container } = render(<Status tone="warn" variant="word">답변 필요</Status>);
    expect(container.querySelector("[aria-hidden='true']")).not.toBeNull();
    expect(screen.getByText("답변 필요").className).toContain("text-warn");
  });
});
