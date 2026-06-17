import { describe, expect, it } from "vitest";
import { APPROVAL_FLAG, approvalRequiredMessage, hasLiveRunApproval } from "../../src/cli/live-run-approval";

describe("hasLiveRunApproval", () => {
  it("is false for a bare --login (no approval flag)", () => {
    expect(hasLiveRunApproval(["--login"])).toBe(false);
  });

  it("is false for a bare --discover (no approval flag)", () => {
    expect(hasLiveRunApproval(["--discover"])).toBe(false);
  });

  it("is false for no args", () => {
    expect(hasLiveRunApproval([])).toBe(false);
  });

  it("is true when the approval flag is present (after the mode)", () => {
    expect(hasLiveRunApproval(["--login", APPROVAL_FLAG])).toBe(true);
  });

  it("is true regardless of flag order", () => {
    expect(hasLiveRunApproval([APPROVAL_FLAG, "--discover"])).toBe(true);
  });

  it("is not fooled by a similar-looking flag", () => {
    expect(hasLiveRunApproval(["--discover", "--i-understand"])).toBe(false);
  });
});

describe("approvalRequiredMessage", () => {
  const msg = approvalRequiredMessage();

  it("states it opens a live NAVER session", () => {
    expect(msg).toMatch(/live NAVER seller-center session/i);
  });

  it("states a human handles login/2FA/CAPTCHA and no bypass is allowed", () => {
    expect(msg).toMatch(/2FA\s*\/\s*CAPTCHA/i);
    expect(msg).toMatch(/no CAPTCHA\/2FA bypass is allowed/i);
  });

  it("requires a user-owned test seller account and explicit per-run approval", () => {
    expect(msg).toMatch(/user-owned test seller account/i);
    expect(msg).toMatch(/explicit per-run approval/i);
  });

  it("shows the exact approval flag to re-run with", () => {
    expect(msg).toContain(APPROVAL_FLAG);
  });
});
