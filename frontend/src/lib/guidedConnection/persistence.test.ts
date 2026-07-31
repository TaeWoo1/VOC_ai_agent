// @vitest-environment jsdom
// Refresh-resume persistence: it restores ONLY safe, secret-free pre-registration steps and never
// stores anything sensitive. Everything else falls back to INITIAL_STATE (backend-driven recovery).
import { beforeEach, describe, expect, it } from "vitest";
import { clearGuidedProgress, loadGuidedInitialState, saveGuidedProgress } from "./persistence";
import { INITIAL_STATE, actorFor } from "./state";
import type { GuidedConnectionState, GuidedPhase } from "./types";

function at(phase: GuidedPhase, path: GuidedConnectionState["path"] = "unknown"): GuidedConnectionState {
  return {
    phase,
    actor: actorFor(phase),
    failureReason: null,
    milestones: { registered: false, tested: false, synced: false },
    sessionSource: "none",
    path,
  };
}

describe("guidedConnection persistence", () => {
  beforeEach(() => sessionStorage.clear());

  it("restores a pre-registration user-decision phase verbatim (with its path, cleared milestones)", () => {
    saveGuidedProgress(at("application_issuance", "new"));
    const restored = loadGuidedInitialState();
    expect(restored.phase).toBe("application_issuance");
    expect(restored.path).toBe("new");
    expect(restored.milestones).toEqual({ registered: false, tested: false, synced: false });
    expect(restored.failureReason).toBeNull();
    expect(restored.actor).toBe(actorFor("application_issuance"));
  });

  it("restores the existing-credential entry step (reuse path) without re-walking the gate", () => {
    saveGuidedProgress(at("existing_credential_entry", "existing"));
    expect(loadGuidedInitialState().phase).toBe("existing_credential_entry");
  });

  it.each<GuidedPhase>([
    "check_saved_credential",
    "readiness_checking",
    "naver_login_required",
    "connection_testing",
    "first_order_sync",
    "completed",
    "terminal_failure",
  ])("does NOT restore the non-user-decision phase %s (falls back to INITIAL_STATE)", (phase) => {
    saveGuidedProgress(at(phase));
    expect(loadGuidedInitialState()).toEqual(INITIAL_STATE);
  });

  it("clear() removes the slice so the next load starts fresh", () => {
    saveGuidedProgress(at("application_path_choice"));
    clearGuidedProgress();
    expect(loadGuidedInitialState()).toEqual(INITIAL_STATE);
  });

  it("tolerates malformed storage (never throws, falls back to INITIAL_STATE)", () => {
    sessionStorage.setItem("naver_guided_connection_v1", "{not-json");
    expect(loadGuidedInitialState()).toEqual(INITIAL_STATE);
  });

  it("coerces an invalid path to 'unknown'", () => {
    sessionStorage.setItem(
      "naver_guided_connection_v1",
      JSON.stringify({ phase: "application_path_choice", path: "bogus" }),
    );
    expect(loadGuidedInitialState().path).toBe("unknown");
  });

  it("persists ONLY phase + path — never a secret or any other field", () => {
    saveGuidedProgress(at("sellerops_credential_entry", "new"));
    const raw = sessionStorage.getItem("naver_guided_connection_v1")!;
    expect(JSON.parse(raw)).toEqual({ phase: "sellerops_credential_entry", path: "new" });
  });
});
