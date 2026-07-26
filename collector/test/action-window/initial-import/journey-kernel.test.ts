import { describe, expect, it } from "vitest";
import {
  INITIAL_JOURNEY_STATE,
  applyJourney,
  isHaltedPhase,
  reduceJourney,
  reduceJourneySequence,
  type JourneyEvent,
  type JourneyPhase,
} from "../../../../contracts/review-import-journey/v1/index";

/** Fold a sequence and return the final phase. */
function phaseAfter(events: JourneyEvent[]): JourneyPhase {
  return reduceJourneySequence(events).phase;
}

/** The events of one clean segment run, launched and completed with coverage. */
const runOneSegment: JourneyEvent[] = [
  { type: "SEGMENT_LAUNCH_DECIDED", hosted: true },
  { type: "SEGMENT_RUN_COMPLETED", covered: true },
];

/** The events up to and including a created plan, ready to launch the first segment. */
const throughPlanReady: JourneyEvent[] = [
  { type: "AUTH_PRESENTED", orgExists: true },
  { type: "ACCOUNT_RESOLVED", connected: true, channelMatches: true },
  { type: "AGENT_PAIRING_REQUESTED" },
  { type: "AGENT_PAIRING_RESOLVED", approved: true },
  { type: "AGENT_CARRIER_ATTACHED", carrierMatches: true },
  { type: "MARKETPLACE_SURFACE_OPENED" },
  { type: "PLAN_RANGE_OPENED" },
  { type: "PLAN_CREATED" },
];

describe("journey kernel — the happy path", () => {
  it("walks auth → account → pairing → session → plan → one segment → done", () => {
    let state = INITIAL_JOURNEY_STATE;
    const seen: JourneyPhase[] = [];
    for (const event of [...throughPlanReady, ...runOneSegment]) {
      state = applyJourney(state, event);
      seen.push(state.phase);
    }
    expect(seen).toEqual([
      "AUTH_VERIFYING",
      "ACCOUNT_READY",
      "AGENT_CONNECTING",
      "AGENT_CONNECTING", // pairing approved; still awaiting the carrier attach
      "AGENT_CONNECTED",
      "MARKETPLACE_SESSION",
      "PLAN_RANGE",
      "PLAN_READY",
      "SEGMENT_RUNNING",
      "SEGMENT_DONE",
    ]);
  });

  it("completes the plan when no segment remains after the last run", () => {
    expect(
      phaseAfter([...throughPlanReady, ...runOneSegment, { type: "NEXT_SEGMENT_AVAILABLE", hasRemaining: false }]),
    ).toBe("PLAN_COMPLETE");
  });

  it("returns to a launchable plan when a segment remains, then completes after the second", () => {
    const twoSegments: JourneyEvent[] = [
      ...throughPlanReady,
      ...runOneSegment,
      { type: "NEXT_SEGMENT_AVAILABLE", hasRemaining: true }, // → PLAN_READY, ready for the next
      ...runOneSegment,
      { type: "NEXT_SEGMENT_AVAILABLE", hasRemaining: false },
    ];
    expect(phaseAfter(twoSegments)).toBe("PLAN_COMPLETE");
  });

  it("exposes the awaited effect at each milestone", () => {
    expect(reduceJourney({ phase: "PLAN_READY" }, { type: "SEGMENT_LAUNCH_DECIDED", hosted: true })).toEqual({
      phase: "SEGMENT_RUNNING",
      effect: "AWAIT_SEGMENT_RESULT",
    });
    expect(reduceJourney({ phase: "SEGMENT_RUNNING" }, { type: "SEGMENT_RUN_COMPLETED", covered: true })).toEqual({
      phase: "SEGMENT_DONE",
      effect: "OFFER_NEXT_SEGMENT",
    });
  });
});

describe("journey kernel — fail-closed halts", () => {
  it("stale JWT / missing org halts at AUTH_FAILED", () => {
    expect(phaseAfter([{ type: "AUTH_PRESENTED", orgExists: false }])).toBe("AUTH_FAILED");
  });

  it("an unconnected or channel-mismatched account halts at ACCOUNT_BLOCKED", () => {
    expect(
      phaseAfter([
        { type: "AUTH_PRESENTED", orgExists: true },
        { type: "ACCOUNT_RESOLVED", connected: true, channelMatches: false },
      ]),
    ).toBe("ACCOUNT_BLOCKED");
    expect(
      phaseAfter([
        { type: "AUTH_PRESENTED", orgExists: true },
        { type: "ACCOUNT_RESOLVED", connected: false, channelMatches: true },
      ]),
    ).toBe("ACCOUNT_BLOCKED");
  });

  it("a refused pairing or a mismatched carrier halts at AGENT_REFUSED", () => {
    const base: JourneyEvent[] = [
      { type: "AUTH_PRESENTED", orgExists: true },
      { type: "ACCOUNT_RESOLVED", connected: true, channelMatches: true },
      { type: "AGENT_PAIRING_REQUESTED" },
    ];
    expect(phaseAfter([...base, { type: "AGENT_PAIRING_RESOLVED", approved: false }])).toBe("AGENT_REFUSED");
    expect(
      phaseAfter([
        ...base,
        { type: "AGENT_PAIRING_RESOLVED", approved: true },
        { type: "AGENT_CARRIER_ATTACHED", carrierMatches: false },
      ]),
    ).toBe("AGENT_REFUSED");
  });

  it("an abandon halts from anywhere still live", () => {
    expect(phaseAfter([...throughPlanReady, { type: "PLAN_ABANDONED" }])).toBe("ABANDONED");
    expect(phaseAfter([...throughPlanReady, ...runOneSegment, { type: "PLAN_ABANDONED" }])).toBe("ABANDONED");
  });

  it("marks halt phases as halted", () => {
    for (const p of ["AUTH_FAILED", "ACCOUNT_BLOCKED", "AGENT_REFUSED", "PLAN_COMPLETE", "ABANDONED"] as const) {
      expect(isHaltedPhase(p)).toBe(true);
    }
    for (const p of ["PLAN_READY", "SEGMENT_RUNNING", "SEGMENT_DONE"] as const) {
      expect(isHaltedPhase(p)).toBe(false);
    }
  });
});

describe("journey kernel — retries re-enter from a halt", () => {
  it("re-authenticating with a valid org recovers AUTH_FAILED", () => {
    expect(
      phaseAfter([{ type: "AUTH_PRESENTED", orgExists: false }, { type: "AUTH_PRESENTED", orgExists: true }]),
    ).toBe("AUTH_VERIFYING");
  });

  it("a FAILED segment can be relaunched (retry), then completed", () => {
    expect(
      phaseAfter([
        ...throughPlanReady,
        { type: "SEGMENT_LAUNCH_DECIDED", hosted: true },
        { type: "SEGMENT_RUN_FAILED" }, // → SEGMENT_FAILED
        { type: "SEGMENT_LAUNCH_DECIDED", hosted: true }, // retry
        { type: "SEGMENT_RUN_COMPLETED", covered: true },
      ]),
    ).toBe("SEGMENT_DONE");
  });
});

describe("journey kernel — deterministic under a messy stream (dup / delayed / reordered)", () => {
  it("a duplicated completion does not advance twice", () => {
    const once = phaseAfter([...throughPlanReady, ...runOneSegment]);
    const twice = phaseAfter([
      ...throughPlanReady,
      ...runOneSegment,
      { type: "SEGMENT_RUN_COMPLETED", covered: true }, // duplicate, no run in flight
    ]);
    expect(once).toBe("SEGMENT_DONE");
    expect(twice).toBe("SEGMENT_DONE");
  });

  it("an out-of-phase event is a no-op, not a jump", () => {
    // A completion before any run has started must not move the phase.
    expect(reduceJourney({ phase: "PLAN_READY" }, { type: "SEGMENT_RUN_COMPLETED", covered: true })).toEqual({
      phase: "PLAN_READY",
      effect: "NONE",
    });
    // A refused (not hosted) launch changes nothing.
    expect(reduceJourney({ phase: "PLAN_READY" }, { type: "SEGMENT_LAUNCH_DECIDED", hosted: false })).toEqual({
      phase: "PLAN_READY",
      effect: "NONE",
    });
  });

  it("harmless duplicates and out-of-phase echoes interleaved with the real stream do not change the outcome", () => {
    const clean = [...throughPlanReady, ...runOneSegment, { type: "NEXT_SEGMENT_AVAILABLE", hasRemaining: false }] as JourneyEvent[];
    // Every one of these is either a duplicate of an event already consumed or one that does not apply to the
    // phase it lands in — none asserts a NEW, contradictory fact (a contradictory fact is the projector's
    // concern, pinned by divergence-0 on real streams, not a reordering the reducer must absorb).
    const noise: JourneyEvent[] = [
      { type: "SEGMENT_RUN_COMPLETED", covered: true }, // at START: no run in flight
      { type: "AGENT_PAIRING_RESOLVED", approved: true }, // at PLAN_READY: pairing long past
      { type: "PLAN_CREATED" }, // at PLAN_READY: duplicate plan
      { type: "AUTH_PRESENTED", orgExists: true }, // at SEGMENT_DONE: auth long past
    ];
    const messy: JourneyEvent[] = [
      noise[0]!,
      ...throughPlanReady,
      noise[1]!,
      noise[2]!,
      ...runOneSegment,
      noise[3]!,
      { type: "NEXT_SEGMENT_AVAILABLE", hasRemaining: false },
    ];
    expect(phaseAfter(messy)).toBe(phaseAfter(clean));
    expect(phaseAfter(messy)).toBe("PLAN_COMPLETE");
  });

  it("an unknown (any-typed) event is a fail-safe no-op — the phase is kept, never corrupted", () => {
    expect(reduceJourney({ phase: "PLAN_READY" }, { type: "BOGUS" } as unknown as JourneyEvent)).toEqual({
      phase: "PLAN_READY",
      effect: "NONE",
    });
  });

  it("a late success frame cannot resurrect an abandoned journey", () => {
    expect(
      phaseAfter([
        ...throughPlanReady,
        { type: "PLAN_ABANDONED" },
        { type: "SEGMENT_LAUNCH_DECIDED", hosted: true },
        { type: "SEGMENT_RUN_COMPLETED", covered: true },
        { type: "NEXT_SEGMENT_AVAILABLE", hasRemaining: true },
      ]),
    ).toBe("ABANDONED");
  });
});
