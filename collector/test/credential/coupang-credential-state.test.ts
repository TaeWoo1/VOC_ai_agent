/**
 * **Does this account already hold a key?** The asymmetry is the whole design and it is what these pin.
 *
 * A wrong `KEY_PRESENT` sends a seller to a handoff that then refuses — recoverable. A wrong `NO_KEY` walks
 * them into issuing a SECOND real key on a live account — not recoverable, and a state change nobody asked
 * for. So `NO_KEY` needs a positive reading and everything ambiguous is `UNKNOWN`.
 */
import { describe, expect, it } from "vitest";
import {
  coupangCredentialStateFrom,
  mayOfferHandoff,
  mayStartIssuance,
} from "../../src/action-window/coupang-credential-state";
import {
  COUPANG_CREDENTIAL_FIELD_IDS,
  type CredentialCellCensus,
  type CredentialCellReading,
} from "../../src/action-window/coupang-wing-credential-cells";

/** A reading that resolves structurally. `cellNonEmpty` is the caller's business. */
function resolved(id: string, cellNonEmpty?: boolean, over: Partial<CredentialCellReading> = {}): CredentialCellReading {
  return {
    id,
    labelVisibleCount: 1,
    labelHiddenCount: 0,
    labelTag: "TH",
    association: "TH_COLUMN_TD",
    candidateCellCount: 1,
    cellResolvedBy: "DIRECT",
    cellTag: "TD",
    cellInputCount: 0,
    tableOrdinal: 1,
    ...(cellNonEmpty === undefined ? {} : { cellNonEmpty }),
    ...over,
  };
}

function census(readings: CredentialCellReading[]): CredentialCellCensus {
  return { readings };
}

function all(cellNonEmpty?: boolean): CredentialCellCensus {
  return census(COUPANG_CREDENTIAL_FIELD_IDS.map((id) => resolved(id, cellNonEmpty)));
}

describe("the two positive answers", () => {
  it("three resolved, non-empty cells is KEY_PRESENT", () => {
    expect(coupangCredentialStateFrom(all(true), COUPANG_CREDENTIAL_FIELD_IDS)).toEqual({
      state: "KEY_PRESENT",
      reason: "OK",
    });
  });

  it("three resolved, EMPTY cells is NO_KEY — a credential table with nothing in it", () => {
    expect(coupangCredentialStateFrom(all(false), COUPANG_CREDENTIAL_FIELD_IDS)).toEqual({
      state: "NO_KEY",
      reason: "OK",
    });
  });
});

describe("everything else is UNKNOWN, and UNKNOWN never issues", () => {
  const cases: readonly { name: string; census: CredentialCellCensus; reason: string }[] = [
    {
      name: "a label that did not resolve uniquely",
      census: census([
        { ...resolved("vendor_id", true), labelVisibleCount: 2 },
        resolved("access_key", true),
        resolved("secret_key", true),
      ]),
      reason: "LABEL_NOT_UNIQUE",
    },
    {
      name: "a column that stayed ambiguous after corroboration",
      census: census([
        { ...resolved("vendor_id", true), candidateCellCount: 2, cellResolvedBy: undefined },
        resolved("access_key", true),
        resolved("secret_key", true),
      ]),
      reason: "ROW_NOT_CORROBORATED",
    },
    {
      name: "a mixed association",
      census: census([
        { ...resolved("vendor_id", true), association: "TH_NEXT_TD" },
        resolved("access_key", true),
        resolved("secret_key", true),
      ]),
      reason: "ASSOCIATION_MIXED",
    },
    {
      name: "cells in different tables",
      census: census([
        { ...resolved("vendor_id", true), tableOrdinal: 2 },
        resolved("access_key", true),
        resolved("secret_key", true),
      ]),
      reason: "TABLE_MIXED",
    },
    {
      name: "a truncated scan",
      census: census([
        { ...resolved("vendor_id", true), scanTruncated: true },
        resolved("access_key", true),
        resolved("secret_key", true),
      ]),
      reason: "SCAN_TRUNCATED",
    },
    {
      name: "a census taken WITHOUT the non-emptiness bit — not measured is not empty",
      census: all(undefined),
      reason: "CELL_EMPTY",
    },
    {
      name: "some full and some empty — that is not a credential table",
      census: census([resolved("vendor_id", true), resolved("access_key", false), resolved("secret_key", true)]),
      reason: "CELL_EMPTY",
    },
    { name: "an empty census", census: census([]), reason: "MISSING_READING" },
  ];

  for (const c of cases) {
    it(`${c.name} → UNKNOWN (${c.reason})`, () => {
      const reading = coupangCredentialStateFrom(c.census, COUPANG_CREDENTIAL_FIELD_IDS);
      expect(reading.state).toBe("UNKNOWN");
      expect(reading.reason).toBe(c.reason);
    });
  }

  it("**sitting 1's own result classified as UNKNOWN**, so it could not have started an issuance", () => {
    // 2026-08-13, apr-18727aabc978, BEFORE same-row corroboration existed: access_key and secret_key resolved
    // and were non-empty; 업체코드's column resolved to two cells and nothing settled it. A key DOES exist on
    // that account — and the honest answer was still UNKNOWN, because the reading did not establish it.
    const sitting1 = census([
      { ...resolved("vendor_id"), candidateCellCount: 2, cellResolvedBy: undefined, cellTag: undefined, cellInputCount: undefined, tableOrdinal: undefined },
      resolved("access_key", true),
      resolved("secret_key", true),
    ]);
    const reading = coupangCredentialStateFrom(sitting1, COUPANG_CREDENTIAL_FIELD_IDS);
    expect(reading).toMatchObject({ state: "UNKNOWN", reason: "ROW_NOT_CORROBORATED", field: "vendor_id" });
    expect(mayStartIssuance(reading.state)).toBe(false);
    expect(mayOfferHandoff(reading.state)).toBe(false);
  });

  it("the SAME screen with corroboration is KEY_PRESENT — the rule changed the reading, not the account", () => {
    // The identical shape once 업체코드 settles by same-row corroboration. This is what sitting 2 has to show
    // live before `WING_CREDENTIAL_CELLS_CALIBRATED` may be flipped.
    const corroborated = census([
      { ...resolved("vendor_id", true), candidateCellCount: 2, cellResolvedBy: "ROW_CORROBORATION" },
      resolved("access_key", true),
      resolved("secret_key", true),
    ]);
    const reading = coupangCredentialStateFrom(corroborated, COUPANG_CREDENTIAL_FIELD_IDS);
    expect(reading).toMatchObject({ state: "KEY_PRESENT", reason: "OK" });
    expect(mayStartIssuance(reading.state)).toBe(false);
    expect(mayOfferHandoff(reading.state)).toBe(true);
  });
});

describe("the two predicates, spelled so `UNKNOWN` cannot be read as permission", () => {
  it("only NO_KEY may start an issuance", () => {
    expect(mayStartIssuance("NO_KEY")).toBe(true);
    expect(mayStartIssuance("KEY_PRESENT")).toBe(false);
    expect(mayStartIssuance("UNKNOWN")).toBe(false);
  });

  it("only KEY_PRESENT may offer the handoff", () => {
    expect(mayOfferHandoff("KEY_PRESENT")).toBe(true);
    expect(mayOfferHandoff("NO_KEY")).toBe(false);
    expect(mayOfferHandoff("UNKNOWN")).toBe(false);
  });

  it("the two are never both true — a screen is not simultaneously keyed and keyless", () => {
    for (const s of ["NO_KEY", "KEY_PRESENT", "UNKNOWN"] as const) {
      expect(mayStartIssuance(s) && mayOfferHandoff(s)).toBe(false);
    }
  });
});

describe("it reads no value", () => {
  it("takes a census and returns an enum — there is no value on either side", () => {
    const reading = coupangCredentialStateFrom(all(true), COUPANG_CREDENTIAL_FIELD_IDS);
    // The whole output surface: a state, a reason, optionally a field id from the contract.
    expect(Object.keys(reading).sort()).toEqual(["reason", "state"]);
  });
});
