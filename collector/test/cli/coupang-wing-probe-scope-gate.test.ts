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

  it("gates the scope BEFORE the browser launches", () => {
    // Compare CALL SITES, not the import lines (both symbols appear in the import block first).
    const gateAt = code.indexOf("resolveGatedWingProbeScope(process.env)");
    const launchAt = code.indexOf("await launchNaverContext(");
    expect(gateAt).toBeGreaterThan(-1);
    expect(launchAt).toBeGreaterThan(-1);
    expect(gateAt).toBeLessThan(launchAt);
  });

  it("prints only the refusal enum, never a raw env value", () => {
    expect(code).toContain("probeScope.refusal");
    expect(code).not.toContain("process.env.SELLEROPS_WING_PROBE_TARGETS");
  });
});
