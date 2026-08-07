/**
 * Tests for the Approval Manifest **display** CLI — the tool `preflight.sh` calls to produce the sanitized
 * manifest the operator reads before granting.
 *
 * This file exists because of a gap the calibration-landing review found: the gate could reach PREPARED for the
 * destructive WING key-deletion phase while the CLI that *displays* the manifest still could not, so there would
 * have been nothing for a one-line grant to bind to (`docs/sellerops_live_approval_contract.md` §2/§3). The
 * runtime CLI and this display CLI must agree, and they must agree by reading the SAME calibration constant —
 * not by one of them hardcoding `true`.
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { runApprovalManifestCli } from "../../src/cli/approval-manifest-cli";
import { WING_DELETION_SELECTORS_CALIBRATED } from "../../src/action-window/coupang-wing-issuance-driver";
import { COUPANG_WING_KEY_DELETION_OPERATION } from "../../src/cli/approval-manifest";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI_SRC = resolve(HERE, "../../src/cli/approval-manifest-cli.ts");

const IDENTITY = {
  WALKTHROUGH_RUN_ID: "wt-0123456789ab",
  WALKTHROUGH_APPROVAL_ID: "apr-0123456789ab",
  WALKTHROUGH_GIT_COMMIT: "abc1234",
} as const;

const TOUCHED = [
  "SELLEROPS_APPROVAL_PHASE",
  "WALKTHROUGH_RUN_ID",
  "WALKTHROUGH_APPROVAL_ID",
  "WALKTHROUGH_GIT_COMMIT",
  "SELLEROPS_APPROVAL_CHANNEL",
  "SELLEROPS_APPROVAL_ACCOUNT",
  "SELLEROPS_WING_PROBE_TARGETS",
  "COUPANG_WING_URL",
] as const;

const saved = new Map<string, string | undefined>();
function setEnv(vars: Record<string, string | undefined>): void {
  for (const k of TOUCHED) if (!saved.has(k)) saved.set(k, process.env[k]);
  for (const k of TOUCHED) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
}
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});

/** Run the CLI capturing its stdout/stderr instead of letting it write to the test runner's streams. */
function run(): { code: number; out: string; err: string } {
  let out = "";
  let err = "";
  const realOut = process.stdout.write.bind(process.stdout);
  const realErr = process.stderr.write.bind(process.stderr);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stdout as any).write = (s: string): boolean => ((out += s), true);
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  (process.stderr as any).write = (s: string): boolean => ((err += s), true);
  try {
    return { code: runApprovalManifestCli(), out, err };
  } finally {
    process.stdout.write = realOut;
    process.stderr.write = realErr;
  }
}

describe("approval-manifest-cli — the destructive WING deletion phase can be DISPLAYED for approval", () => {
  it("prints a PREPARED destructive manifest when the identity is bound", () => {
    setEnv({ SELLEROPS_APPROVAL_PHASE: "COUPANG_WING_KEY_DELETION", ...IDENTITY });
    const { code, out, err } = run();
    expect(err, "the destructive phase must not fail closed on its own calibration").toBe("");
    expect(code).toBe(0);

    const m = JSON.parse(out) as Record<string, unknown>;
    expect(m.phase).toBe("COUPANG_WING_KEY_DELETION");
    expect(m.mode).toBe("READ_ONLY"); // AGENT mode — the destructive click is the operator's
    expect(m.selectorsCalibrated).toBe(true);
    expect(m.apiCenterHost).toBe("wing_host");
    expect(m.entrypointCommandId).toBe("run-coupang-wing-deletion-live");
    expect(m.operatorDestructiveAction).toMatchObject({
      operation: COUPANG_WING_KEY_DELETION_OPERATION,
      irreversible: true,
      agentPerformsAction: false,
      explicitCheckpointRequired: true,
      credentialValueReadBudget: 0,
    });
  });

  it("the displayed manifest leaks no raw URL / host / credential wording", () => {
    setEnv({ SELLEROPS_APPROVAL_PHASE: "COUPANG_WING_KEY_DELETION", ...IDENTITY });
    const { out } = run();
    for (const forbidden of ["wing.coupang.com", "https://", "Secret Key", "업체코드"]) {
      expect(out, `manifest must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("an UNBOUND identity still fails closed with no manifest printed", () => {
    for (const key of ["WALKTHROUGH_RUN_ID", "WALKTHROUGH_APPROVAL_ID", "WALKTHROUGH_GIT_COMMIT"] as const) {
      setEnv({ SELLEROPS_APPROVAL_PHASE: "COUPANG_WING_KEY_DELETION", ...IDENTITY, [key]: undefined });
      const { code, out, err } = run();
      expect(code, key).toBe(1);
      expect(out, `${key}: nothing may be displayed on a refusal`).toBe("");
      expect(err).toContain("UNBOUND_IDENTITY");
    }
  });

  it("states the calibration from the SHARED constant — never a hardcoded true", () => {
    // If this CLI hardcoded `selectorsCalibrated: true`, withdrawing the calibration would stop the run from
    // executing while the manifest kept advertising a calibrated destructive phase — the approval would bind to
    // a claim the code no longer honors.
    const src = readFileSync(CLI_SRC, "utf8");
    expect(src).toContain("selectorsCalibrated: WING_DELETION_SELECTORS_CALIBRATED");
    expect(src).not.toContain("selectorsCalibrated: true");
    expect(WING_DELETION_SELECTORS_CALIBRATED).toBe(true);
  });

  it("only the deletion phase states a calibration — other phases keep the gate's own default", () => {
    const src = readFileSync(CLI_SRC, "utf8");
    expect(src).toContain("isWingKeyDeletion ? { selectorsCalibrated: WING_DELETION_SELECTORS_CALIBRATED } : {}");
  });
});

describe("approval-manifest-cli — the read-only WING probe path is unchanged by the calibration landing", () => {
  it("still reaches PREPARED, still READ_ONLY, still carries no destructive descriptor", () => {
    setEnv({
      SELLEROPS_APPROVAL_PHASE: "COUPANG_WING_SELECTOR_PROBE",
      SELLEROPS_WING_PROBE_TARGETS: "delete",
      ...IDENTITY,
    });
    const { code, out } = run();
    expect(code).toBe(0);
    const m = JSON.parse(out) as Record<string, unknown>;
    expect(m.phase).toBe("COUPANG_WING_SELECTOR_PROBE");
    expect(m.mode).toBe("READ_ONLY");
    expect(m.operatorDestructiveAction).toBeUndefined();
    // The probe never highlights, so it needs no calibration — and must not inherit the deletion phase's.
    expect(m.selectorsCalibrated).toBe(false);
  });

  it("an unknown phase fails closed before anything is derived", () => {
    setEnv({ SELLEROPS_APPROVAL_PHASE: "COUPANG_WING_KEY_DELETION_BUT_SNEAKIER", ...IDENTITY });
    const { code, out, err } = run();
    expect(code).toBe(1);
    expect(out).toBe("");
    expect(err).toContain("UNKNOWN_PHASE");
  });
});
