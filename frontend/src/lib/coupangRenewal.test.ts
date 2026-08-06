import { describe, it, expect } from "vitest";
import {
  coupangRenewalReducer,
  INITIAL_COUPANG_RENEWAL_STATE,
  type CoupangRenewalState,
} from "./coupangRenewal";

const at = (phase: CoupangRenewalState["phase"], reasonCode: string | null = null): CoupangRenewalState => ({
  phase,
  reasonCode,
});

describe("coupangRenewalReducer — pure renewal flow", () => {
  it("starts at the guided walkthrough", () => {
    expect(INITIAL_COUPANG_RENEWAL_STATE).toEqual({ phase: "guide", reasonCode: null });
  });

  it("guide → replace on WALKTHROUGH_DONE", () => {
    expect(coupangRenewalReducer(at("guide"), { type: "WALKTHROUGH_DONE" })).toEqual(at("replace"));
  });

  it("replace → replacing on SUBMIT", () => {
    expect(coupangRenewalReducer(at("replace"), { type: "SUBMIT" })).toEqual(at("replacing"));
  });

  it("replacing → done on a SUCCESS result (account/orders kept — no new account)", () => {
    expect(
      coupangRenewalReducer(at("replacing"), { type: "REPLACE_RESULT", status: "SUCCESS", reasonCode: null }),
    ).toEqual(at("done"));
  });

  it("replacing → replace_error (with reason) on a FAILED result — old credential kept via backend rollback", () => {
    expect(
      coupangRenewalReducer(at("replacing"), {
        type: "REPLACE_RESULT",
        status: "FAILED",
        reasonCode: "INVALID_CREDENTIAL",
      }),
    ).toEqual(at("replace_error", "INVALID_CREDENTIAL"));
  });

  it("replace_error → replacing on SUBMIT (retry), and → replace on REENTER", () => {
    expect(coupangRenewalReducer(at("replace_error", "X"), { type: "SUBMIT" })).toEqual(at("replacing"));
    expect(coupangRenewalReducer(at("replace_error", "X"), { type: "REENTER" })).toEqual(at("replace"));
  });

  it("ignores events that do not apply to the current phase (fail-safe, no throw)", () => {
    expect(coupangRenewalReducer(at("guide"), { type: "SUBMIT" })).toEqual(at("guide"));
    expect(coupangRenewalReducer(at("done"), { type: "WALKTHROUGH_DONE" })).toEqual(at("done"));
    expect(
      coupangRenewalReducer(at("replace"), { type: "REPLACE_RESULT", status: "SUCCESS", reasonCode: null }),
    ).toEqual(at("replace"));
  });
});
