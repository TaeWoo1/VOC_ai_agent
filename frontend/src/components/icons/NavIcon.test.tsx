// @vitest-environment jsdom
import { describe, it, expect } from "vitest";
import { render } from "@testing-library/react";
import { NavIcon, NAV_ICON_NAMES, isNavIconName } from "./NavIcon";

describe("NavIcon", () => {
  it("renders a decorative svg for a known icon key", () => {
    const { container } = render(<NavIcon name="home" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    // known icons draw path geometry (not the fallback dot)
    expect(container.querySelector("path")).not.toBeNull();
    expect(container.querySelector("circle")).toBeNull();
  });

  it("falls back to a neutral dot for an unknown key — no crash, no raw string leak", () => {
    const { container } = render(<NavIcon name="does-not-exist" />);
    const svg = container.querySelector("svg");
    expect(svg).not.toBeNull();
    expect(svg).toHaveAttribute("aria-hidden", "true");
    expect(container.querySelector("circle")).not.toBeNull();
    expect(container.textContent).toBe(""); // never renders the key as text
  });

  it("applies a caller className, defaulting when omitted", () => {
    const { container } = render(<NavIcon name="bell" className="h-6 w-6" />);
    expect(container.querySelector("svg")).toHaveClass("h-6", "w-6");
    const { container: d } = render(<NavIcon name="bell" />);
    expect(d.querySelector("svg")).toHaveClass("h-5", "w-5");
  });

  it("exposes its known names via the registry helpers", () => {
    expect(NAV_ICON_NAMES).toContain("home");
    expect(isNavIconName("home")).toBe(true);
    expect(isNavIconName("nope")).toBe(false);
  });
});
