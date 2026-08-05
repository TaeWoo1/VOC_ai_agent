// @vitest-environment jsdom
// Tutorial component: checklist stays on screen, each step has "어디를 눌러야 하나요?" help, the center
// opens in a NEW TAB (no auto-click, no credential/account-id in progress), and completion is optional.
import { describe, it, expect, vi, afterEach } from "vitest";
import { render } from "@testing-library/react";
import { screen, userEvent } from "../../test/renderWithRouter";
import { expectNoAxeViolations } from "../../test/axe";
import { NaverIssuanceTutorial } from "./NaverIssuanceTutorial";
import { NAVER_EXISTING_APP_TUTORIAL, NAVER_ISSUANCE_TUTORIAL } from "../../lib/guidedConnection";

afterEach(() => vi.restoreAllMocks());

describe("NaverIssuanceTutorial", () => {
  it("renders one checklist item per step, each with a checkbox and a '어디를 눌러야 하나요?' help", () => {
    render(<NaverIssuanceTutorial steps={NAVER_ISSUANCE_TUTORIAL} onComplete={vi.fn()} completeLabel="발급을 완료했어요" />);
    expect(screen.getAllByRole("listitem")).toHaveLength(NAVER_ISSUANCE_TUTORIAL.length);
    expect(screen.getAllByRole("checkbox")).toHaveLength(NAVER_ISSUANCE_TUTORIAL.length);
    expect(screen.getAllByText("어디를 눌러야 하나요?")).toHaveLength(NAVER_ISSUANCE_TUTORIAL.length);
  });

  it("opens the OFFICIAL center in a new tab severed from the opener — never auto-navigates SellerOps", async () => {
    const openSpy = vi.spyOn(window, "open").mockReturnValue(null);
    render(<NaverIssuanceTutorial steps={NAVER_ISSUANCE_TUTORIAL} onComplete={vi.fn()} completeLabel="발급을 완료했어요" />);
    await userEvent.click(screen.getByRole("button", { name: /API 센터 열기/ }));
    expect(openSpy).toHaveBeenCalledWith(expect.stringContaining("commerce.naver.com"), "_blank", "noopener,noreferrer");
  });

  it("ticking checklist items updates the visible progress (transient state only)", async () => {
    render(<NaverIssuanceTutorial steps={NAVER_ISSUANCE_TUTORIAL} onComplete={vi.fn()} completeLabel="발급을 완료했어요" />);
    expect(screen.getByText(`체크리스트 0/${NAVER_ISSUANCE_TUTORIAL.length}`)).toBeInTheDocument();
    await userEvent.click(screen.getAllByRole("checkbox")[0]!);
    expect(screen.getByText(`체크리스트 1/${NAVER_ISSUANCE_TUTORIAL.length}`)).toBeInTheDocument();
  });

  it("calls onComplete when the seller confirms they finished at the center", async () => {
    const onComplete = vi.fn();
    render(<NaverIssuanceTutorial steps={NAVER_ISSUANCE_TUTORIAL} onComplete={onComplete} completeLabel="발급을 완료했어요" />);
    await userEvent.click(screen.getByRole("button", { name: "발급을 완료했어요" }));
    expect(onComplete).toHaveBeenCalledOnce();
  });

  it("with NO onComplete → pure guidance: no completion button (used above the existing-app form)", () => {
    render(<NaverIssuanceTutorial steps={NAVER_EXISTING_APP_TUTORIAL} />);
    expect(screen.getByRole("button", { name: /API 센터 열기/ })).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /발급을 완료/ })).toBeNull();
  });

  it("shows the advertised fixed call IP(s) with a copy affordance at the register-call-IP step", () => {
    render(
      <NaverIssuanceTutorial
        steps={NAVER_ISSUANCE_TUTORIAL}
        advertisedEgressIps={["203.0.113.10", "203.0.113.11"]}
      />,
    );
    expect(screen.getByText("203.0.113.10")).toBeInTheDocument();
    expect(screen.getByText("203.0.113.11")).toBeInTheDocument();
    // A copy affordance exists per IP (value is not a secret — the seller must register it publicly).
    expect(screen.getAllByRole("button", { name: "복사" })).toHaveLength(2);
  });

  it("fails safe when no IP is advertised: generic guidance, never a fabricated IP", () => {
    render(<NaverIssuanceTutorial steps={NAVER_ISSUANCE_TUTORIAL} advertisedEgressIps={[]} />);
    expect(screen.getByText(/등록할 고정 IP가 아직 표시되지 않습니다/)).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: "복사" })).toBeNull();
    // No dotted-quad fabricated anywhere in the rendered checklist.
    expect(screen.queryByText(/\d{1,3}\.\d{1,3}\.\d{1,3}\.\d{1,3}/)).toBeNull();
  });

  it("has no accessibility violations", async () => {
    const { container } = render(
      <NaverIssuanceTutorial steps={NAVER_ISSUANCE_TUTORIAL} onComplete={vi.fn()} completeLabel="발급을 완료했어요" />,
    );
    await expectNoAxeViolations(container);
  });
});
