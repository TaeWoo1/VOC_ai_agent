/**
 * The candidate-label RECON runner — the live wiring the previous unit deliberately left undone.
 *
 * Recon sweeps SEVERAL unvalidated label hypotheses per target instead of the shipped baselines, so it is a
 * materially different operation from an ordinary probe run and gets its own gate on top of the approved-scope
 * gate. Three properties are what these tests exist for:
 *
 *  1. **A baseline run is untouched.** Recon is opt-in by APPROVED PHASE; every other run behaves exactly as it
 *     did before recon existed, including emitting no recon field at all.
 *  2. **Approved scope == swept scope.** A phase mismatch, an empty scope, or one non-sweepable target refuses
 *     BEFORE the browser launches, rather than silently sweeping a subset the manifest did not describe.
 *  3. **A failed reading is never a measured zero.** A candidate whose read-only probe threw is `NOT_MEASURED`
 *     with a null count — the distinction the whole classifier correction was about, applied one level down.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WING_LABEL_RECON_PHASE,
  WING_APPROVAL_PHASE_ENV,
  WING_APPROVED_PHASE_ENV,
  WING_RECON_REFUSALS,
  reconRecordFor,
  reconRefusalMessage,
  resolveWingReconScope,
  runWingSelectorRecord,
  type WingRecordSignal,
  type WingRecordTarget,
  type WingSelectorRecordDeps,
} from "../../src/cli/probe-wing-issuance-selectors";
import {
  WING_LABEL_RECON_CANDIDATES,
  WING_RECON_TARGETS,
  WING_RECON_VERDICTS,
  type WingReconTarget,
} from "../../src/action-window/coupang-wing-label-recon";
import { WING_PROBE_TARGET_NAMES, type WingObservation } from "../../src/cli/coupang-wing-classifier";

const RECON_ALL = [...WING_RECON_TARGETS] as WingReconTarget[];
const CANDIDATE_COUNT = RECON_ALL.reduce((n, t) => n + WING_LABEL_RECON_CANDIDATES[t].length, 0);

const OBS: WingObservation = {
  urlCategory: "wing_host",
  pageCategory: "open_api_issuance",
  signals: {
    urlCategory: "wing_host",
    passwordFieldPresent: false,
    submitAffordancePresent: false,
    formCountBucket: "few",
    editableTextInputCountBucket: "many",
    readonlyFieldCountBucket: "none",
    listLikeContainerCountBucket: "many",
    openApiMarkerPresent: false,
    credentialAnchorPresent: true,
    markerScanTruncated: false,
  },
  blockers: ["LIVE_DOM_CALIBRATION_PENDING"],
};

/**
 * The sweep passes a driver SPEC down, not a candidate id, so the fake resolves the spec back to the id it came
 * from. Keying on the label alone would be wrong — three `vendor_info` candidates share the text `업체명` and
 * differ only by structural query, which is the entire point of measuring them separately.
 */
const ID_BY_SPEC = new Map<string, string>(
  RECON_ALL.flatMap((t) =>
    WING_LABEL_RECON_CANDIDATES[t].map((c) => [`${c.candidateQuery}|${c.exactText}`, c.id] as const),
  ),
);

interface FakeOptions {
  /** Per-candidate reading keyed by candidate id. Unlisted candidates read as a genuine zero. */
  byId?: Record<string, { matchCount: number; canHighlight: boolean; sig?: string }>;
  /** Candidate ids whose read-only probe should THROW, mapped to the error to throw. */
  throwOn?: Record<string, Error>;
  signal?: WingRecordSignal;
  /** Omit the `probeCandidate` seam entirely — a recon run that cannot measure anything. */
  noCandidateSeam?: boolean;
}

function fakeDeps(o: FakeOptions = {}): {
  deps: WingSelectorRecordDeps;
  probedTargets: WingRecordTarget[];
  probedCandidates: string[];
} {
  const probedTargets: WingRecordTarget[] = [];
  const probedCandidates: string[] = [];
  const deps: WingSelectorRecordDeps = {
    waitForReady: async () => o.signal ?? "ready",
    observeSurface: async () => OBS,
    probeTarget: async (target) => {
      probedTargets.push(target);
      return { matchCount: 0, canHighlight: false };
    },
    announce: () => undefined,
  };
  if (!o.noCandidateSeam) {
    deps.probeCandidate = async (spec) => {
      const id = ID_BY_SPEC.get(`${spec.candidateQuery}|${spec.exactText}`);
      // A spec the candidate sets do not contain means the sweep invented one — fail loudly, never silently 0.
      expect(id, `unrecognized candidate spec: ${JSON.stringify(spec)}`).toBeDefined();
      probedCandidates.push(id!);
      const boom = o.throwOn?.[id!];
      if (boom) throw boom;
      return o.byId?.[id!] ?? { matchCount: 0, canHighlight: false };
    };
  }
  return { deps, probedTargets, probedCandidates };
}

/** Both phase variables set to the same value — what the preflight binds and prints. */
const reconEnv = (
  run: string = WING_LABEL_RECON_PHASE,
  approved: string = WING_LABEL_RECON_PHASE,
): Record<string, string> => ({ [WING_APPROVAL_PHASE_ENV]: run, [WING_APPROVED_PHASE_ENV]: approved });

/* ────────────────────────────── the recon phase gate ────────────────────────────── */

describe("resolveWingReconScope — recon is armed by the APPROVED PHASE, never inferred", () => {
  it("no phase variable at all leaves the recorder in ordinary baseline mode", () => {
    expect(resolveWingReconScope({}, ["self_dev"])).toEqual({ requested: false });
  });

  it("any other approved phase leaves it in baseline mode — including the phase that ships today", () => {
    for (const phase of ["COUPANG_WING_SELECTOR_PROBE", "COUPANG_WING_KEY_DELETION", "", "coupang_wing_label_recon"]) {
      expect(resolveWingReconScope(reconEnv(phase, phase), ["self_dev"]), phase).toEqual({ requested: false });
    }
  });

  it("a phase left over in the shell CANNOT arm recon under a manifest approved for the probe", () => {
    // Found by review, and it falsified this unit's headline claim. An operator who ran recon earlier and
    // exported the phase, then approves an ordinary probe manifest for the same three shipped labels, would
    // have got a 12-hypothesis sweep: the scope gate cannot see it, because the target set is identical.
    const stale = { [WING_APPROVAL_PHASE_ENV]: WING_LABEL_RECON_PHASE }; // no approved-phase binding
    const r = resolveWingReconScope(stale, ["self_dev", "vendor_info", "call_ip"]);
    expect(r).toMatchObject({ requested: true, ok: false, refusal: "PHASE_APPROVAL_MISMATCH" });
  });

  it("an approved recon manifest run WITHOUT the phase refuses instead of quietly measuring the baselines", () => {
    // The converse, and the more insidious one: the run would look successful while measuring the shipped
    // labels the operator did not ask about, under a manifest that promised a candidate sweep.
    const forgotten = { [WING_APPROVED_PHASE_ENV]: WING_LABEL_RECON_PHASE };
    const r = resolveWingReconScope(forgotten, ["self_dev", "vendor_info", "call_ip"]);
    expect(r).toMatchObject({ requested: true, ok: false, refusal: "PHASE_APPROVAL_MISMATCH" });
  });

  it("the runner is not MORE permissive about the phase than the harness that authorizes it", () => {
    // `wing-probe-bootstrap.sh` and the preflight both use an exact `case` allowlist. A trimming runner would
    // accept spellings the authorizing gate refuses — so the phase match is exact on both sides.
    for (const v of ["COUPANG_WING_LABEL_RECON ", " COUPANG_WING_LABEL_RECON", "COUPANG_WING_LABEL_RECON\n", "\tCOUPANG_WING_LABEL_RECON"]) {
      expect(resolveWingReconScope(reconEnv(v, v), ["self_dev"]), JSON.stringify(v)).toEqual({ requested: false });
    }
  });

  it("the recon phase with a fully sweepable scope arms the sweep, in the approved order", () => {
    const r = resolveWingReconScope(reconEnv(), ["self_dev", "vendor_info", "call_ip"]);
    expect(r).toEqual({ requested: true, ok: true, targets: ["self_dev", "vendor_info", "call_ip"] });
  });

  it("a NARROWER scope is fine — one target is a legitimate recon run", () => {
    const r = resolveWingReconScope(reconEnv(), ["call_ip"]);
    expect(r).toEqual({ requested: true, ok: true, targets: ["call_ip"] });
  });

  it("ONE non-sweepable approved target refuses the whole run — not a quiet sweep of the rest", () => {
    // The manifest the operator read described a target set. Sweeping a subset of it would mean the record and
    // the approval describe different work, which is precisely what "approved scope == measured scope" forbids.
    const r = resolveWingReconScope(reconEnv(), ["self_dev", "delete"]);
    expect(r).toMatchObject({ requested: true, ok: false, refusal: "RECON_TARGET_NOT_APPROVED" });
    expect((r as { reason: string }).reason).toContain("delete");
  });

  it("every baseline-only target is refused under the recon phase", () => {
    for (const t of ["issue", "credentials", "delete"] as WingRecordTarget[]) {
      const r = resolveWingReconScope(reconEnv(), [t]);
      expect(r, t).toMatchObject({ ok: false, refusal: "RECON_TARGET_NOT_APPROVED" });
    }
  });

  it("an empty approved scope refuses rather than sweeping nothing and reporting success", () => {
    const r = resolveWingReconScope(reconEnv(), []);
    expect(r).toMatchObject({ requested: true, ok: false, refusal: "RECON_SCOPE_EMPTY" });
  });

  it("an INHERITED phase key cannot arm recon — own properties only", () => {
    // Same discipline as the scope gate: a prototype-polluted env must not decide what a live run measures.
    const env = Object.create(reconEnv()) as Record<string, string>;
    expect(resolveWingReconScope(env, ["self_dev"])).toEqual({ requested: false });
  });

  it("a non-string phase value cannot arm recon and does not throw", () => {
    for (const v of [1, true, null, undefined, {}, ["COUPANG_WING_LABEL_RECON"]]) {
      const env = { [WING_APPROVAL_PHASE_ENV]: v, [WING_APPROVED_PHASE_ENV]: v } as unknown as Record<string, string | undefined>;
      expect(resolveWingReconScope(env, ["self_dev"]), String(v)).toEqual({ requested: false });
    }
  });

  it("refuses without echoing an unrecognized token — it reports a COUNT", () => {
    // The reason reaches stderr, and an env-derived scope may hold whatever the operator mistyped there: a
    // path, a seller id, even a credential. Only names this module can vouch for are ever printed back.
    const hostile = ["ACCESS-KEY-abc123", "/Users/someone/secret", "vendor@example.com"] as unknown as WingRecordTarget[];
    const r = resolveWingReconScope(reconEnv(), hostile);
    expect(r).toMatchObject({ ok: false, refusal: "RECON_TARGET_NOT_APPROVED" });
    const reason = (r as { reason: string }).reason;
    for (const token of hostile) expect(reason, token).not.toContain(token);
    expect(reason).toContain("unrecognized token(s): 3");
  });

  it("the refusal MESSAGE carries only the closed enum and the gate's own reason", () => {
    for (const refusal of WING_RECON_REFUSALS) {
      const msg = reconRefusalMessage(refusal, "reason text");
      expect(msg).toContain(refusal);
      expect(msg).toContain("No browser launched.");
    }
  });
});

/* ────────────────────────────── the sweep itself ────────────────────────────── */

describe("the recon sweep — measures candidates, decides nothing", () => {
  it("a run with no recon scope emits NO recon field and never touches the candidate seam", async () => {
    const { deps, probedCandidates } = fakeDeps();
    const result = await runWingSelectorRecord(deps, ["self_dev"]);
    expect(result.recon).toBeNull();
    expect(probedCandidates).toEqual([]);
  });

  it("a recon run measures every candidate of every scoped target, through the candidate seam only", async () => {
    const { deps, probedTargets, probedCandidates } = fakeDeps();
    const result = await runWingSelectorRecord(deps, [...RECON_ALL], { recon: RECON_ALL });
    expect(probedCandidates).toHaveLength(CANDIDATE_COUNT);
    // The baseline targets are still probed too — the sweep adds to the record, it does not replace it.
    expect(probedTargets).toEqual(RECON_ALL);
    expect(result.recon!.targets.map((t) => t.target)).toEqual(RECON_ALL);
    expect(result.recon!.candidatesMeasured).toBe(CANDIDATE_COUNT);
    expect(result.recon!.candidatesNotMeasured).toBe(0);
    expect(result.recon!.phase).toBe(WING_LABEL_RECON_PHASE);
  });

  it("a UNIQUE candidate is recorded with its signature — and the shipped label is unchanged by the run", async () => {
    const { deps } = fakeDeps({ byId: { "call_ip.nospace": { matchCount: 1, canHighlight: true, sig: "abcdef0123456789" } } });
    const result = await runWingSelectorRecord(deps, ["call_ip"], { recon: ["call_ip"] });
    const target = result.recon!.targets.find((t) => t.target === "call_ip")!;
    const hit = target.candidates.find((c) => c.id === "call_ip.nospace")!;
    expect([hit.verdict, hit.matchCount, hit.sig16]).toEqual(["UNIQUE", 1, "abcdef0123456789"]);
    expect(target.resolvedUnambiguously).toBe(true);
    // Nothing in the result is an instruction to change a locator — only ids, counts and signatures.
  });

  it("a candidate whose probe THREW is NOT_MEASURED with a null count — never a measured zero", async () => {
    // The sweep's core honesty property. A page that navigates mid-sweep must not turn every remaining label
    // into "confirmed absent", which is exactly what a `catch → 0` would produce.
    const { deps } = fakeDeps({
      throwOn: { "call_ip.nospace": new Error("Execution context was destroyed, most likely because of a navigation") },
      byId: { "call_ip.baseline": { matchCount: 4, canHighlight: false } },
    });
    const result = await runWingSelectorRecord(deps, ["call_ip"], { recon: ["call_ip"] });
    const cands = result.recon!.targets[0]!.candidates;
    const failed = cands.find((c) => c.id === "call_ip.nospace")!;
    expect([failed.verdict, failed.matchCount]).toEqual(["NOT_MEASURED", null]);
    // …while the candidates that DID read are still recorded, with their real counts.
    expect(cands.find((c) => c.id === "call_ip.baseline")!.matchCount).toBe(4);
    expect(result.recon!.faults).toEqual([{ id: "call_ip.nospace", fault: "CONTEXT_DESTROYED" }]);
    expect(result.recon!.candidatesNotMeasured).toBe(1);
  });

  it("a fault never leaks the raw error message — only the closed fingerprint", async () => {
    const secretish = new Error("navigating to https://wing.coupang.com/seller/9182736?token=abcdef timed out");
    const { deps } = fakeDeps({ throwOn: { "call_ip.baseline": secretish } });
    const result = await runWingSelectorRecord(deps, ["call_ip"], { recon: ["call_ip"] });
    const serialized = JSON.stringify(result.recon);
    expect(result.recon!.faults[0]!.fault).toBe("TIMEOUT");
    for (const fragment of ["wing.coupang.com", "9182736", "token=abcdef", "navigating to"]) {
      expect(serialized, fragment).not.toContain(fragment);
    }
  });

  it("a missing candidate seam yields an all-NOT_MEASURED sweep rather than throwing away the baseline record", async () => {
    const { deps } = fakeDeps({ noCandidateSeam: true });
    const result = await runWingSelectorRecord(deps, ["call_ip"], { recon: ["call_ip"] });
    expect(result.targets.map((t) => t.target)).toEqual(["call_ip"]); // the baseline record survived
    expect(result.recon!.candidatesMeasured).toBe(0);
    expect(result.recon!.candidatesNotMeasured).toBe(WING_LABEL_RECON_CANDIDATES.call_ip.length);
    expect(result.recon!.targets[0]!.candidates.every((c) => c.matchCount === null)).toBe(true);
  });

  it("an aborted or timed-out run reports recon as NULL, not as an empty sweep", async () => {
    // An empty sweep would read as "swept, found nothing". Null says the sweep never happened — the same
    // measured-vs-unmeasured distinction the per-candidate verdict draws, one level up.
    for (const signal of ["abort", "timeout"] as WingRecordSignal[]) {
      const { deps, probedCandidates } = fakeDeps({ signal });
      const result = await runWingSelectorRecord(deps, [...RECON_ALL], { recon: RECON_ALL });
      expect(result.recon, signal).toBeNull();
      expect(probedCandidates, signal).toEqual([]);
    }
  });

  it("two simultaneously-unique candidates are recorded, with signatures, and NOT resolved", async () => {
    // The live-plausible shape for `vendor_info`: the broad baseline still matches 8, while two NARROWER
    // structural queries for the same word each match exactly one. Whether that is one element wearing two
    // labels or two different elements is what the signatures answer — and the module must not guess.
    const { deps } = fakeDeps({
      byId: {
        "vendor_info.baseline": { matchCount: 8, canHighlight: false },
        "vendor_info.label_only": { matchCount: 1, canHighlight: true, sig: "1111111111111111" },
        "vendor_info.th_dt": { matchCount: 1, canHighlight: true, sig: "2222222222222222" },
        "vendor_info.vendor_name": { matchCount: 0, canHighlight: false },
      },
    });
    const result = await runWingSelectorRecord(deps, ["vendor_info"], { recon: ["vendor_info"] });
    const t = result.recon!.targets[0]!;
    expect(t.uniqueCandidateIds).toEqual(["vendor_info.label_only", "vendor_info.th_dt"]);
    expect(t.resolvedUnambiguously).toBe(false);
    // Different signatures ⇒ genuinely different elements, which is why auto-picking the first would be a bug.
    expect(t.candidates.filter((c) => c.verdict === "UNIQUE").map((c) => c.sig16)).toEqual([
      "1111111111111111",
      "2222222222222222",
    ]);
  });
});

/* ────────────────────────────── the printed record ────────────────────────────── */

describe("reconRecordFor — the printed shape carries counts, booleans and our own constants", () => {
  it("null in, null out — a baseline run prints no recon object", () => {
    expect(reconRecordFor(null)).toBeNull();
  });

  it("canHighlight is derived from the VERDICT, so NOT_MEASURED never claims a count it lacks", async () => {
    const { deps } = fakeDeps({
      throwOn: { "call_ip.nospace": new Error("Target closed") },
      byId: { "call_ip.baseline": { matchCount: 1, canHighlight: true, sig: "0f0f0f0f0f0f0f0f" } },
    });
    const result = await runWingSelectorRecord(deps, ["call_ip"], { recon: ["call_ip"] });
    const rows = reconRecordFor(result.recon)!.targets[0]!.candidates;
    const unmeasured = rows.find((r) => r.id === "call_ip.nospace")!;
    expect([unmeasured.verdict, unmeasured.matchCount, unmeasured.canHighlight]).toEqual([
      "NOT_MEASURED",
      null,
      false,
    ]);
    const unique = rows.find((r) => r.id === "call_ip.baseline")!;
    expect([unique.verdict, unique.canHighlight, unique.sig16]).toEqual(["UNIQUE", true, "0f0f0f0f0f0f0f0f"]);
  });

  it("canHighlight is TRUE for exactly one verdict — UNIQUE", async () => {
    // Found by mutation: deriving `canHighlight` from `matchCount !== null` instead of from the verdict passed
    // the test above, because its only measured row happened to be UNIQUE. Under that derivation a candidate
    // matching ZERO elements reports `canHighlight: true` — a label that resolves to nothing described as
    // highlightable. Every verdict is exercised here so the mapping cannot be re-derived loosely.
    const { deps } = fakeDeps({
      byId: {
        "call_ip.baseline": { matchCount: 0, canHighlight: false },
        "call_ip.nospace": { matchCount: 1, canHighlight: true, sig: "0f0f0f0f0f0f0f0f" },
        "call_ip.lower": { matchCount: 6, canHighlight: false },
        "call_ip.ip_addr": { matchCount: -3, canHighlight: false },
      },
    });
    const result = await runWingSelectorRecord(deps, ["call_ip"], { recon: ["call_ip"] });
    const rows = reconRecordFor(result.recon)!.targets[0]!.candidates;
    expect(rows.map((r) => [r.verdict, r.canHighlight])).toEqual([
      ["ABSENT", false],
      ["UNIQUE", true],
      ["AMBIGUOUS", false],
      ["INVALID_COUNT", false],
    ]);
    // …and the property stated directly, so a new verdict added later has to face it too.
    for (const r of rows) expect(r.canHighlight, r.verdict).toBe(r.verdict === "UNIQUE");
  });

  it("each row carries its own fixed label and the target's expected role", async () => {
    const { deps } = fakeDeps();
    const result = await runWingSelectorRecord(deps, [...RECON_ALL], { recon: RECON_ALL });
    for (const t of reconRecordFor(result.recon)!.targets) {
      const expected = WING_LABEL_RECON_CANDIDATES[t.target as WingReconTarget];
      expect(t.candidates.map((c) => [c.id, c.label])).toEqual(expected.map((c) => [c.id, c.exactText]));
      for (const c of t.candidates) expect(c.role.length, c.id).toBeGreaterThan(0);
    }
  });

  it("every string in the printed record is a known constant or an opaque signature", async () => {
    // The whole-payload allowlist: page content could not satisfy it whatever field it arrived through.
    const { deps } = fakeDeps({
      byId: { "self_dev.baseline": { matchCount: 1, canHighlight: true, sig: "9999999999999999" } },
      throwOn: { "self_dev.spaced": new Error("Target page, context or browser has been closed") },
    });
    const result = await runWingSelectorRecord(deps, [...RECON_ALL], { recon: RECON_ALL });
    const allowed = new Set<string>([
      WING_LABEL_RECON_PHASE,
      ...WING_PROBE_TARGET_NAMES,
      ...(WING_RECON_VERDICTS as readonly string[]),
      "option",
      "field-label",
      "button",
      "readonly-region",
      "CONTEXT_DESTROYED",
      "TARGET_CLOSED",
      "TIMEOUT",
      "EVAL_FAILED",
      "UNKNOWN",
      ...RECON_ALL.flatMap((t) => WING_LABEL_RECON_CANDIDATES[t].flatMap((c) => [c.id, c.exactText])),
    ]);
    const strings: string[] = [];
    const walk = (v: unknown): void => {
      if (typeof v === "string") strings.push(v);
      else if (Array.isArray(v)) v.forEach(walk);
      else if (v && typeof v === "object") Object.values(v).forEach(walk);
    };
    walk(reconRecordFor(result.recon));
    expect(strings.length).toBeGreaterThan(40);
    for (const s of strings) {
      if (/^[0-9a-f]{16}$/.test(s)) continue;
      expect(allowed.has(s), `unexpected string in the printed record: ${JSON.stringify(s)}`).toBe(true);
    }
  });
});

/* ────────────────────────────── source guard ────────────────────────────── */

describe("the recon runner cannot promote a candidate during a live run", () => {
  const CLI = resolve(dirname(fileURLToPath(import.meta.url)), "../../src/cli/probe-wing-issuance-selectors.ts");
  const src = readFileSync(CLI, "utf8");
  const code = src
    .replace(/\/\*[\s\S]*?\*\//g, "")
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");

  it("never assigns to the shipped label tables", () => {
    // A live run recording "candidate X is unique" must not be one edit away from also applying it.
    for (const table of ["WING_HIGHLIGHT_LABELS", "WING_DELETION_LABELS", "WING_LABEL_RECON_CANDIDATES"]) {
      expect(new RegExp(`${table}\\s*(\\[[^\\]]*\\])?\\s*(\\.[A-Za-z_$][\\w$]*\\s*)*=[^=]`).test(code), table).toBe(
        false,
      );
    }
  });

  it("builds no in-page script of its own — the sweep goes through the driver seam", () => {
    for (const forbidden of ["buildFixedLabelProbeScript", "buildFixedLabelLocateScript", ".evaluate(", "document."]) {
      expect(code, `recon must not reach for ${forbidden}`).not.toContain(forbidden);
    }
    expect(code).toContain("probeFixedLabelMatch");
  });
});
