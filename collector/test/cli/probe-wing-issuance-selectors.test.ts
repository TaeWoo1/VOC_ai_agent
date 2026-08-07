/**
 * The Coupang WING READ-ONLY selector/structure RECORDER, on two fronts:
 *  1. a SOURCE GUARD proving the recorder structurally cannot click/type/submit/navigate or read any field
 *     value/screenshot/DOM — it only observes + counts (mirrors the driver's own guard), and is inert on import;
 *  2. the pure orchestrator, driven offline over fake seams (no browser, no WING), locking that it measures every
 *     candidate read-only, tallies uniqueness honestly, recovers on abort/timeout, and emits ONLY a value-free
 *     calibration record — never a selector, field value, PII, raw DOM/HTML, screenshot, or raw URL.
 */
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import {
  WING_RECORD_TARGETS,
  WING_TARGET_ROLE,
  runWingSelectorRecord,
  wingFaultFingerprint,
  type WingRecordSignal,
  type WingRecordTarget,
  type WingSelectorRecordDeps,
} from "../../src/cli/probe-wing-issuance-selectors";
import type { WingObservation } from "../../src/cli/coupang-wing-classifier";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../../src/cli/probe-wing-issuance-selectors.ts");

/** Strip block comments + comment/JSDoc lines so prose mentioning a forbidden token never trips the guard. */
function codeOnly(path: string): string {
  const raw = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return raw
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

const NO_ACTION_TOKENS = [
  ".click(",
  ".dblclick(",
  ".tap(",
  ".hover(",
  ".type(",
  ".fill(",
  ".press(",
  ".check(",
  ".uncheck(",
  ".selectOption(",
  ".setInputFiles(",
  ".keyboard",
  "dispatchEvent",
  ".submit(",
  'waitForEvent("download"',
  "waitForEvent('download'",
] as const;

const NO_VALUE_READ_TOKENS = [
  ".inputValue(",
  ".value",
  ".textContent",
  ".innerText",
  ".innerHTML",
  ".outerHTML",
  ".getAttribute(",
  ".getProperty(",
  ".getProperties(",
  "page.content(",
  "clipboard",
  "readText(",
  ".screenshot(",
] as const;

const NO_NInVIGATE_TOKENS = [".goto(", ".goBack(", ".goForward(", ".reload(", "waitForNavigation", "window.open"] as const;

describe("probe-wing-issuance-selectors — source guard (read-only recorder)", () => {
  const code = codeOnly(CLI);

  it.each(NO_ACTION_TOKENS)("never contains %s", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_NInVIGATE_TOKENS)("never navigates the seller's own window (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("is gated on the Coupang WING approval flag and fails closed on a bad URL before launch", () => {
    expect(code).toContain("hasCoupangWingRunApproval");
    // A NAVER grant must never open WING.
    expect(code).not.toContain("hasLiveRunApproval");
    expect(code).toContain("screenWingUrl");
    expect(code).toContain("COUPANG_WING_URL");
  });

  it("main() runs only when invoked directly — inert on import", () => {
    expect(code).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });

  it("keeps the calibration honest — always reports LIVE_DOM_CALIBRATION_PENDING, flips no SELECTORS_CALIBRATED flag", () => {
    expect(code).toContain("LIVE_DOM_CALIBRATION_PENDING");
    expect(code).not.toContain("SELECTORS_CALIBRATED");
  });

  it("prints only the sanitized calibration record via JSON.stringify — never page.url()/content() directly", () => {
    expect(/console\.log\([^)]*page\.(url|content)/.test(code)).toBe(false);
    expect(code).toContain("JSON.stringify(");
  });
});

/* ────────────────────────────── pure orchestrator over fakes ────────────────────────────── */

const OBS: WingObservation = {
  urlCategory: "wing_host",
  pageCategory: "open_api_issuance",
  signals: {
    urlCategory: "wing_host",
    passwordFieldPresent: false,
    submitAffordancePresent: true,
    formCountBucket: "few",
    editableTextInputCountBucket: "few",
    readonlyFieldCountBucket: "none",
    listLikeContainerCountBucket: "few",
    openApiMarkerPresent: true,
    credentialAnchorPresent: false,
  },
  blockers: ["LIVE_DOM_CALIBRATION_PENDING"],
};

const UNIQUE = { matchCount: 1, canHighlight: true, sig: "a1b2c3d4e5f60718" };

interface FakeOptions {
  matches?: Partial<Record<WingRecordTarget, { matchCount: number; canHighlight: boolean; sig?: string }>>;
  signal?: WingRecordSignal;
}

function fakeDeps(o: FakeOptions = {}): { deps: WingSelectorRecordDeps; probed: WingRecordTarget[] } {
  const probed: WingRecordTarget[] = [];
  const deps: WingSelectorRecordDeps = {
    waitForReady: async () => o.signal ?? "ready",
    observeSurface: async () => OBS,
    probeTarget: async (target) => {
      probed.push(target);
      return o.matches?.[target] ?? UNIQUE;
    },
    announce: () => undefined,
  };
  return { deps, probed };
}

describe("wing selector recorder — read-only walk", () => {
  it("probes exactly the highlightable candidates + the delete control (never the guidance-only reach_open_api/return)", async () => {
    const { deps, probed } = fakeDeps();
    await runWingSelectorRecord(deps);
    expect(probed).toEqual(["self_dev", "vendor_info", "call_ip", "issue", "credentials", "delete"]);
    expect(WING_RECORD_TARGETS).not.toContain("reach_open_api" as WingRecordTarget);
    expect(WING_RECORD_TARGETS).not.toContain("return" as WingRecordTarget);
  });

  it("records each candidate's matchCount + role + fixed-label + sig16, and tallies uniqueness honestly", async () => {
    const { deps } = fakeDeps();
    const result = await runWingSelectorRecord(deps);

    expect(result.aborted).toBe(false);
    expect(result.observation).toEqual(OBS);
    expect(result.uniqueCandidates).toBe(6);
    expect(result.nonUniqueCandidates).toBe(0);
    expect(result.calibration).toBe("LIVE_DOM_CALIBRATION_PENDING");

    const issue = result.targets.find((t) => t.target === "issue")!;
    expect(issue.matchCount).toBe(1);
    expect(issue.canHighlight).toBe(true);
    expect(issue.role).toBe(WING_TARGET_ROLE.issue);
    expect(issue.label).toBe("발급");
    expect(issue.sig16).toBe("a1b2c3d4e5f60718");
  });

  it("measures the 삭제 (delete) control read-only as a button candidate on the already-issued page", async () => {
    // The delete candidate rides the SAME already-issued page as issue/credentials; the recorder COUNTS it
    // value-free (so a later live run can calibrate 삭제) — it is never highlighted or pressed here.
    const { deps } = fakeDeps({ matches: { delete: { matchCount: 1, canHighlight: true, sig: "dede1234dede5678" } } });
    const result = await runWingSelectorRecord(deps);
    const del = result.targets.find((t) => t.target === "delete")!;
    expect(del.role).toBe("button");
    expect(del.label).toBe("삭제");
    expect(del.matchCount).toBe(1);
    expect(del.canHighlight).toBe(true);
    expect(del.sig16).toBe("dede1234dede5678");
  });

  it("flags a candidate that did not resolve uniquely (sig16 null, counted as non-unique)", async () => {
    const { deps } = fakeDeps({ matches: { call_ip: { matchCount: 3, canHighlight: false } } });
    const result = await runWingSelectorRecord(deps);
    expect(result.uniqueCandidates).toBe(5);
    expect(result.nonUniqueCandidates).toBe(1);
    const callIp = result.targets.find((t) => t.target === "call_ip")!;
    expect(callIp.matchCount).toBe(3);
    expect(callIp.canHighlight).toBe(false);
    expect(callIp.sig16).toBeNull();
  });

  it("returns the empty record on abort / timeout without probing anything", async () => {
    for (const signal of ["abort", "timeout"] as const) {
      const { deps, probed } = fakeDeps({ signal });
      const result = await runWingSelectorRecord(deps);
      expect(probed).toEqual([]);
      expect(result.targets).toEqual([]);
      expect(result.observation).toBeNull();
      expect(result.aborted).toBe(signal === "abort");
      expect(result.calibration).toBe("LIVE_DOM_CALIBRATION_PENDING");
    }
  });

  it("is RESILIENT: a read-only step that throws on real WING yields a sanitized fingerprint, never an opaque fatal", async () => {
    // A real page navigating/closing under the observe read → CONTEXT_DESTROYED fingerprint, observation null,
    // and the candidate probes still run (the record is not lost). A candidate probe that throws → per-target
    // fault, matchCount 0, and the loop continues to the rest.
    const probed: WingRecordTarget[] = [];
    const deps: WingSelectorRecordDeps = {
      waitForReady: async () => "ready",
      observeSurface: async () => {
        throw new Error("Execution context was destroyed, most likely because of a navigation.");
      },
      probeTarget: async (target) => {
        probed.push(target);
        if (target === "issue") throw new Error("Target page, context or browser has been closed");
        return UNIQUE;
      },
      announce: () => undefined,
    };
    const result = await runWingSelectorRecord(deps);
    expect(result.observation).toBeNull();
    expect(result.observationFault).toBe("CONTEXT_DESTROYED");
    // Every candidate was still attempted despite the observe failure + one probe throwing.
    expect(probed).toEqual(["self_dev", "vendor_info", "call_ip", "issue", "credentials", "delete"]);
    const issue = result.targets.find((t) => t.target === "issue")!;
    expect(issue.fault).toBe("TARGET_CLOSED");
    expect(issue.matchCount).toBe(0);
    expect(issue.canHighlight).toBe(false);
    // A clean candidate carries no fault.
    expect(result.targets.find((t) => t.target === "self_dev")!.fault).toBeNull();
    // Still honest.
    expect(result.calibration).toBe("LIVE_DOM_CALIBRATION_PENDING");
  });

  it("fingerprints map known Playwright phrases to closed enums, never a raw message", () => {
    expect(wingFaultFingerprint(new Error("Execution context was destroyed"))).toBe("CONTEXT_DESTROYED");
    expect(wingFaultFingerprint(new Error("Target closed"))).toBe("TARGET_CLOSED");
    expect(wingFaultFingerprint(new Error("Timeout 30000ms exceeded"))).toBe("TIMEOUT");
    expect(wingFaultFingerprint(new Error("Evaluation failed: ReferenceError"))).toBe("EVAL_FAILED");
    expect(wingFaultFingerprint(new Error("something else entirely"))).toBe("UNKNOWN");
    expect(wingFaultFingerprint("not an error")).toBe("UNKNOWN");
  });

  it("carries the credentials candidate anchor as the LABEL heading (never a value) — the anchor is 'Access Key'", async () => {
    // `credentials` resolves the WING credential REGION by its fixed heading label "Access Key"; the recorder
    // records THAT heading (our own candidate config), and NEVER the Access Key / Secret Key / 업체코드 VALUE.
    const { deps } = fakeDeps();
    const result = await runWingSelectorRecord(deps);
    const creds = result.targets.find((t) => t.target === "credentials")!;
    expect(creds.label).toBe("Access Key");
    expect(creds.role).toBe("readonly-region");
  });

  it("emits ONLY a value-free calibration record — no credential VALUE, PII, selector, host, or raw URL", async () => {
    const { deps } = fakeDeps();
    const result = await runWingSelectorRecord(deps);
    const wire = JSON.stringify(result);
    // No credential VALUE / extra secret text, no selector fragments, no host/URL. (The fixed anchor heading
    // "Access Key" is our own candidate label and is permitted; the secret VALUE is never read, so tokens that
    // could only be a value/host never appear.)
    for (const leak of [
      "Secret",
      "업체코드",
      "querySelectorAll",
      "data-aw-target",
      "[role=",
      "wing.coupang.com",
      "http",
      "://",
    ]) {
      expect(wire, `leaked ${leak}`).not.toContain(leak);
    }
    // Every sig16 is either null or an opaque 16-hex string — never anything else.
    for (const t of result.targets) {
      expect(t.sig16 === null || /^[0-9a-f]{16}$/.test(t.sig16)).toBe(true);
    }
  });
});
