/**
 * **The grant screen and the Approval Manifest say the same thing about a credential run.**
 *
 * This is the regression the 2026-08-13 live sitting bought: the grant screen rendered one account string while
 * the manifest above it rendered another, because one field had a copy in each place. The account is pinned now;
 * these two phases add three more fields with the same failure mode — the OPERATION, the BUDGET and the MODE —
 * and the operation is the sentence that says a secret is about to be read.
 *
 * Equality of constants is necessary and not sufficient. What the operator compares is the LINE on the screen
 * against the LINE on the manifest, so these drive the REAL manifest CLI and match its output against the real
 * grant ask.
 */
import { describe, expect, it } from "vitest";
import { runApprovalManifestCli } from "../../src/cli/approval-manifest-cli";
import {
  COUPANG_WING_CREDENTIAL_CALIBRATION_SCOPE,
  COUPANG_WING_CREDENTIAL_HANDOFF_SCOPE,
  PHASE_SPECS,
  WING_DEFAULT_ACCOUNT_BINDING,
} from "../../src/cli/approval-manifest";
import { runGrantAsk } from "../../src/cli/operator-run-grant";
import { calibrationRunGrantBinding } from "../../src/cli/calibrate-credential-cells";
import { handoffRunGrantBinding } from "../../src/cli/run-coupang-credential-handoff-live";

interface RenderedManifest {
  accountBinding?: string;
  operation?: string;
  maxActions?: string;
  mode?: string;
  phase?: string;
  allowedActions?: string[];
}

/** Drive the REAL manifest CLI for one phase and parse what it printed. Not a fixture — a fixture would agree. */
function renderManifest(phase: string): RenderedManifest {
  const saved = { ...process.env };
  let out = "";
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (s: string): boolean => ((out += s), true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (): boolean => true;
  try {
    // Cleared, not merely overridden: an ambient value must not be able to describe this run as something else.
    for (const k of ["SELLEROPS_APPROVAL_OPERATION", "SELLEROPS_APPROVAL_MAX", "SELLEROPS_APPROVAL_ACCOUNT"]) {
      delete process.env[k];
    }
    process.env["SELLEROPS_APPROVAL_PHASE"] = phase;
    process.env["WALKTHROUGH_RUN_ID"] = "wt-1";
    process.env["WALKTHROUGH_APPROVAL_ID"] = "apr-1";
    process.env["WALKTHROUGH_GIT_COMMIT"] = "abc1234";
    runApprovalManifestCli({ verifyIdentity: () => ({ ok: true, head: "abc1234" }) });
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
    for (const k of Object.keys(process.env)) if (!(k in saved)) delete process.env[k];
    Object.assign(process.env, saved);
  }
  const start = out.indexOf("{");
  const end = out.lastIndexOf("}");
  return start >= 0 && end > start ? (JSON.parse(out.slice(start, end + 1)) as RenderedManifest) : {};
}

const CASES = [
  {
    name: "the credential-cell calibration",
    phase: "COUPANG_WING_CREDENTIAL_CELL_CALIBRATION",
    scope: COUPANG_WING_CREDENTIAL_CALIBRATION_SCOPE,
    binding: calibrationRunGrantBinding,
    mode: "READ_ONLY",
  },
  {
    name: "the credential handoff",
    phase: "COUPANG_WING_CREDENTIAL_HANDOFF",
    scope: COUPANG_WING_CREDENTIAL_HANDOFF_SCOPE,
    binding: handoffRunGrantBinding,
    mode: "CREDENTIAL_READ",
  },
] as const;

for (const c of CASES) {
  describe(c.name, () => {
    it("the manifest CLI emits this phase, not a fallback description of some other run", () => {
      const m = renderManifest(c.phase);
      expect(m.phase, "the manifest CLI printed nothing parseable").toBe(c.phase);
      // The defect this catches: a new phase that falls through the CLI's operation ladder and is described as
      // "API issuance highlight proof" — a sentence about a different run entirely.
      expect(m.operation).toBe(c.scope.operation);
      expect(m.maxActions).toBe(c.scope.maxActions);
      expect(m.mode).toBe(c.mode);
    });

    it("the grant screen's 하는 일 line is the manifest's own operation", () => {
      const m = renderManifest(c.phase);
      const line = runGrantAsk(c.binding()).lines.find((l) => l.startsWith("하는 일"));
      expect(line, "the grant screen has no operation line").toBeDefined();
      expect(line).toBe(`하는 일   ${m.operation}`);
    });

    it("the grant screen's 허용 동작 and 모드 lines agree with the manifest", () => {
      const m = renderManifest(c.phase);
      const lines = runGrantAsk(c.binding()).lines;
      expect(lines.find((l) => l.startsWith("허용 동작"))).toBe(`허용 동작 ${m.maxActions}`);
      expect(lines.find((l) => l.startsWith("모드"))).toBe(`모드      ${m.mode}`);
    });

    it("the account is the contract module's single source", () => {
      const m = renderManifest(c.phase);
      expect(c.binding().account).toBe(WING_DEFAULT_ACCOUNT_BINDING);
      expect(runGrantAsk(c.binding()).lines.find((l) => l.startsWith("계정"))).toBe(`계정      ${m.accountBinding}`);
    });

    it("an ambient SELLEROPS_APPROVAL_OPERATION cannot re-describe the run", () => {
      // Pinned like the destructive phase's scope: the operator's grant binds to this sentence, so a leftover
      // env var from another run must not be able to put a different one in front of them.
      const saved = process.env["SELLEROPS_APPROVAL_OPERATION"];
      process.env["SELLEROPS_APPROVAL_OPERATION"] = "something reassuring";
      try {
        expect(renderManifest(c.phase).operation).toBe(c.scope.operation);
      } finally {
        if (saved === undefined) delete process.env["SELLEROPS_APPROVAL_OPERATION"];
        else process.env["SELLEROPS_APPROVAL_OPERATION"] = saved;
      }
    });
  });
}

describe("only the handoff's manifest says a value is read", () => {
  it("the handoff manifest carries both credential actions; the calibration's carries neither", () => {
    const handoff = renderManifest("COUPANG_WING_CREDENTIAL_HANDOFF");
    const calibration = renderManifest("COUPANG_WING_CREDENTIAL_CELL_CALIBRATION");
    expect(handoff.allowedActions).toContain("READ_CREDENTIAL_VALUES_ONCE");
    expect(handoff.allowedActions).toContain("HAND_CREDENTIAL_TO_SELLEROPS_BACKEND");
    expect(calibration.allowedActions).not.toContain("READ_CREDENTIAL_VALUES_ONCE");
    expect(calibration.allowedActions).toContain("MEASURE_CREDENTIAL_CELL_STRUCTURE");
  });

  it("the handoff's grant screen carries a ⚠ line saying the values are read, in the seller's own words", () => {
    const caution = handoffRunGrantBinding().caution;
    expect(caution).toBeDefined();
    expect(caution).toContain("한 번 읽습니다");
    // The calibration promises the opposite and must not borrow the alarming copy.
    expect(calibrationRunGrantBinding().caution).toBeUndefined();
    expect(calibrationRunGrantBinding().agentDoesNot).toContain("값을 읽지 않습니다");
  });

  it("the two phase specs still disagree about the mode — which is the whole point of the split", () => {
    expect(PHASE_SPECS.COUPANG_WING_CREDENTIAL_CELL_CALIBRATION.mode).toBe("READ_ONLY");
    expect(PHASE_SPECS.COUPANG_WING_CREDENTIAL_HANDOFF.mode).toBe("CREDENTIAL_READ");
  });
});
