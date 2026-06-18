import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  captureAccountSignals,
  sanitizedAccountSignalSummary,
  type AccountSignalSnapshot,
} from "../../src/naver/account-signal-capture";
import { toAccountFingerprintInput } from "../../src/naver/account-fingerprint-adapter";
import { extractAccountFingerprint } from "../../src/naver/account-fingerprint";
import { fingerprintHash, createPendingConnection } from "../../src/connection/connection";
import { completeManualAccountSelection } from "../../src/connection/workflow";

const COMMERCE = "FAKE_COMMERCE_ID_홍길동스토어_0001";
const STORE_PATH = "smartstore/honggildong-fake";
const ACCOUNT = "FAKE_ACCOUNT_SCOPE_김철수_9999";

function snapshot(over: Partial<AccountSignalSnapshot> = {}): AccountSignalSnapshot {
  return {
    urlCategory: "seller-center",
    loggedInSignal: true,
    sellerShellSignal: true,
    ...over,
  };
}

describe("captureAccountSignals — gating", () => {
  it("captures rawSignals when logged in, on seller-center, with shell + candidate", () => {
    const r = captureAccountSignals(snapshot({ commerceIdTextCandidate: COMMERCE }));
    expect(r.ok).toBe(true);
    if (!r.ok) return;
    expect(r.rawSignals).toEqual({
      urlCategory: "seller-center",
      loggedInSignal: true,
      sellerShellSignal: true,
      commerceIdCandidate: COMMERCE,
      storeUrlPathCandidate: null,
      accountScopeCandidate: null,
    });
  });

  it("not logged in → not-logged-in", () => {
    expect(captureAccountSignals(snapshot({ loggedInSignal: false }))).toEqual({
      ok: false,
      reasonCategory: "not-logged-in",
    });
  });

  it("not on seller-center → not-logged-in", () => {
    expect(captureAccountSignals(snapshot({ urlCategory: "login" }))).toEqual({
      ok: false,
      reasonCategory: "not-logged-in",
    });
  });

  it("missing seller shell → missing-seller-shell (conservative)", () => {
    expect(captureAccountSignals(snapshot({ sellerShellSignal: false }))).toEqual({
      ok: false,
      reasonCategory: "missing-seller-shell",
    });
  });
});

describe("captureAccountSignals — sanitization", () => {
  it("drops empty/whitespace candidates to null", () => {
    const r = captureAccountSignals(
      snapshot({ commerceIdTextCandidate: "   ", storeUrlPathCandidate: "", accountScopeTextCandidate: ACCOUNT }),
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.rawSignals.commerceIdCandidate).toBeNull();
    expect(r.rawSignals.storeUrlPathCandidate).toBeNull();
    expect(r.rawSignals.accountScopeCandidate).toBe(ACCOUNT);
  });

  it("trims surrounding whitespace, preserves case/content", () => {
    const r = captureAccountSignals(snapshot({ commerceIdTextCandidate: `  ${COMMERCE}  ` }));
    if (!r.ok) throw new Error("expected ok");
    expect(r.rawSignals.commerceIdCandidate).toBe(COMMERCE);
  });

  it("drops URL candidates carrying a query or hash", () => {
    const r = captureAccountSignals(
      snapshot({
        commerceIdTextCandidate: "https://sell.smartstore.naver.com/#/x?token=SECRET",
        storeUrlPathCandidate: "/store/page#frag",
        accountScopeTextCandidate: ACCOUNT,
      }),
    );
    if (!r.ok) throw new Error("expected ok");
    expect(r.rawSignals.commerceIdCandidate).toBeNull();
    expect(r.rawSignals.storeUrlPathCandidate).toBeNull();
    expect(r.rawSignals.accountScopeCandidate).toBe(ACCOUNT);
  });
});

describe("capture output flows through the full offline pipeline", () => {
  it("resolvable single candidate → extract → hash → completeManualAccountSelection", () => {
    const cap = captureAccountSignals(snapshot({ commerceIdTextCandidate: COMMERCE }));
    if (!cap.ok) throw new Error("expected ok");
    const input = toAccountFingerprintInput(cap.rawSignals);
    const extracted = extractAccountFingerprint(input);
    expect(extracted.resolvable).toBe(true);
    if (!extracted.resolvable) return;
    const conn = createPendingConnection({
      connectionId: "conn-cap-1",
      platform: "NAVER_SMARTSTORE",
      userProvidedDisplayName: "내 스토어",
      now: "2026-06-18T00:00:00.000Z",
    });
    const bound = completeManualAccountSelection(
      conn,
      fingerprintHash(extracted.rawIdentityToken),
      extracted.sourceCategory,
      "내 스토어",
      "2026-06-18T00:00:00.000Z",
    );
    expect(bound.connectionStatus).toBe("CONNECTED");
    expect(bound.boundStoreFingerprintHash).toBe(fingerprintHash(COMMERCE));
    expect(JSON.stringify(bound)).not.toContain(COMMERCE);
  });

  it("conflicting candidates stay ambiguous downstream", () => {
    const cap = captureAccountSignals(
      snapshot({ commerceIdTextCandidate: COMMERCE, accountScopeTextCandidate: ACCOUNT }),
    );
    if (!cap.ok) throw new Error("expected ok");
    expect(extractAccountFingerprint(toAccountFingerprintInput(cap.rawSignals))).toEqual({
      resolvable: false,
      reasonCategory: "ambiguous-seller-context",
    });
  });
});

describe("sanitizedAccountSignalSummary", () => {
  it("reports counts/categories/signals only — never a raw token", () => {
    const summary = sanitizedAccountSignalSummary(
      snapshot({ commerceIdTextCandidate: COMMERCE, storeUrlPathCandidate: STORE_PATH }),
    );
    expect(summary).toEqual({
      urlCategory: "seller-center",
      loggedInSignal: true,
      sellerShellSignal: true,
      candidateCount: "few",
      sourceCategoriesPresent: ["commerce-id", "store-url-path"],
    });
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain(COMMERCE);
    expect(serialized).not.toContain(STORE_PATH);
    expect(serialized).not.toContain("홍길동");
  });

  it("excludes candidates that normalize away (query/hash, empty)", () => {
    const summary = sanitizedAccountSignalSummary(
      snapshot({ commerceIdTextCandidate: "/x?token=Y", storeUrlPathCandidate: "  " }),
    );
    expect(summary.candidateCount).toBe("none");
    expect(summary.sourceCategoriesPresent).toEqual([]);
  });
});

describe("module boundary", () => {
  it("imports no Playwright / browser / fs / network / env", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "naver", "account-signal-capture.ts"),
      "utf8",
    );
    const imports = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l))
      .join("\n");
    expect(/playwright/i.test(imports)).toBe(false);
    expect(/chromium/i.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?fs(\/promises)?["']/.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?https?["']/.test(imports)).toBe(false);
    expect(/process\.env|\bfetch\(|\baxios\b/.test(src)).toBe(false);
  });

  it("no real NAVER fixtures/raw HTML were added under fixtures/", () => {
    const fixturesDir = join(__dirname, "..", "..", "fixtures");
    const added = readdirSync(fixturesDir).filter(
      (f) => f.startsWith("account_fingerprint") || f.startsWith("account_signal"),
    );
    expect(added).toEqual([]);
  });
});
