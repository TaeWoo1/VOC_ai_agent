import { describe, expect, it, beforeEach } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { clearLogSink, getLogSink } from "../../../src/log";
import { projectJourneyEvent, type JourneyObservation } from "../../../src/action-window/initial-import/journey-projection";
import { JourneyShadow, assertNoExternalTracing, detectRunDivergence } from "../../../src/action-window/initial-import/journey-shadow";

const here = dirname(fileURLToPath(import.meta.url));
const readSrc = (rel: string) => readFileSync(resolve(here, "../../../src/action-window/initial-import", rel), "utf8");

/** Observations up to a created plan, ready to launch the first segment. */
const throughPlan: JourneyObservation[] = [
  { kind: "auth", orgExists: true },
  { kind: "account", connected: true, channelMatches: true },
  { kind: "pairing_requested" },
  { kind: "pairing_resolved", approved: true },
  { kind: "carrier_attached", carrierMatches: true },
  { kind: "surface_opened" },
  { kind: "plan_range_opened" },
  { kind: "plan_created" },
];

/** One clean segment: hosted launch → running → completed. */
const oneSegment: JourneyObservation[] = [
  { kind: "segment_entry", effect: "HOST_SEGMENT" },
  { kind: "run_status", status: "RUNNING" },
  { kind: "run_status", status: "COMPLETED" },
];

beforeEach(() => clearLogSink());

describe("journey projection", () => {
  it("maps each sanitized signal to its event, and a HOST decision to a launch", () => {
    expect(projectJourneyEvent({ kind: "auth", orgExists: false })).toEqual({ type: "AUTH_PRESENTED", orgExists: false });
    expect(projectJourneyEvent({ kind: "segment_entry", effect: "HOST_SEGMENT" })).toEqual({
      type: "SEGMENT_LAUNCH_DECIDED",
      hosted: true,
    });
    expect(projectJourneyEvent({ kind: "segment_entry", effect: "REFUSE" })).toEqual({
      type: "SEGMENT_LAUNCH_DECIDED",
      hosted: false,
    });
  });

  it("emits a journey event only at a TERMINAL run status; intermediate statuses are dropped", () => {
    expect(projectJourneyEvent({ kind: "run_status", status: "COMPLETED" })).toEqual({ type: "SEGMENT_RUN_COMPLETED", covered: true });
    expect(projectJourneyEvent({ kind: "run_status", status: "FAILED" })).toEqual({ type: "SEGMENT_RUN_FAILED" });
    for (const status of ["PREPARING", "RUNNING", "WAITING_FOR_HUMAN", "PROCESSING"]) {
      expect(projectJourneyEvent({ kind: "run_status", status })).toBeNull();
    }
  });

  it("does not treat OPERATOR_REPORTED as an import completion, and DROPS an unknown observation", () => {
    // OPERATOR_REPORTED is a reply-flow terminal, not a review-import completion → no event.
    expect(projectJourneyEvent({ kind: "run_status", status: "OPERATOR_REPORTED" })).toBeNull();
    // An unknown observation (only reachable via an any-typed caller) is dropped, never fabricated.
    expect(projectJourneyEvent({ kind: "bogus" } as unknown as JourneyObservation)).toBeNull();
  });
});

describe("journey shadow — replay of a real event stream", () => {
  it("tracks a two-segment plan to PLAN_COMPLETE with ZERO divergence", async () => {
    const shadow = new JourneyShadow();
    await shadow.observeAll([
      ...throughPlan,
      ...oneSegment,
      { kind: "next_segment", hasRemaining: true },
      ...oneSegment,
      { kind: "next_segment", hasRemaining: false },
    ]);
    expect(shadow.currentPhase()).toBe("PLAN_COMPLETE");
    expect(shadow.divergenceCount()).toBe(0);
    // A clean run logs no divergence at all.
    expect(getLogSink().filter((e) => e.event === "journey_shadow_divergence")).toHaveLength(0);
  });

  it("covers the required scenarios end to end (stale JWT, channel mismatch, scope refusal, completion, next, plan complete)", async () => {
    const staleJwt = new JourneyShadow("a");
    await staleJwt.observe({ kind: "auth", orgExists: false });
    expect(staleJwt.currentPhase()).toBe("AUTH_FAILED");

    const channelMismatch = new JourneyShadow("b");
    await channelMismatch.observeAll([
      { kind: "auth", orgExists: true },
      { kind: "account", connected: true, channelMatches: false },
    ]);
    expect(channelMismatch.currentPhase()).toBe("ACCOUNT_BLOCKED");

    const scopeRefusal = new JourneyShadow("c");
    await scopeRefusal.observeAll([...throughPlan, { kind: "segment_entry", effect: "REFUSE" }]);
    // A refused launch never starts a run — the journey waits at PLAN_READY, no divergence.
    expect(scopeRefusal.currentPhase()).toBe("PLAN_READY");
    expect(scopeRefusal.divergenceCount()).toBe(0);

    const full = new JourneyShadow("d");
    await full.observeAll([...throughPlan, ...oneSegment, { kind: "next_segment", hasRemaining: false }]);
    expect(full.currentPhase()).toBe("PLAN_COMPLETE"); // completion → next → plan complete
    expect(full.divergenceCount()).toBe(0);
  });
});

describe("journey shadow — deterministic under a messy stream", () => {
  it("duplicated and out-of-phase observations do not change the phase or raise a divergence", async () => {
    const clean = new JourneyShadow("clean");
    await clean.observeAll([...throughPlan, ...oneSegment, { kind: "next_segment", hasRemaining: false }]);

    const messy = new JourneyShadow("messy");
    await messy.observeAll([
      ...throughPlan,
      { kind: "pairing_resolved", approved: true }, // late echo, out of phase → no-op
      ...oneSegment,
      { kind: "run_status", status: "COMPLETED" }, // duplicate terminal status → no-op (already SEGMENT_DONE)
      { kind: "plan_created" }, // duplicate, out of phase → no-op
      { kind: "next_segment", hasRemaining: false },
    ]);

    expect(messy.currentPhase()).toBe(clean.currentPhase());
    expect(messy.currentPhase()).toBe("PLAN_COMPLETE");
    // The duplicate COMPLETED lands while the shadow is at SEGMENT_DONE/PLAN_READY — both permitted — so no
    // divergence is raised by harmless repetition.
    expect(messy.divergenceCount()).toBe(0);
  });
});

describe("journey shadow — the divergence detector is not vacuous", () => {
  it("raises a divergence when the runtime reports RUNNING but the shadow never saw a launch", async () => {
    const shadow = new JourneyShadow();
    await shadow.observeAll([...throughPlan, { kind: "run_status", status: "RUNNING" }]);
    // The runtime says a segment is running; the shadow is still at PLAN_READY — a real disagreement.
    expect(shadow.currentPhase()).toBe("PLAN_READY");
    expect(shadow.divergenceCount()).toBe(1);
  });

  it("raises a divergence when the runtime reports COMPLETED but the shadow never saw the launch", async () => {
    const shadow = new JourneyShadow();
    // The completion event no-ops at PLAN_READY (guarded), so the shadow is stuck — and COMPLETED does not
    // permit PLAN_READY, so the missed launch is caught (it would have been masked by an over-broad allow-set).
    await shadow.observeAll([...throughPlan, { kind: "run_status", status: "COMPLETED" }]);
    expect(shadow.currentPhase()).toBe("PLAN_READY");
    expect(shadow.divergenceCount()).toBe(1);
  });

  it("does NOT raise a divergence for an operator cancel that precedes the abandon signal", async () => {
    const shadow = new JourneyShadow();
    await shadow.observeAll([
      ...throughPlan,
      { kind: "segment_entry", effect: "HOST_SEGMENT" }, // → SEGMENT_RUNNING
      { kind: "run_status", status: "CANCELLED" }, // the cancel arrives before the abandon observation
    ]);
    expect(shadow.divergenceCount()).toBe(0); // a cancel of a running segment is not a disagreement
  });

  it("the pure detector maps statuses to the phases they permit", () => {
    expect(detectRunDivergence("SEGMENT_RUNNING", "RUNNING").consistent).toBe(true);
    expect(detectRunDivergence("PLAN_READY", "RUNNING").consistent).toBe(false);
    expect(detectRunDivergence("SEGMENT_DONE", "COMPLETED").consistent).toBe(true);
    expect(detectRunDivergence("PLAN_COMPLETE", "COMPLETED").consistent).toBe(true);
    // The missed-launch class: a completion with the shadow still at PLAN_READY IS a divergence.
    expect(detectRunDivergence("PLAN_READY", "COMPLETED").consistent).toBe(false);
    expect(detectRunDivergence("SEGMENT_FAILED", "FAILED").consistent).toBe(true);
    expect(detectRunDivergence("SEGMENT_RUNNING", "FAILED").consistent).toBe(false);
    // A cancel is consistent with a still-running segment, but not with a run that never existed.
    expect(detectRunDivergence("SEGMENT_RUNNING", "CANCELLED").consistent).toBe(true);
    expect(detectRunDivergence("PLAN_READY", "CANCELLED").consistent).toBe(false);
  });
});

describe("journey shadow — fail-closed on external tracing", () => {
  it("assertNoExternalTracing throws when a LangSmith tracing flag is set", () => {
    expect(() => assertNoExternalTracing({ LANGCHAIN_TRACING_V2: "true" })).toThrow(/never egress/);
    expect(() => assertNoExternalTracing({ LANGSMITH_TRACING: "1" })).toThrow();
    expect(() => assertNoExternalTracing({ LANGCHAIN_TRACING: "true" })).toThrow();
  });

  it("assertNoExternalTracing is a no-op when no tracing flag is set", () => {
    expect(() => assertNoExternalTracing({})).not.toThrow();
    expect(() => assertNoExternalTracing({ LANGCHAIN_TRACING_V2: "false" })).not.toThrow();
  });
});

describe("journey shadow — sanitized logging + structural side-effect ban", () => {
  it("a divergence log carries only enums/booleans/counts — no ref/date/id/url/path/token", async () => {
    const shadow = new JourneyShadow();
    await shadow.observeAll([...throughPlan, { kind: "run_status", status: "RUNNING" }]);
    const entries = getLogSink().filter((e) => e.event === "journey_shadow_divergence");
    expect(entries).toHaveLength(1);
    const meta = entries[0]!.meta;
    expect(Object.keys(meta).sort()).toEqual(["consistent", "count", "observedStatus", "shadowPhase"]);
    expect(typeof meta.consistent).toBe("boolean");
    expect(typeof meta.count).toBe("number");
    expect(typeof meta.shadowPhase).toBe("string"); // a phase enum
    expect(typeof meta.observedStatus).toBe("string"); // a v2 status enum
  });

  it("the shadow and projection modules reach no browser, network, fs, or external tracer", () => {
    for (const rel of ["journey-shadow.ts", "journey-projection.ts"]) {
      const src = readSrc(rel)
        .split("\n")
        .filter((l) => !l.trimStart().startsWith("*") && !l.trimStart().startsWith("//") && !l.trimStart().startsWith("/*"))
        .join("\n");
      expect(src).not.toMatch(/from "playwright"/);
      expect(src).not.toMatch(/from "node:fs"|from "fs"|from "node:http"|from "http"|from "net"/);
      // No LangSmith import or tracer class, and never ENABLING tracing (an assignment to a tracing env). The
      // module IS allowed to READ those env names — that is the fail-closed guard.
      expect(src).not.toMatch(/from ["'](?:langsmith|@langchain\/langsmith)|LangChainTracer/i);
      expect(src).not.toMatch(/env\s*\.\s*LANG\w*TRACING\w*\s*=|env\s*\.\s*LANGSMITH\w*\s*=/i);
      expect(src).not.toMatch(/\.\.\/upload/); // never the network upload client
      expect(src).not.toMatch(/\.click\(|page\./); // never a browser action
    }
    // The projection is fully pure — not even the logger.
    expect(readSrc("journey-projection.ts")).not.toMatch(/\blog\(/);
  });
});
