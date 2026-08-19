/**
 * The diagnostic's gate. Exported and pure, so it is tested behaviourally rather than by source substrings —
 * the substring pins would pass on wrong exit codes or a reordering that let a mutating flag through.
 */
import { describe, it, expect } from "vitest";
import {
  DIAGNOSTIC_PRODUCTION_REFUSAL,
  diagnosticRefusal,
} from "../../instruments/live-runs/run-store-identity-diagnostic-live-naver";
import {
  APPROVAL_FLAG,
  NO_INGEST_FLAG,
  REPLY_APPROVAL_FLAG,
  REVIEW_ID_PROBE_FLAG,
  SESSION_RECOVERY_FLAG,
} from "../../src/cli/live-run-approval";

const OK = [REVIEW_ID_PROBE_FLAG];

describe("diagnosticRefusal", () => {
  it("allows the read-only grant", () => {
    expect(diagnosticRefusal(OK, {} as NodeJS.ProcessEnv)).toBeNull();
  });

  it("refuses with no flag at all", () => {
    const r = diagnosticRefusal([], {} as NodeJS.ProcessEnv);
    expect(r?.exitCode).toBe(3);
  });

  it.each([
    ["reply", REPLY_APPROVAL_FLAG],
    ["export", APPROVAL_FLAG],
    ["no-ingest", NO_INGEST_FLAG],
    ["session-recovery", SESSION_RECOVERY_FLAG],
    ["classify-only", "--classify-only"],
  ])("refuses the %s flag rather than accepting the stronger grant", (_label, flag) => {
    // Exit 6, not 3: this is "you asked for a different run", not "you forgot to authorise this one".
    const r = diagnosticRefusal([flag], {} as NodeJS.ProcessEnv);
    expect(r?.exitCode).toBe(6);
  });

  it("refuses a mutating flag EVEN WHEN the read-only grant is also present", () => {
    // Ordering matters: if the read-only check ran first it would short-circuit and accept the pair.
    for (const flag of [REPLY_APPROVAL_FLAG, APPROVAL_FLAG, NO_INGEST_FLAG]) {
      expect(diagnosticRefusal([...OK, flag], {} as NodeJS.ProcessEnv)?.exitCode, flag).toBe(6);
    }
  });

  it("refuses under NODE_ENV=production even with the right flag", () => {
    const r = diagnosticRefusal(OK, { NODE_ENV: "production" } as NodeJS.ProcessEnv);
    expect(r?.reason).toBe(DIAGNOSTIC_PRODUCTION_REFUSAL);
    expect(r?.exitCode).toBe(4);
  });
});
