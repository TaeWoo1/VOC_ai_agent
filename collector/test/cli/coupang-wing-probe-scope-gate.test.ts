/**
 * The LIVE WING probe's approved-scope gate. The defect it closes: an unset `SELLEROPS_WING_PROBE_TARGETS`
 * used to mean "measure every target", so on a live run every way of LOSING the scope — a forgotten export, a
 * hand-typed command, a dropped run env — silently WIDENED the run past what the operator approved.
 *
 * The gate is deliberately stricter than `resolveWingProbeScope`, which the approval MANIFEST still uses and
 * where "absent ⇒ the full fixed set" is correct (the manifest then DISPLAYS all six, so nothing is hidden).
 * Those manifest paths are re-asserted here so this stricter gate cannot be mistaken for a change to them.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import {
  resolveGatedWingProbeScope,
  resolveWingProbeScope,
  WING_APPROVED_TARGETS_ENV,
  WING_PROBE_SCOPE_REFUSALS,
  WING_PROBE_TARGET_NAMES,
  WING_RUN_TARGETS_ENV,
} from "../../src/cli/coupang-wing-classifier";
import { scopedRecordTargetsFor, scopeRefusalMessage, WING_RECORD_TARGETS } from "../../src/cli/probe-wing-issuance-selectors";

/** Both env vars set to the same scope — the shape the preflight binds. */
function approved(scope: string, run: string = scope): Record<string, string | undefined> {
  return { [WING_RUN_TARGETS_ENV]: run, [WING_APPROVED_TARGETS_ENV]: scope };
}

describe("live WING probe scope gate — fails closed", () => {
  it("refuses a MISSING run scope instead of defaulting to every target", () => {
    const r = resolveGatedWingProbeScope({});
    expect(r.ok).toBe(false);
    if (!r.ok) expect(r.refusal).toBe("MISSING_RUN_SCOPE");
  });

  it("refuses an EMPTY run scope — empty is not 'all targets' on a live run", () => {
    for (const raw of ["", "   ", ","]) {
      const r = resolveGatedWingProbeScope({ ...approved("delete"), [WING_RUN_TARGETS_ENV]: raw });
      expect(r.ok).toBe(false);
      if (!r.ok) expect(r.refusal).toBe("EMPTY_RUN_SCOPE");
    }
  });

  it("allows the delete-only calibration scope", () => {
    const r = resolveGatedWingProbeScope(approved("delete"));
    expect(r).toEqual({ ok: true, targets: ["delete"] });
  });

  it("allows an explicit multi-target scope, normalized to canonical order", () => {
    expect(resolveGatedWingProbeScope(approved("issue,credentials"))).toEqual({ ok: true, targets: ["issue", "credentials"] });
    // Typing order and duplicates do not matter — both sides normalize, so this compares SETS.
    expect(resolveGatedWingProbeScope(approved("credentials,issue,issue", "issue,credentials"))).toEqual({
      ok: true,
      targets: ["issue", "credentials"],
    });
    expect(resolveGatedWingProbeScope(approved([...WING_PROBE_TARGET_NAMES].join(",")))).toEqual({
      ok: true,
      targets: [...WING_PROBE_TARGET_NAMES],
    });
  });

  it("refuses an unknown target on either side", () => {
    const run = resolveGatedWingProbeScope({ ...approved("delete"), [WING_RUN_TARGETS_ENV]: "delete,nope" });
    expect(run.ok).toBe(false);
    if (!run.ok) expect(run.refusal).toBe("UNKNOWN_RUN_TARGET");

    const app = resolveGatedWingProbeScope({ [WING_RUN_TARGETS_ENV]: "delete", [WING_APPROVED_TARGETS_ENV]: "delete,nope" });
    expect(app.ok).toBe(false);
    if (!app.ok) expect(app.refusal).toBe("UNKNOWN_APPROVED_TARGET");
  });

  it("never echoes the unrecognized TOKEN — the env value may hold whatever was mistyped into it", () => {
    // A realistic mistype: a credential-shaped string in the scope variable. The refusal must count, not quote.
    const SENTINEL = "AKIA-SELLERID-88213-SECRETLIKE";
    for (const env of [
      { ...approved("delete"), [WING_RUN_TARGETS_ENV]: SENTINEL },
      { [WING_RUN_TARGETS_ENV]: "delete", [WING_APPROVED_TARGETS_ENV]: SENTINEL },
    ]) {
      const r = resolveGatedWingProbeScope(env);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(r.reason).not.toContain(SENTINEL);
        expect(scopeRefusalMessage(r.refusal, r.reason)).not.toContain(SENTINEL);
        expect(r.reason).toMatch(/1 unrecognized target/);
      }
    }
  });

  it("reads OWN string properties only — an inherited or non-string value cannot satisfy the gate", () => {
    const inherited = Object.create({ [WING_RUN_TARGETS_ENV]: "delete", [WING_APPROVED_TARGETS_ENV]: "delete" });
    const r = resolveGatedWingProbeScope(inherited as Record<string, string | undefined>);
    expect(r.ok).toBe(false);

    // A non-string must REFUSE, not throw on .trim().
    const nonString = { [WING_RUN_TARGETS_ENV]: 42, [WING_APPROVED_TARGETS_ENV]: "delete" } as unknown as Record<string, string | undefined>;
    expect(() => resolveGatedWingProbeScope(nonString)).not.toThrow();
    expect(resolveGatedWingProbeScope(nonString).ok).toBe(false);
  });

  it("refuses when the run would measure something other than what was approved", () => {
    // Widening past the approval is the case that matters most.
    const wider = resolveGatedWingProbeScope(approved("delete", "delete,issue"));
    expect(wider.ok).toBe(false);
    if (!wider.ok) expect(wider.refusal).toBe("SCOPE_APPROVAL_MISMATCH");

    // Narrowing is refused too: the operator approved a displayed scope, not a subset of it.
    const narrower = resolveGatedWingProbeScope(approved("issue,credentials", "issue"));
    expect(narrower.ok).toBe(false);
    if (!narrower.ok) expect(narrower.refusal).toBe("SCOPE_APPROVAL_MISMATCH");

    // A same-size but different set.
    const swapped = resolveGatedWingProbeScope(approved("issue", "credentials"));
    expect(swapped.ok).toBe(false);
    if (!swapped.ok) expect(swapped.refusal).toBe("SCOPE_APPROVAL_MISMATCH");
  });

  it("refuses a DIRECT manual invocation that carries no harness binding", () => {
    // Nothing at all — the bare `npx tsx probe-wing-issuance-selectors.ts` case.
    const bare = resolveGatedWingProbeScope({});
    expect(bare.ok).toBe(false);

    // A hand-typed scope with no approval behind it must not be enough to widen (or to run at all).
    for (const raw of ["delete", [...WING_PROBE_TARGET_NAMES].join(",")]) {
      const handTyped = resolveGatedWingProbeScope({ [WING_RUN_TARGETS_ENV]: raw });
      expect(handTyped.ok).toBe(false);
      if (!handTyped.ok) expect(handTyped.refusal).toBe("MISSING_APPROVED_SCOPE");
    }

    // An empty approval binding is not a binding.
    const emptyApproval = resolveGatedWingProbeScope({ [WING_RUN_TARGETS_ENV]: "delete", [WING_APPROVED_TARGETS_ENV]: "  " });
    expect(emptyApproval.ok).toBe(false);
    if (!emptyApproval.ok) expect(emptyApproval.refusal).toBe("EMPTY_APPROVED_SCOPE");
  });

  it("every refusal is a member of the closed enum, and carries a reason", () => {
    const cases = [
      {},
      { [WING_RUN_TARGETS_ENV]: "" },
      { [WING_RUN_TARGETS_ENV]: "delete" },
      { [WING_RUN_TARGETS_ENV]: "nope", [WING_APPROVED_TARGETS_ENV]: "delete" },
      { [WING_RUN_TARGETS_ENV]: "delete", [WING_APPROVED_TARGETS_ENV]: "nope" },
      { [WING_RUN_TARGETS_ENV]: "delete", [WING_APPROVED_TARGETS_ENV]: "" },
      { [WING_RUN_TARGETS_ENV]: "delete", [WING_APPROVED_TARGETS_ENV]: "issue" },
    ];
    for (const env of cases) {
      const r = resolveGatedWingProbeScope(env);
      expect(r.ok).toBe(false);
      if (!r.ok) {
        expect(WING_PROBE_SCOPE_REFUSALS).toContain(r.refusal);
        expect(r.reason.length).toBeGreaterThan(0);
      }
    }
  });

  it("is pure — the same env yields the same result and the input is not mutated", () => {
    const env = approved("delete");
    const snapshot = JSON.stringify(env);
    expect(resolveGatedWingProbeScope(env)).toEqual(resolveGatedWingProbeScope(env));
    expect(JSON.stringify(env)).toBe(snapshot);
  });
});

describe("the manifest's own scope resolution is unchanged", () => {
  it("still maps an absent/empty request to the FULL fixed set (the manifest then displays all six)", () => {
    expect(resolveWingProbeScope(undefined)).toEqual({ ok: true, targets: [...WING_PROBE_TARGET_NAMES] });
    expect(resolveWingProbeScope("")).toEqual({ ok: true, targets: [...WING_PROBE_TARGET_NAMES] });
  });

  it("still narrows and still fails closed on an unknown target", () => {
    expect(resolveWingProbeScope("delete")).toEqual({ ok: true, targets: ["delete"] });
    expect(resolveWingProbeScope("delete,nope").ok).toBe(false);
  });
});

describe("the live CLI wires the gate, not the manifest resolver", () => {
  const source = readFileSync(fileURLToPath(new URL("../../src/cli/probe-wing-issuance-selectors.ts", import.meta.url)), "utf8");
  const code = source
    .split("\n")
    .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"))
    .join("\n");

  it("calls the gated resolver and never the defaulting one", () => {
    expect(code).toContain("resolveGatedWingProbeScope(process.env)");
    expect(code).not.toContain("resolveWingProbeScope(");
  });

  /** The body of a brace-delimited block starting at `header`, so a guard can assert what the branch DOES. */
  function branchBody(src: string, header: string): string {
    const at = src.indexOf(header);
    expect(at, `branch not found: ${header}`).toBeGreaterThan(-1);
    let depth = 0;
    for (let i = at + header.length - 1; i < src.length; i++) {
      if (src[i] === "{") depth++;
      else if (src[i] === "}" && --depth === 0) return src.slice(at + header.length, i);
    }
    throw new Error(`unbalanced braces after ${header}`);
  }

  it("derives the measured set from the GATE's targets, not from the fixed set", () => {
    // The tested derivation is only worth anything if the CLI actually feeds it the approved targets.
    expect(code).toContain("scopedRecordTargetsFor(probeScope.targets)");
    expect(code).toMatch(/runWingSelectorRecord\(deps, scopedTargets[,)]/);
  });

  it("the RECON refusal STOPS the run — it does not fall through to a baseline probe", () => {
    // Found by review: the previous version asserted only the branch HEADER, so deleting `process.exitCode = 2;
    // return;` left every test green. Under that deletion a run whose approved scope contains a non-sweepable
    // target prints the refusal, launches Chrome, sweeps nothing, and prints a successful-looking baseline
    // record for work the operator never approved.
    expect(branchBody(code, "if (reconScope.requested && !reconScope.ok) {")).toMatch(
      /process\.exitCode = 2;[\s\S]*return;/,
    );
  });

  it("gates the RECON scope BEFORE the browser launches, like the scope gate above", () => {
    const gateAt = code.indexOf("resolveWingReconScope(process.env, probeScope.targets)");
    expect(gateAt).toBeGreaterThan(-1);
    for (const sideEffect of ["loadConfig()", "mkdirSync(", "await launchNaverContext("]) {
      expect(gateAt, `recon gate must precede ${sideEffect}`).toBeLessThan(code.indexOf(sideEffect));
    }
  });

  it("derives the RECON scope from the same approved set, and refuses rather than downgrading", () => {
    // Recon is a second, narrower gate over the SAME approved targets — never a separately-parsed env scope,
    // which would reintroduce exactly the two-sources-of-truth problem the approved-scope gate removed. And a
    // refusal must stop the run: silently continuing as a baseline probe would measure something other than
    // the manifest the operator approved, while still printing a successful-looking record.
    expect(code).toContain("resolveWingReconScope(process.env, probeScope.targets)");
    expect(code).toMatch(/if \(reconScope\.requested && !reconScope\.ok\) \{/);
    // The gated variables are what reach the recorder — asserted by NAME rather than as one exact literal, so
    // adding a second gated scope (the Stage-2 sweep) does not read as the recon scope being unwired.
    expect(code).toMatch(/runWingSelectorRecord\(deps, scopedTargets, \{[^}]*recon: reconTargets[^}]*\}\)/);
    expect(code).toMatch(/runWingSelectorRecord\(deps, scopedTargets, \{[^}]*stage2: stage2Targets[^}]*\}\)/);
  });

  it("a STAGE-2 run resolves an EMPTY baseline probe scope — it measures no shipped locator", () => {
    // Tested HERE because it is decided in `main()`, which is unexported and launches Chrome. The orchestrator
    // test passes `[]` explicitly, so it proves the recorder honours an empty scope — not that main() computes
    // one. The mutation battery found exactly that gap: reverting this line to the unconditional resolver left
    // every unit test green while a Stage-2 run would probe the three shipped labels on the purpose screen.
    expect(code).toMatch(/const probeScope = isStage2Run \? \(\{ ok: true, targets: \[\] \} as const\) : resolveGatedWingProbeScope\(process\.env\)/);
    // …and `isStage2Run` is derived from the two-sided gate, never from a single variable.
    expect(code).toContain("const stage2Scope = resolveWingStage2Scope(process.env);");
    expect(code).toContain("const isStage2Run = stage2Targets.length > 0;");
    // The Stage-2 gate must be evaluated BEFORE the probe scope it overrides.
    expect(code.indexOf("resolveWingStage2Scope(process.env)")).toBeLessThan(code.indexOf("const probeScope ="));
    // A refusal from the Stage-2 gate stops the run rather than falling through to a baseline probe.
    expect(code).toMatch(/if \(stage2Scope\.requested && !stage2Scope\.ok\) \{/);
  });

  it("keeps the refusal branch — deleting it must not need the typechecker to be caught", () => {
    // Without this, removing `if (!probeScope.ok) { … }` is caught only by `tsc` (the discriminated union
    // stops compiling), so `npm test` alone would stay green on a deleted safety branch.
    // Scoped to the branch BODY. `process.exitCode = 2` now also appears in the recon refusal below, so a bare
    // substring check no longer distinguishes them — deleting this branch's body would leave it green, with the
    // deletion caught only by `tsc`, which is exactly what this test exists to avoid relying on.
    expect(branchBody(code, "if (!probeScope.ok) {")).toMatch(/process\.exitCode = 2;[\s\S]*return;/);
  });

  it("gates the scope BEFORE the browser launches AND before any side effect", () => {
    // Compare CALL SITES, not the import lines (both symbols appear in the import block first). The gate must
    // precede the filesystem/profile work too, not merely the launch — a refusal should touch nothing.
    const gateAt = code.indexOf("resolveGatedWingProbeScope(process.env)");
    expect(gateAt).toBeGreaterThan(-1);
    // Each string must be a CALL inside main(), not a definition earlier in the file.
    for (const sideEffect of ["loadConfig()", "mkdirSync(", "removeSentinel(readyPath)", "process.on(", "await launchNaverContext("]) {
      const at = code.indexOf(sideEffect);
      expect(at, `${sideEffect} should exist`).toBeGreaterThan(-1);
      expect(gateAt, `gate must precede ${sideEffect}`).toBeLessThan(at);
    }
  });
});

/**
 * The one line standing between "approved" and "measured". A source guard cannot see an in-place edit here
 * (widening it back to the full fixed set leaves every text assertion green), so it is tested directly.
 */
describe("scopedRecordTargetsFor — the approved set is what gets measured", () => {
  it("returns exactly the approved set, in canonical order, for every subset", () => {
    expect(scopedRecordTargetsFor(["delete"])).toEqual(["delete"]);
    expect(scopedRecordTargetsFor(["credentials", "issue"])).toEqual(["issue", "credentials"]);
    expect(scopedRecordTargetsFor([...WING_RECORD_TARGETS])).toEqual([...WING_RECORD_TARGETS]);
  });

  it("never adds a target the gate did not approve", () => {
    for (const approvedSet of [["delete"], ["issue"], ["self_dev", "delete"], ["issue", "credentials"]] as const) {
      const measured = scopedRecordTargetsFor([...approvedSet]);
      expect(measured.length).toBe(approvedSet.length);
      for (const t of measured) expect(approvedSet).toContain(t);
    }
  });

  it("an empty approved set measures nothing (it can never mean 'everything')", () => {
    expect(scopedRecordTargetsFor([])).toEqual([]);
  });
});
