import { describe, expect, it } from "vitest";
import {
  ESM_APPROVAL_FLAG,
  esmApprovalRequiredMessage,
  hasEsmLiveApproval,
} from "../../src/esm/esm-live-approval";

describe("esm-live-approval — per-run ESM approval gate", () => {
  it("the flag is the distinct ESM flag (not the NAVER one)", () => {
    expect(ESM_APPROVAL_FLAG).toBe("--i-understand-this-opens-live-esm");
    expect(ESM_APPROVAL_FLAG).not.toContain("naver");
  });

  it("hasEsmLiveApproval is true ONLY when the exact flag is present", () => {
    expect(hasEsmLiveApproval([ESM_APPROVAL_FLAG])).toBe(true);
    expect(hasEsmLiveApproval(["--other", ESM_APPROVAL_FLAG, "x"])).toBe(true);
  });

  it("hasEsmLiveApproval is false without the flag (incl. the NAVER flag)", () => {
    expect(hasEsmLiveApproval([])).toBe(false);
    expect(hasEsmLiveApproval(["--i-understand-this-opens-live-naver"])).toBe(false);
    expect(hasEsmLiveApproval(["--classify-only"])).toBe(false);
  });

  it("the refusal message states the live/no-bypass/test-account/no-click discipline", () => {
    const msg = esmApprovalRequiredMessage();
    expect(msg).toMatch(/LIVE ESM\+/);
    expect(msg).toMatch(/2FA \/ CAPTCHA/);
    expect(msg).toMatch(/No CAPTCHA\/2FA bypass/);
    expect(msg).toMatch(/test seller account/);
    expect(msg).toMatch(/never clicks|no-click/i);
    expect(msg).toContain(ESM_APPROVAL_FLAG);
  });
});
