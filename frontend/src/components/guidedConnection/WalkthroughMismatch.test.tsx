// @vitest-environment jsdom
// The WALKTHROUGH_ENVIRONMENT_MISMATCH screen: fail-closed (no credential form / no test-sync CTA), but it now
// offers a ONE-CLICK recovery to the exact bound URL the FE already knows from /context — instead of asking the
// operator to retype it. It never auto-proceeds; the link just re-opens the bound URL where the guard re-checks.
import { describe, it, expect } from "vitest";
import { render, screen } from "@testing-library/react";
import { expectNoAxeViolations } from "../../test/axe";
import { WalkthroughMismatch } from "./WalkthroughMismatch";
import { expectedWalkthroughUrl } from "../../lib/guidedConnection";

const BOUND = "http://localhost:5173/connect/naver?walkthroughRun=wt-d2fe93e9a0d7";

describe("WalkthroughMismatch", () => {
  it("shows the sanitized reason(s) and the fail-closed heading", () => {
    render(<WalkthroughMismatch reasons={["MISSING_URL_RUN"]} expectedUrl={BOUND} />);
    expect(screen.getByRole("alert", { name: "WALKTHROUGH_ENVIRONMENT_MISMATCH" })).toBeInTheDocument();
    expect(screen.getByText(/이 탭의 주소에 walkthrough 실행 ID가 없습니다/)).toBeInTheDocument();
  });

  it("renders a ONE-CLICK recovery link to the exact bound URL (not just text to retype)", () => {
    render(<WalkthroughMismatch reasons={["MISSING_URL_RUN"]} expectedUrl={BOUND} />);
    const link = screen.getByRole("link", { name: "정확한 주소로 다시 열기" });
    expect(link).toHaveAttribute("href", BOUND);
    // The URL is still shown for transparency.
    expect(screen.getByText(BOUND)).toBeInTheDocument();
  });

  it("the recovery link's ACTUAL walkthroughRun query param equals the bound run id (not just a lookalike string)", () => {
    const url = expectedWalkthroughUrl("http://localhost:5173", "wt-d2fe93e9a0d7");
    render(<WalkthroughMismatch reasons={["RUN_MISMATCH"]} expectedUrl={url} />);
    const href = screen.getByRole("link", { name: "정확한 주소로 다시 열기" }).getAttribute("href")!;
    const parsed = new URL(href);
    expect(parsed.pathname).toBe("/connect/naver");
    expect(parsed.searchParams.get("walkthroughRun")).toBe("wt-d2fe93e9a0d7");
  });

  it("shows no recovery link when the expected URL is unknown (still fail-closed, nothing to click)", () => {
    render(<WalkthroughMismatch reasons={["MISSING_CONTEXT"]} expectedUrl={null} />);
    expect(screen.queryByRole("link", { name: "정확한 주소로 다시 열기" })).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(<WalkthroughMismatch reasons={["RUN_MISMATCH"]} expectedUrl={BOUND} />);
    await expectNoAxeViolations(container);
  });
});
