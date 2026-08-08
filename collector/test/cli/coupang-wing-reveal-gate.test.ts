/**
 * The reveal CLI's gate — the single choke point standing between `npx tsx …` and a real WING window.
 *
 * It must refuse, with a sanitized cause and BEFORE anything launches, on: a phase the grant does not cover, an
 * unbound identity, an off-target host, a drifted HEAD, a dirty tree, or the wrong repository. And it must compose
 * in that order — phase binding, then the approval gate, then the repository-identity check — so a wrong-phase run
 * reports its own cause rather than a confusing git one.
 *
 * NOT covered here, and previously over-claimed by this docstring: a WITHDRAWN `issue` calibration. It cannot be
 * exercised while `WING_ISSUE_SELECTOR_CALIBRATED` is `true as const`; only the source assertion below (that the
 * CLI reads the shared constant rather than hardcoding `true`) stands behind it. The driver's injectable
 * `calibrated` seam IS tested, in `coupang-wing-reveal-driver.test.ts`.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { afterEach, describe, expect, it } from "vitest";
import { gateRefusalCause, REVEAL_ABORT_FILENAME, REVEAL_DONE_FILENAME, REVEAL_READY_FILENAME, sentinelPath } from "../../src/cli/run-coupang-wing-reveal-live";
import { WING_DEFAULT_URL } from "../../src/cli/coupang-wing-classifier";

const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli/run-coupang-wing-reveal-live.ts");
const REVEAL_PHASE = "COUPANG_WING_ISSUANCE_FORM_REVEAL";
const DELETION_PHASE = "COUPANG_WING_KEY_DELETION";

const IDENTITY = {
  WALKTHROUGH_RUN_ID: "wt-0123456789ab",
  WALKTHROUGH_APPROVAL_ID: "apr-0123456789ab",
  WALKTHROUGH_GIT_COMMIT: "abc1234",
  SELLEROPS_APPROVAL_PHASE: REVEAL_PHASE,
  SELLEROPS_WING_APPROVED_PHASE: REVEAL_PHASE,
} as const;

const saved = new Map<string, string | undefined>();
function setEnv(vars: Record<string, string | undefined>): void {
  for (const k of Object.keys(IDENTITY)) {
    if (!saved.has(k)) saved.set(k, process.env[k]);
    delete process.env[k];
  }
  for (const [k, v] of Object.entries(vars)) if (v !== undefined) process.env[k] = v;
}
afterEach(() => {
  for (const [k, v] of saved) {
    if (v === undefined) delete process.env[k];
    else process.env[k] = v;
  }
  saved.clear();
});

/** A verifier stub — production uses the real check; the DEFAULT is strict, which a test must opt out of. */
const okIdentity = () => ({ ok: true }) as ReturnType<typeof import("../../src/cli/repo-identity").verifyRepoIdentity>;
const failIdentity = (cause: string, reason: string) =>
  (() => ({ ok: false, cause, reason })) as unknown as typeof import("../../src/cli/repo-identity").verifyRepoIdentity;

describe("the PHASE binding — a grant for one WING action never authorizes another", () => {
  it("refuses when the run env names ANOTHER WING phase", async () => {
    // The escalation review demonstrated: the three WALKTHROUGH_* identity variables are byte-identical across
    // WING phases, so before this binding a reveal run env reached PREPARED in the DESTRUCTIVE deletion CLI —
    // an irreversible-delete highlight under a grant given for a non-destructive press.
    setEnv({ ...IDENTITY, SELLEROPS_APPROVAL_PHASE: DELETION_PHASE, SELLEROPS_WING_APPROVED_PHASE: DELETION_PHASE });
    expect(gateRefusalCause(WING_DEFAULT_URL, okIdentity as never)).toMatch(/^WRONG_RUN_PHASE:/);
  });

  it("…and the DELETION CLI refuses a reveal run env, which is the direction that mattered", async () => {
    const deletion = await import("../../src/cli/run-coupang-wing-deletion-live");
    setEnv({ ...IDENTITY }); // a REVEAL run env, verbatim
    expect(deletion.gateRefusalCause(WING_DEFAULT_URL, okIdentity as never)).toMatch(/^WRONG_RUN_PHASE:/);
  });

  it("refuses a MISSING run phase and a MISSING approved phase separately", () => {
    const { SELLEROPS_APPROVAL_PHASE: _a, ...noRun } = IDENTITY;
    setEnv(noRun);
    expect(gateRefusalCause(WING_DEFAULT_URL, okIdentity as never)).toMatch(/^MISSING_RUN_PHASE:/);
    const { SELLEROPS_WING_APPROVED_PHASE: _b, ...noApproved } = IDENTITY;
    setEnv(noApproved);
    expect(gateRefusalCause(WING_DEFAULT_URL, okIdentity as never)).toMatch(/^MISSING_APPROVED_PHASE:/);
  });

  it("refuses when the run declares this phase but the MANIFEST approved another", () => {
    setEnv({ ...IDENTITY, SELLEROPS_WING_APPROVED_PHASE: DELETION_PHASE });
    expect(gateRefusalCause(WING_DEFAULT_URL, okIdentity as never)).toMatch(/^PHASE_APPROVAL_MISMATCH:/);
  });

  it("is EXACT — no whitespace, casing, PREFIX or suffix variant authorizes the run", () => {
    // The prefix cases matter: mutating the comparison to `expected.startsWith(runPhase)` survived a first
    // mutation round because every value tried was longer or re-cased, never a genuine prefix.
    for (const v of [
      ` ${REVEAL_PHASE}`,
      `${REVEAL_PHASE} `,
      REVEAL_PHASE.toLowerCase(),
      REVEAL_PHASE.slice(0, -1), // a strict prefix
      "COUPANG_WING",
      "COUPANG",
      `${REVEAL_PHASE}_EXTRA`, // a strict extension
    ]) {
      setEnv({ ...IDENTITY, SELLEROPS_APPROVAL_PHASE: v, SELLEROPS_WING_APPROVED_PHASE: v });
      expect(gateRefusalCause(WING_DEFAULT_URL, okIdentity as never), JSON.stringify(v)).toMatch(/^WRONG_RUN_PHASE:/);
    }
  });

  it("the phase binding runs BEFORE the manifest gate — a wrong phase reports the phase cause", () => {
    setEnv({ SELLEROPS_APPROVAL_PHASE: DELETION_PHASE, SELLEROPS_WING_APPROVED_PHASE: DELETION_PHASE });
    // Identity is ALSO unbound here; the phase cause must win, or an operator is sent to look at the wrong thing.
    expect(gateRefusalCause(WING_DEFAULT_URL, okIdentity as never)).toMatch(/^WRONG_RUN_PHASE:/);
  });
});

describe("reveal gate — PREPARED only when everything holds", () => {
  it("reaches PREPARED with a bound identity, the WING host, and a passing identity check", () => {
    setEnv({ ...IDENTITY });
    expect(gateRefusalCause(WING_DEFAULT_URL, okIdentity as never)).toBeNull();
  });

  it("refuses an UNBOUND identity", () => {
    for (const drop of ["WALKTHROUGH_RUN_ID", "WALKTHROUGH_APPROVAL_ID", "WALKTHROUGH_GIT_COMMIT"] as const) {
      const env: Record<string, string | undefined> = { ...IDENTITY };
      delete env[drop];
      setEnv(env);
      expect(gateRefusalCause(WING_DEFAULT_URL, okIdentity as never), drop).toBe("UNBOUND_IDENTITY");
    }
  });

  it("refuses an off-target host before anything else", () => {
    setEnv({ ...IDENTITY });
    expect(gateRefusalCause("https://evil.example.com/wing", okIdentity as never)).toBe("INVALID_HOST");
  });

  it("refuses on HEAD drift / dirty tree / wrong repository, carrying the cause AND its reason", () => {
    setEnv({ ...IDENTITY });
    for (const [cause, reason] of [
      ["HEAD_DRIFT", "git commit changed since bootstrap"],
      ["DIRTY_TREE", "uncommitted changes present"],
      ["WRONG_REPOSITORY", "git is reading another checkout"],
      ["GIT_UNREADABLE", "git exited non-zero"],
    ] as const) {
      const got = gateRefusalCause(WING_DEFAULT_URL, failIdentity(cause, reason));
      expect(got, cause).toBe(`${cause}: ${reason}`);
    }
  });

  it("the APPROVAL gate runs BEFORE the identity check — a bad approval reports its own cause", () => {
    // Composition asserted on behaviour: with BOTH broken, the approval cause must win, or an operator debugging
    // an uncalibrated/mis-scoped run would be sent to look at git.
    setEnv({ SELLEROPS_APPROVAL_PHASE: REVEAL_PHASE, SELLEROPS_WING_APPROVED_PHASE: REVEAL_PHASE });
    expect(gateRefusalCause(WING_DEFAULT_URL, failIdentity("HEAD_DRIFT", "moved"))).toBe("UNBOUND_IDENTITY");
  });

  it("the DEFAULT verifier is the real one — forgetting to inject gets strictness, not a pass", () => {
    setEnv({ ...IDENTITY });
    // The pinned SHA `abc1234` is not this checkout's HEAD, so the real verifier must refuse.
    const got = gateRefusalCause(WING_DEFAULT_URL);
    expect(got).not.toBeNull();
    expect(got).toMatch(/^(HEAD_DRIFT|DIRTY_TREE|WRONG_REPOSITORY|GIT_UNREADABLE):/);
  });
});

describe("reveal CLI — structurally incapable of acting on WING", () => {
  const raw = readFileSync(CLI, "utf8");
  const code = raw
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");

  it("has no click / type / submit / navigate path", () => {
    for (const forbidden of [
      ".click(", ".type(", ".fill(", ".press(", ".selectOption(", ".setInputFiles(", ".keyboard",
      "dispatchEvent", ".submit(", ".goto(", ".reload(",
    ]) {
      expect(code, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("reads no value and takes no screenshot", () => {
    for (const forbidden of [".inputValue(", ".innerHTML", ".outerHTML", "screenshot", ".content("]) {
      expect(code, `must not contain ${forbidden}`).not.toContain(forbidden);
    }
  });

  it("gates BEFORE the browser launches", () => {
    const gateAt = code.indexOf("gateRefusalCause(url)");
    expect(gateAt).toBeGreaterThan(-1);
    for (const sideEffect of ["loadConfig()", "mkdirSync(", "await launchNaverContext("]) {
      expect(gateAt, `gate must precede ${sideEffect}`).toBeLessThan(code.indexOf(sideEffect));
    }
  });

  it("keeps the refusal branch — deleting its body must not need the typechecker to be caught", () => {
    const at = code.indexOf("if (refusal) {");
    expect(at).toBeGreaterThan(-1);
    const body = code.slice(at, code.indexOf("const cfg = loadConfig()"));
    expect(body).toMatch(/process\.exit\(4\);[\s\S]*return;/);
  });

  it("states the calibration from the SHARED constant — never a hardcoded true", () => {
    expect(code).toContain("selectorsCalibrated: WING_ISSUE_SELECTOR_CALIBRATED");
    expect(code).not.toMatch(/selectorsCalibrated:\s*true/);
  });

  it("passes the reveal descriptor from the shared constant, so display and runtime cannot drift", () => {
    expect(code).toContain("operatorRevealAction: COUPANG_WING_ISSUANCE_REVEAL_ACTION");
  });

  it("prints keyCreationRuledOut in the record — a record omitting it would read as an all-clear", () => {
    const printed = code.slice(code.indexOf("JSON.stringify("), code.indexOf("aw_coupang_reveal_run_done"));
    expect(printed).toContain("keyCreationRuledOut");
    expect(printed).toContain("keyCreationReason");
    expect(printed).toContain("outcome");
  });

  it("its three sentinels are distinct — readiness, the press, and abort cannot be confused", () => {
    const names = [REVEAL_READY_FILENAME, REVEAL_DONE_FILENAME, REVEAL_ABORT_FILENAME];
    expect(new Set(names).size).toBe(3);
    for (const n of names) expect(n.startsWith("run-coupang-wing-reveal-live.")).toBe(true);
    // …and they resolve beside the status file, never outside the collector tree.
    const p = sentinelPath("/tmp/x/.status/naver.json", REVEAL_READY_FILENAME);
    expect(p).toBe(`/tmp/x/.status/${REVEAL_READY_FILENAME}`);
  });

  it("does not reuse the PROBE or DELETION sentinels — a stale one must not drive this run", () => {
    for (const foreign of ["probe-wing-issuance-selectors", "run-coupang-wing-deletion-live"]) {
      expect(code, foreign).not.toContain(foreign);
    }
  });
});
