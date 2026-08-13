/**
 * Behavioral tests for the DESTRUCTIVE deletion entrypoint's own refusal gate (`gateRefusalCause`).
 *
 * The point of testing it here rather than only through the harness script: an operator can type the CLI
 * invocation by hand and never run `wing-deletion-preflight.sh`. So the runtime CLI must reach the same verdict
 * the displayed manifest was built on — same phase spec, same pinned scope, same immutable descriptor, same
 * calibration flag, and the same repository-identity verification. These assert that composition on BEHAVIOUR;
 * importing the module launches nothing (it is inert on import).
 */
import { describe, it, expect, afterEach } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import {
  DELETION_ABORT_FILENAME,
  deletionAskFor,
  gateRefusalCause,
} from "../../src/cli/run-coupang-wing-deletion-live";
import { WING_DELETION_WARNING_LABEL } from "../../src/action-window/coupang-wing-deletion-driver";
import { COUPANG_WING_KEY_DELETION_SCOPE, PHASE_SPECS } from "../../src/cli/approval-manifest";
import { WING_DEFAULT_URL } from "../../src/cli/coupang-wing-classifier";
import type { verifyRepoIdentity } from "../../src/cli/repo-identity";

type Verifier = typeof verifyRepoIdentity;
const VERIFIED: Verifier = () => ({ ok: true, head: "abc1234" });

const TOUCHED = [
  "SELLEROPS_APPROVAL_PHASE",
  "SELLEROPS_WING_APPROVED_PHASE",
  "WALKTHROUGH_RUN_ID",
  "WALKTHROUGH_APPROVAL_ID",
  "WALKTHROUGH_GIT_COMMIT",
  "SELLEROPS_APPROVAL_CHANNEL",
  "SELLEROPS_APPROVAL_ACCOUNT",
  "SELLEROPS_APPROVAL_SURFACE",
  "SELLEROPS_APPROVAL_OPERATION",
  "SELLEROPS_APPROVAL_MAX",
] as const;
const saved = new Map<string, string | undefined>();
function setEnv(vars: Record<string, string | undefined>): void {
  for (const k of TOUCHED) if (!saved.has(k)) saved.set(k, process.env[k]);
  for (const k of TOUCHED) delete process.env[k];
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
}
function boundIdentity(): void {
  setEnv({
    WALKTHROUGH_RUN_ID: "wt-0123456789ab",
    WALKTHROUGH_APPROVAL_ID: "apr-0123456789ab",
    WALKTHROUGH_GIT_COMMIT: "abc1234",
    SELLEROPS_APPROVAL_PHASE: "COUPANG_WING_KEY_DELETION",
    SELLEROPS_WING_APPROVED_PHASE: "COUPANG_WING_KEY_DELETION",
  });
}
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});

/**
 * The 삭제 calibration is WITHDRAWN, so the shipped gate short-circuits on `SELECTORS_NOT_CALIBRATED` ahead of
 * every other cause. These cases are about the OTHER causes and their ordering, so they inject a calibrated gate
 * to reach them — otherwise the withdrawal would silently delete this file's coverage instead of closing a run.
 * The block below holds the injection honest: the uninjected default must refuse, and `main()` must call the gate
 * with no injection at all.
 */
const CALIBRATED = true;

describe("deletion CLI gate — the WITHDRAWN calibration closes the destructive run", () => {
  it("the UNINJECTED default refuses with SELECTORS_NOT_CALIBRATED, even when everything else is perfect", () => {
    boundIdentity();
    // A bound identity and a passing identity check — the calibration is the only thing wrong, and on an
    // irreversible path it has to be enough on its own.
    expect(gateRefusalCause(WING_DEFAULT_URL, VERIFIED)).toBe("SELECTORS_NOT_CALIBRATED");
  });

  it("the refusal wins over a git problem — an uncalibrated destructive run is not a commit-and-retry", () => {
    // Ordering matters here more than on the reveal gate: "your tree is dirty" invites a retry, and this run must
    // not become reachable by retrying anything. (An off-target HOST still wins over both — screening runs first,
    // and pointing a destructive run at the wrong site is the more urgent thing to say.)
    boundIdentity();
    expect(gateRefusalCause(WING_DEFAULT_URL, () => ({ ok: false, cause: "DIRTY_TREE", reason: "d" }))).toBe(
      "SELECTORS_NOT_CALIBRATED",
    );
  });
});

describe("deletion CLI gate — passes only for a bound identity on verified code", () => {
  it("a bound identity + verified repository → no refusal", () => {
    boundIdentity();
    expect(gateRefusalCause(WING_DEFAULT_URL, VERIFIED, CALIBRATED)).toBeNull();
  });

  it("an unbound identity refuses, and the browser is never reached", () => {
    for (const key of ["WALKTHROUGH_RUN_ID", "WALKTHROUGH_APPROVAL_ID", "WALKTHROUGH_GIT_COMMIT"] as const) {
      boundIdentity();
      delete process.env[key];
      expect(gateRefusalCause(WING_DEFAULT_URL, VERIFIED, CALIBRATED), key).toBe("UNBOUND_IDENTITY");
    }
  });

  it("a non-WING host refuses", () => {
    boundIdentity();
    expect(gateRefusalCause("https://example.com/whatever", VERIFIED, CALIBRATED)).toBe("INVALID_HOST");
  });
});

describe("deletion CLI gate — the repository identity is verified, not assumed", () => {
  const REFUSALS = [
    { cause: "HEAD_DRIFT", reason: "HEAD is deadbee but the run was bootstrapped at abc1234 — re-bootstrap" },
    { cause: "DIRTY_TREE", reason: "2 uncommitted or untracked change(s) — the running code is not commit abc1234" },
    { cause: "WRONG_REPOSITORY", reason: "git is not reading the expected repository" },
    { cause: "GIT_UNREADABLE", reason: "could not read git status — refusing to assume a clean tree" },
  ] as const;

  it.each(REFUSALS)("$cause refuses the run", ({ cause, reason }) => {
    boundIdentity();
    const refusal = gateRefusalCause(WING_DEFAULT_URL, () => ({ ok: false, cause, reason }), CALIBRATED);
    expect(refusal).not.toBeNull();
    expect(refusal).toContain(cause);
  });

  it("the identity check runs AFTER the approval gate — an unbound run reports its own cause", () => {
    // Order matters for what the operator does next: "your tree is dirty" is useless advice for a run that
    // could never have been approved. Also proves the identity check is not what is doing the refusing above.
    boundIdentity();
    delete process.env.WALKTHROUGH_RUN_ID;
    const refusal = gateRefusalCause(WING_DEFAULT_URL, () => ({ ok: false, cause: "DIRTY_TREE", reason: "dirty" }), CALIBRATED);
    expect(refusal).toBe("UNBOUND_IDENTITY");
  });

  it("the verifier receives the BOOTSTRAPPED sha — not a value it could re-derive itself", () => {
    // If the CLI passed the live HEAD here the comparison would be `HEAD === HEAD` and always pass.
    boundIdentity();
    process.env.WALKTHROUGH_GIT_COMMIT = "fedcba9";
    let seen = "";
    gateRefusalCause(WING_DEFAULT_URL, (i) => {
      seen = i.expectedSha;
      return { ok: true, head: i.expectedSha };
    }, CALIBRATED);
    expect(seen).toBe("fedcba9");
  });

  it("the verifier is given a repo root, and it is not taken from the environment", () => {
    boundIdentity();
    let root = "";
    gateRefusalCause(WING_DEFAULT_URL, (i) => {
      root = i.repoRoot;
      return { ok: true, head: "abc1234" };
    }, CALIBRATED);
    expect(root.length).toBeGreaterThan(0);
    expect(root.endsWith("/collector")).toBe(false); // the REPOSITORY, not the package
  });
});

describe("deletion CLI gate — the run it authorizes is the one the manifest describes", () => {
  it("ambient env cannot re-describe the run: the pinned scope is what the gate validates", () => {
    // The runtime CLI feeds the pinned scope, so a stale SELLEROPS_APPROVAL_* from another run changes nothing
    // — the gate still passes, and it passes on the DESTRUCTIVE scope, not the ambient one.
    boundIdentity();
    setEnv({
      WALKTHROUGH_RUN_ID: "wt-0123456789ab",
      WALKTHROUGH_APPROVAL_ID: "apr-0123456789ab",
      WALKTHROUGH_GIT_COMMIT: "abc1234",
    SELLEROPS_APPROVAL_PHASE: "COUPANG_WING_KEY_DELETION",
    SELLEROPS_WING_APPROVED_PHASE: "COUPANG_WING_KEY_DELETION",
      SELLEROPS_APPROVAL_CHANNEL: "NAVER",
      SELLEROPS_APPROVAL_ACCOUNT: "operator-owned NAVER SmartStore test store",
      SELLEROPS_APPROVAL_SURFACE: "Commerce API Center",
      SELLEROPS_APPROVAL_OPERATION: "read-only probe",
      SELLEROPS_APPROVAL_MAX: "0 actions",
    });
    expect(gateRefusalCause(WING_DEFAULT_URL, VERIFIED, CALIBRATED)).toBeNull();
  });

  it("the phase spec the CLI binds to is the destructive one, with its pinned scope and descriptor", () => {
    const spec = PHASE_SPECS.COUPANG_WING_KEY_DELETION;
    expect(spec.cli).toBe("src/cli/run-coupang-wing-deletion-live.ts");
    expect(spec.requiresOperatorDestructiveAction).toBe(true);
    expect(spec.destructiveScope).toBe(COUPANG_WING_KEY_DELETION_SCOPE);
    expect(spec.operatorDestructiveAction).toMatchObject({
      operation: "DELETE_WING_OPEN_API_KEY",
      irreversible: true,
      invalidatesExistingCredentialImmediately: true,
      agentPerformsAction: false,
      explicitCheckpointRequired: true,
      credentialValueReadBudget: 0,
    });
  });

  it("no refusal string leaks an env value, a path, or a credential", () => {
    boundIdentity();
    setEnv({
      WALKTHROUGH_RUN_ID: "wt-0123456789ab",
      WALKTHROUGH_APPROVAL_ID: "apr-0123456789ab",
      WALKTHROUGH_GIT_COMMIT: "abc1234",
    SELLEROPS_APPROVAL_PHASE: "COUPANG_WING_KEY_DELETION",
    SELLEROPS_WING_APPROVED_PHASE: "COUPANG_WING_KEY_DELETION",
      SELLEROPS_APPROVAL_ACCOUNT: "AKIAsecretlikevalue-88213",
    });
    const refusals = [
      gateRefusalCause("https://evil.example.com/x", VERIFIED, CALIBRATED),
      gateRefusalCause(WING_DEFAULT_URL, () => ({ ok: false, cause: "DIRTY_TREE", reason: "2 change(s)" }), CALIBRATED),
    ];
    for (const r of refusals) {
      expect(r ?? "").not.toContain("AKIA");
      expect(r ?? "").not.toContain("evil.example.com");
      expect(r ?? "").not.toContain("/Users/");
    }
  });
});

/* ────────────────────────────── the operator's two checkpoints ────────────────────────────── */

/**
 * This run is DESTRUCTIVE, and its second checkpoint stands for "I deleted the key". Both checkpoints used to be
 * sentinel FILES — a `touch` any process can perform, standing in for a human looking at a screen and deleting
 * their own credential. They are verified presses now, and what is pinned here is that no file came back.
 */
describe("the deletion run advances on a verified press and on nothing else", () => {
  const SRC = readFileSync(
    resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli/run-coupang-wing-deletion-live.ts"),
    "utf8",
  );

  it("**the readiness and completion sentinels are gone; the abort file stays**", () => {
    expect(DELETION_ABORT_FILENAME).toBe("run-coupang-wing-deletion-live.abort");
    // The asymmetry is the point: a forged abort STOPS a destructive run, which is the safe direction.
    expect(SRC).not.toContain("run-coupang-wing-deletion-live.ready");
    expect(SRC).not.toContain("run-coupang-wing-deletion-live.deleted");
    expect(SRC).not.toContain("DELETION_READY_FILENAME");
    expect(SRC).not.toContain("DELETION_DONE_FILENAME");
  });

  it("**the two checkpoints are two different asks** — the second is not the first read twice", () => {
    const ready = deletionAskFor("ready");
    const deleted = deletionAskFor("deleted");
    expect(ready.title).not.toBe(deleted.title);
    expect(ready.headline).not.toBe(deleted.headline);
  });

  it("the second ask carries the irreversibility warning and says who presses 삭제", () => {
    const deleted = [deletionAskFor("deleted").headline, ...deletionAskFor("deleted").lines].join("\n");
    expect(deleted).toContain(WING_DELETION_WARNING_LABEL);
    expect(deleted).toContain("되돌릴 수 없습니다");
    expect(deleted).toContain("판매자님");
    // …and it tells an operator who has NOT yet deleted anything what to do instead of pressing.
    expect(deleted).toContain("아직 삭제하지 않으셨다면");
  });

  it("no ask still tells the operator to create a file", () => {
    for (const kind of ["ready", "deleted"] as const) {
      const ask = deletionAskFor(kind);
      const all = [ask.title, ask.headline, ...ask.lines].join("\n");
      expect(all, kind).not.toContain(".ready");
      expect(all, kind).not.toContain("create:");
    }
  });

  it("main() drives both checkpoints through the confirmation host", () => {
    const body = SRC.slice(SRC.indexOf("async function main(): Promise<void>"));
    expect(body).toContain("attachOperatorConfirmTab(");
    expect(body).toContain('confirmCheckpoint("ready")');
    expect(body).toContain('confirmCheckpoint("deleted")');
    // The driver reads a context the confirmation tab is filtered out of — `activePage()` takes the NEWEST tab,
    // so an unfiltered context would have the post-deletion verify land on the blank SellerOps surface.
    expect(body).toContain("context: confirmHost.contextLike");
  });
});
