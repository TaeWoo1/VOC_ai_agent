import { describe, expect, it } from "vitest";
import {
  decideSegmentEntry,
  type SegmentEntryEffect,
  type SegmentEntryState,
  type SegmentLaunchScope,
} from "../../../../contracts/review-import-journey/v1/index";

// A 16-hex-shaped ref, matching what the host parses out of a START_RUN. The kernel does not validate the
// shape (the host's `importRefFromStartRun` already did); these are just distinct opaque strings.
const REF_A = "0123456789abcdef";
const REF_B = "fedcba9876543210";
const NAVER = "NAVER";

const idle: SegmentEntryState = { hostedRef: null, building: false };

function segmentScope(over: Partial<SegmentLaunchScope> = {}): SegmentLaunchScope {
  return { kind: "SEGMENT", channelCode: NAVER, requiredStart: "2026-06-01", requiredEnd: "2026-06-30", ...over };
}

function resolved(scope: SegmentLaunchScope | null, over: { declaredKind?: "SEGMENT" | "DISCOVERY" | null; host?: string } = {}) {
  return decideSegmentEntry(idle, {
    type: "SCOPE_RESOLVED",
    ref: REF_A,
    declaredKind: over.declaredKind ?? null,
    scope,
    hostChannelCode: over.host ?? NAVER,
  });
}

describe("decideSegmentEntry — phase 1 (START_RUN_RECEIVED)", () => {
  it("a fresh ref with nothing hosted resolves scope", () => {
    const effect = decideSegmentEntry(idle, { type: "START_RUN_RECEIVED", ref: REF_A, declaredKind: null });
    expect(effect).toEqual<SegmentEntryEffect>({ type: "RESOLVE_SCOPE", ref: REF_A });
  });

  it("a re-send of the ref already hosted is idempotent — never rebuilt", () => {
    const state: SegmentEntryState = { hostedRef: REF_A, building: false };
    const effect = decideSegmentEntry(state, { type: "START_RUN_RECEIVED", ref: REF_A, declaredKind: "SEGMENT" });
    expect(effect).toEqual<SegmentEntryEffect>({ type: "IGNORE_ALREADY_HOSTED" });
  });

  it("a DIFFERENT ref while one is hosted still resolves (the sequence's next segment)", () => {
    const state: SegmentEntryState = { hostedRef: REF_A, building: false };
    const effect = decideSegmentEntry(state, { type: "START_RUN_RECEIVED", ref: REF_B, declaredKind: null });
    expect(effect).toEqual<SegmentEntryEffect>({ type: "RESOLVE_SCOPE", ref: REF_B });
  });

  it("a start mid-build is deferred, not doubled", () => {
    const state: SegmentEntryState = { hostedRef: null, building: true };
    const effect = decideSegmentEntry(state, { type: "START_RUN_RECEIVED", ref: REF_A, declaredKind: null });
    expect(effect).toEqual<SegmentEntryEffect>({ type: "IGNORE_BUSY" });
  });

  it("already-hosted wins over busy (same-ref check is first)", () => {
    const state: SegmentEntryState = { hostedRef: REF_A, building: true };
    const effect = decideSegmentEntry(state, { type: "START_RUN_RECEIVED", ref: REF_A, declaredKind: null });
    expect(effect).toEqual<SegmentEntryEffect>({ type: "IGNORE_ALREADY_HOSTED" });
  });
});

describe("decideSegmentEntry — phase 2 (SCOPE_RESOLVED), fail-closed guard order", () => {
  it("no scope (server refused: spent / expired / wrong org / never existed) is refused", () => {
    expect(resolved(null)).toEqual<SegmentEntryEffect>({ type: "REFUSE", reason: "scope_refused" });
  });

  it("a non-SEGMENT kind (e.g. DISCOVERY, or an unknown newer kind) is refused", () => {
    expect(resolved(segmentScope({ kind: "DISCOVERY" }))).toEqual<SegmentEntryEffect>({
      type: "REFUSE",
      reason: "wrong_kind",
    });
    expect(resolved(segmentScope({ kind: "SOMETHING_NEW" }))).toEqual<SegmentEntryEffect>({
      type: "REFUSE",
      reason: "wrong_kind",
    });
  });

  it("a client declaring the other kind than the ticket authorizes is refused", () => {
    expect(resolved(segmentScope(), { declaredKind: "DISCOVERY" })).toEqual<SegmentEntryEffect>({
      type: "REFUSE",
      reason: "kind_mismatch",
    });
  });

  it("a declared SEGMENT matching the server, and a null (v1-compatible) declaration, both pass the kind gate", () => {
    expect(resolved(segmentScope(), { declaredKind: "SEGMENT" }).type).toBe("HOST_SEGMENT");
    expect(resolved(segmentScope(), { declaredKind: null }).type).toBe("HOST_SEGMENT");
  });

  it("a missing required window (either end) is refused", () => {
    expect(resolved(segmentScope({ requiredStart: "" }))).toEqual<SegmentEntryEffect>({
      type: "REFUSE",
      reason: "scope_incomplete",
    });
    expect(resolved(segmentScope({ requiredEnd: "" }))).toEqual<SegmentEntryEffect>({
      type: "REFUSE",
      reason: "scope_incomplete",
    });
  });

  it("a ticket for a DIFFERENT marketplace than this agent drives is refused (channel fail-closed)", () => {
    expect(resolved(segmentScope({ channelCode: "COUPANG" }), { host: NAVER })).toEqual<SegmentEntryEffect>({
      type: "REFUSE",
      reason: "channel_mismatch",
    });
  });

  it("a valid SEGMENT scope hosts, carrying the server's channel and window", () => {
    expect(resolved(segmentScope())).toEqual<SegmentEntryEffect>({
      type: "HOST_SEGMENT",
      channelCode: NAVER,
      required: { start: "2026-06-01", end: "2026-06-30" },
    });
  });

  it("a scope naming no channel falls back to the host's own channel (and passes the mismatch gate)", () => {
    expect(resolved(segmentScope({ channelCode: "" }), { host: NAVER })).toEqual<SegmentEntryEffect>({
      type: "HOST_SEGMENT",
      channelCode: NAVER,
      required: { start: "2026-06-01", end: "2026-06-30" },
    });
  });

  it("guard order: a scope that is both wrong-kind AND channel-mismatched refuses on kind first", () => {
    expect(resolved(segmentScope({ kind: "DISCOVERY", channelCode: "COUPANG" }))).toEqual<SegmentEntryEffect>({
      type: "REFUSE",
      reason: "wrong_kind",
    });
  });
});
