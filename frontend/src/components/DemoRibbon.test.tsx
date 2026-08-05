// @vitest-environment jsdom
import { afterEach, describe, expect, it, vi } from "vitest";
import { render, screen } from "@testing-library/react";
import { DemoRibbon } from "./DemoRibbon";

afterEach(() => {
  vi.unstubAllEnvs();
});

describe("DemoRibbon", () => {
  it("renders nothing when the app is not on demo data", () => {
    vi.stubEnv("VITE_USE_MOCKS", "false");
    const { container } = render(<DemoRibbon />);
    expect(container).toBeEmptyDOMElement();
  });

  it("renders nothing when the flag is absent", () => {
    vi.stubEnv("VITE_USE_MOCKS", "");
    const { container } = render(<DemoRibbon />);
    expect(container).toBeEmptyDOMElement();
  });

  it("states plainly that the figures are not real seller data", () => {
    vi.stubEnv("VITE_USE_MOCKS", "true");
    render(<DemoRibbon />);
    const notice = screen.getByLabelText("데모 모드 안내");
    expect(notice.textContent).toContain("데모 데이터");
    expect(notice.textContent).toContain("실제 판매 데이터가 아닙니다");
  });

  it("cannot be dismissed", () => {
    // A notice the viewer closed on one screen cannot carry the guarantee to the next one.
    vi.stubEnv("VITE_USE_MOCKS", "true");
    render(<DemoRibbon />);
    expect(screen.queryByRole("button")).toBeNull();
  });
});
