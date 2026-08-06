import { describe, expect, it } from "vitest";
import {
  APPROVAL_FLAG,
  COUPANG_WING_APPROVAL_FLAG,
  SESSION_RECOVERY_FLAG,
  approvalRequiredMessage,
  coupangWingApprovalRequiredMessage,
  hasCoupangWingRunApproval,
  hasLiveRunApproval,
  hasSessionRecovery,
  isClassifyOnly,
} from "../../src/cli/live-run-approval";

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

describe("isClassifyOnly", () => {
  it("detects --classify-only", () => {
    expect(isClassifyOnly(["--discover", "--classify-only", APPROVAL_FLAG])).toBe(true);
  });

  it("detects the --no-upload alias", () => {
    expect(isClassifyOnly(["--discover", "--no-upload", APPROVAL_FLAG])).toBe(true);
  });

  it("is false when neither flag is present", () => {
    expect(isClassifyOnly(["--discover", APPROVAL_FLAG])).toBe(false);
  });

  it("is false for no args", () => {
    expect(isClassifyOnly([])).toBe(false);
  });

  it("is not fooled by a prefix-similar flag", () => {
    expect(isClassifyOnly(["--discover", "--classify-only-please"])).toBe(false);
    expect(isClassifyOnly(["--discover", "--no-uploads"])).toBe(false);
  });

  it("is order-independent", () => {
    expect(isClassifyOnly(["--no-upload", "--discover"])).toBe(true);
  });
});

describe("hasCoupangWingRunApproval", () => {
  it("is false with no args / no flag", () => {
    expect(hasCoupangWingRunApproval([])).toBe(false);
    expect(hasCoupangWingRunApproval(["--login"])).toBe(false);
  });

  it("is true when the Coupang WING flag is present", () => {
    expect(hasCoupangWingRunApproval([COUPANG_WING_APPROVAL_FLAG])).toBe(true);
  });

  it("is order-independent", () => {
    expect(hasCoupangWingRunApproval(["--foo", COUPANG_WING_APPROVAL_FLAG, "--bar"])).toBe(true);
  });

  it("is not fooled by a similar-looking flag", () => {
    expect(hasCoupangWingRunApproval(["--i-understand-this-opens-live-coupang"])).toBe(false);
  });

  it("does NOT accept the NAVER approval flag (a NAVER grant never opens WING)", () => {
    expect(hasCoupangWingRunApproval([APPROVAL_FLAG])).toBe(false);
  });

  it("and the NAVER gate does NOT accept the Coupang WING flag (surfaces are non-substitutable)", () => {
    expect(hasLiveRunApproval([COUPANG_WING_APPROVAL_FLAG])).toBe(false);
  });

  it("refusal message names the WING surface, the human-driven steps, and the exact flag", () => {
    const msg = coupangWingApprovalRequiredMessage();
    expect(msg).toMatch(/live Coupang WING seller-center session/i);
    expect(msg).toMatch(/2FA\s*\/\s*CAPTCHA/i);
    expect(msg).toMatch(/user-owned test seller account/i);
    expect(msg).toContain(COUPANG_WING_APPROVAL_FLAG);
    // It must never leak the NAVER flag as an alternative.
    expect(msg).not.toContain(APPROVAL_FLAG);
  });
});

describe("hasSessionRecovery", () => {
  it("detects --session-recovery", () => {
    expect(hasSessionRecovery([SESSION_RECOVERY_FLAG, APPROVAL_FLAG])).toBe(true);
  });

  it("is false when the flag is absent", () => {
    expect(hasSessionRecovery(["--no-ingest", APPROVAL_FLAG])).toBe(false);
    expect(hasSessionRecovery([])).toBe(false);
  });

  it("is order-independent", () => {
    expect(hasSessionRecovery([APPROVAL_FLAG, SESSION_RECOVERY_FLAG])).toBe(true);
  });

  it("is not fooled by a prefix-similar flag", () => {
    expect(hasSessionRecovery(["--session-recovery-mode"])).toBe(false);
  });

  it("is a PROSE flag — it does NOT imply live-run approval", () => {
    // The scope flag swaps operator prose only; it must never stand in for the approval gate.
    expect(hasLiveRunApproval([SESSION_RECOVERY_FLAG])).toBe(false);
  });
});
