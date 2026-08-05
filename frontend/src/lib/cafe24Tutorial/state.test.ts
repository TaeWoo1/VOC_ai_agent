// @vitest-environment jsdom
import { beforeEach, describe, expect, it } from "vitest";
import type { Cafe24CapabilityView } from "../types";
import {
  INITIAL_STATE,
  clearTutorialState,
  interpretCallback,
  interpretCapability,
  loadTutorialState,
  saveTutorialState,
  tutorialReducer,
  type TutorialState,
} from "./state";

function capability(over: Partial<Cafe24CapabilityView>): Cafe24CapabilityView {
  return {
    sellerAccountId: "acc-1",
    connectionStatus: "CONNECTED",
    credentialPresent: true,
    credentialDecryptable: true,
    identityConfirmed: true,
    excludedBoardHidden: true,
    connectionVerified: false,
    overall: "NEEDS_ATTENTION",
    reason: null,
    features: [],
    ...over,
  };
}

describe("tutorialReducer", () => {
  it("advances the happy path step by step", () => {
    let s = INITIAL_STATE;
    s = tutorialReducer(s, { type: "START" });
    expect(s.phase).toBe("mall_confirm");
    s = tutorialReducer(s, { type: "MALL_CONFIRMED", mallId: "mystore" });
    expect(s.phase).toBe("permissions");
    expect(s.mallId).toBe("mystore");
    s = tutorialReducer(s, { type: "PERMISSIONS_ACK" });
    expect(s.phase).toBe("consent");
    s = tutorialReducer(s, { type: "CONSENT_STARTED", accountId: "acc-1" });
    expect(s.accountId).toBe("acc-1");
    s = tutorialReducer(s, { type: "CALLBACK", status: "connected", accountId: "acc-1" });
    expect(s.phase).toBe("verify");
    s = tutorialReducer(s, { type: "VERIFIED" });
    expect(s.phase).toBe("first_sync");
    s = tutorialReducer(s, { type: "SYNC_RESULT", ok: true });
    expect(s.phase).toBe("done");
  });

  it("ignores stale/unmodeled events (no step skipping)", () => {
    const s = tutorialReducer(INITIAL_STATE, { type: "VERIFIED" });
    expect(s).toEqual(INITIAL_STATE);
  });

  it("maps callback failures to distinct causes", () => {
    const base: TutorialState = { ...INITIAL_STATE, phase: "consent" };
    expect(tutorialReducer(base, { type: "CALLBACK", status: "reconnect_required", accountId: null }))
      .toMatchObject({ phase: "failed", failure: "reconnect_required" });
    expect(tutorialReducer(base, { type: "CALLBACK", status: "invalid", accountId: null }))
      .toMatchObject({ phase: "failed", failure: "invalid_request" });
    expect(tutorialReducer(base, { type: "CALLBACK", status: "unknown", accountId: null }))
      .toMatchObject({ phase: "failed", failure: "invalid_request" });
  });

  it("marks a transient verify error retryable without leaving verify", () => {
    const s = tutorialReducer({ ...INITIAL_STATE, phase: "verify", accountId: "a" },
      { type: "VERIFY_RETRYABLE" });
    expect(s.phase).toBe("verify");
    expect(s.verifyRetryable).toBe(true);
  });

  it("VERIFY_RETRY re-verifies in place (bumps nonce, keeps accountId, never resets)", () => {
    const s = tutorialReducer(
      { ...INITIAL_STATE, phase: "verify", accountId: "acc-1", verifyRetryable: true },
      { type: "VERIFY_RETRY" });
    expect(s.phase).toBe("verify");
    expect(s.accountId).toBe("acc-1");
    expect(s.verifyRetryable).toBe(false);
    expect(s.verifyNonce).toBe(INITIAL_STATE.verifyNonce + 1);
  });

  it("fails the first sync when it does not collect", () => {
    const s = tutorialReducer({ ...INITIAL_STATE, phase: "first_sync", accountId: "a" },
      { type: "SYNC_RESULT", ok: false });
    expect(s).toMatchObject({ phase: "failed", failure: "first_sync_failed" });
  });

  it("retries board-mapping back to verify when an account is known", () => {
    const s = tutorialReducer(
      { ...INITIAL_STATE, phase: "failed", failure: "board_mapping", accountId: "a" },
      { type: "RETRY" });
    expect(s.phase).toBe("verify");
  });

  it("retries an invalid request back to mall entry", () => {
    const s = tutorialReducer(
      { ...INITIAL_STATE, phase: "failed", failure: "invalid_request", mallId: "mystore" },
      { type: "RETRY" });
    expect(s.phase).toBe("mall_confirm");
    expect(s.mallId).toBe("mystore");
  });
});

describe("interpretCallback", () => {
  it("wraps the sanitized status into a CALLBACK event", () => {
    expect(interpretCallback("connected", "acc-1")).toEqual({
      type: "CALLBACK",
      status: "connected",
      accountId: "acc-1",
    });
  });
});

describe("interpretCapability", () => {
  it("verified when connectionVerified", () => {
    expect(interpretCapability(capability({ connectionVerified: true }))).toEqual({ kind: "verified" });
  });

  it("retry on a transient provider error", () => {
    expect(interpretCapability(capability({ reason: "PROVIDER_ERROR" }))).toEqual({ kind: "retry" });
  });

  it("reconnect on auth/credential reasons", () => {
    expect(interpretCapability(capability({ reason: "RECONNECT_REQUIRED" })))
      .toEqual({ kind: "failed", failure: "reconnect_required" });
    expect(interpretCapability(capability({ reason: "CREDENTIAL_MISSING" })))
      .toEqual({ kind: "failed", failure: "reconnect_required" });
  });

  it("scope_insufficient is its own cause, distinct from reconnect", () => {
    // A missing read permission is not a dead credential — it maps to its own failure so the
    // seller gets scope-specific guidance rather than a re-consent loop.
    expect(interpretCapability(capability({ reason: "SCOPE_INSUFFICIENT" })))
      .toEqual({ kind: "failed", failure: "scope_insufficient" });
  });

  it("board_mapping when a board feature mismatched", () => {
    const view = capability({
      reason: null,
      features: [
        { feature: "INQUIRY_COLLECT", state: "NEEDS_ATTENTION", label: "문의 수집", reason: "BOARD_MAPPING_MISMATCH" },
      ],
    });
    expect(interpretCapability(view)).toEqual({ kind: "failed", failure: "board_mapping" });
  });
});

describe("resume persistence", () => {
  beforeEach(() => {
    clearTutorialState();
  });

  it("round-trips the resumable slice and never persists a secret field", () => {
    const state: TutorialState = {
      phase: "verify",
      mallId: "mystore",
      accountId: "acc-1",
      failure: null,
      verifyRetryable: true,
      verifyNonce: 3,
    };
    saveTutorialState(state);
    const raw = sessionStorage.getItem("cafe24_tutorial_v1") ?? "";
    expect(raw).not.toContain("verifyRetryable");
    expect(raw).not.toContain("verifyNonce");
    const loaded = loadTutorialState();
    expect(loaded).toMatchObject({ phase: "verify", mallId: "mystore", accountId: "acc-1" });
    expect(loaded?.verifyRetryable).toBe(false);
  });

  it("returns null after clear", () => {
    saveTutorialState({ ...INITIAL_STATE, phase: "permissions" });
    clearTutorialState();
    expect(loadTutorialState()).toBeNull();
  });

  it("rejects a corrupt/unknown phase", () => {
    sessionStorage.setItem("cafe24_tutorial_v1", JSON.stringify({ phase: "bogus" }));
    expect(loadTutorialState()).toBeNull();
  });
});
