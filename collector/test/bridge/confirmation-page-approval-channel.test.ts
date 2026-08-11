import { describe, expect, it } from "vitest";
import { renderConfirmationPage } from "../../src/bridge/confirmation-page";
import { createMacOsApprovalPresenter } from "../../src/bridge/macos-approval-presenter";
import { createStderrApprovalPresenter } from "../../src/bridge/stderr-approval-presenter";
import { nullApprovalPresenter } from "../../src/bridge/approval-presenter";

const BASE = {
  requestId: "req-1",
  origin: "http://localhost:5173",
  workspaceLabel: "SellerOps",
  confirmationCode: "482 913",
  approvalRequired: true,
};

/**
 * The page tells the person WHERE the approval code is. On the product path there is no terminal — the agent
 * is a launchd service and the code is in an OS dialog — so the old fixed "터미널" instruction was dead advice
 * pointing at a window that does not exist.
 */
describe("the confirmation page's approval-code instruction", () => {
  it("points at the OS dialog when that is the channel", () => {
    const html = renderConfirmationPage({ ...BASE, approvalChannel: "os_dialog" });
    expect(html).toContain("SellerOps 승인 창");
    expect(html).not.toContain("터미널");
  });

  it("points at the terminal when that is the channel", () => {
    const html = renderConfirmationPage({ ...BASE, approvalChannel: "terminal" });
    expect(html).toContain("에이전트를 실행한 터미널");
  });

  it("stays neutral rather than guessing when the channel is unknown", () => {
    const html = renderConfirmationPage(BASE);
    expect(html).toContain("SellerOps 도우미가 표시한");
    expect(html).not.toContain("터미널");
    expect(html).not.toContain("승인 창");
  });

  it("asks for no code at all when approval is not required", () => {
    const html = renderConfirmationPage({ ...BASE, approvalRequired: false, approvalChannel: "os_dialog" });
    expect(html).not.toContain('id="approval"');
    expect(html).not.toContain("<strong>승인 코드</strong>");
  });

  it("names the same window in the instruction and in the empty-field message", () => {
    // Two places to look for one code is worse than one wrong place: the person cannot tell which is stale.
    const html = renderConfirmationPage({ ...BASE, approvalChannel: "os_dialog" });
    expect(html).toContain("화면에 뜬 SellerOps 승인 창에 표시된 <strong>승인 코드</strong>를 입력하세요.");
    expect(html).toContain("'화면에 뜬 SellerOps 승인 창에 표시된 승인 코드를 입력하세요.'");
    // The script assigns this to textContent, which renders tags literally — so the phrase carries no markup.
    expect(html).not.toContain("'화면에 뜬 <strong>");
  });

  it("never renders the approval secret — the page is fetchable by anyone holding the requestId", () => {
    const html = renderConfirmationPage({ ...BASE, approvalChannel: "os_dialog" });
    // Only the short human-verifiable confirmation code may appear; the out-of-band secret has no input here.
    expect(html).toContain("482 913");
    expect(html).toContain('id="approval"');
    expect(html).toContain('placeholder="XXXX-XXXX"');
  });
});

/**
 * The channel is declared BY the presenter, so the instruction cannot drift from the adapter that actually
 * showed the code. A configured-beside-it value could disagree; this cannot.
 */
describe("presenters declare their own channel", () => {
  it("the macOS adapter is the OS dialog", () => {
    expect(createMacOsApprovalPresenter({ platform: "darwin" }).channel).toBe("os_dialog");
  });

  it("the DEV stderr adapter is the terminal", () => {
    expect(createStderrApprovalPresenter().channel).toBe("terminal");
  });

  it("the fail-closed default declares nothing — it reaches no human to name a place for", () => {
    expect(nullApprovalPresenter.channel).toBeUndefined();
  });
});
