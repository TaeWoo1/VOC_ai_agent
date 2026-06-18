import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  sanitizedAdapterSummary,
  toAccountFingerprintInput,
  type AccountFingerprintRawSignals,
} from "../../src/naver/account-fingerprint-adapter";
import { extractAccountFingerprint } from "../../src/naver/account-fingerprint";
import { fingerprintHash, createPendingConnection } from "../../src/connection/connection";
import { completeManualAccountSelection } from "../../src/connection/workflow";

const COMMERCE = "FAKE_COMMERCE_ID_홍길동스토어_0001";
const STORE_PATH = "smartstore/honggildong-fake";
const ACCOUNT = "FAKE_ACCOUNT_SCOPE_0001";

function signals(over: Partial<AccountFingerprintRawSignals> = {}): AccountFingerprintRawSignals {
  return {
    urlCategory: "seller-center",
    loggedInSignal: true,
    sellerShellSignal: true,
    ...over,
  };
}

describe("toAccountFingerprintInput", () => {
  it("converts each candidate field to a typed candidate, preserving signals", () => {
    const out = toAccountFingerprintInput(
      signals({
        commerceIdCandidate: COMMERCE,
        storeUrlPathCandidate: STORE_PATH,
        accountScopeCandidate: ACCOUNT,
      }),
    );
    expect(out.urlCategory).toBe("seller-center");
    expect(out.loggedInSignal).toBe(true);
    expect(out.sellerShellSignal).toBe(true);
    expect(out.accountContextCandidates).toEqual([
      { sourceCategory: "commerce-id", token: COMMERCE },
      { sourceCategory: "store-url-path", token: STORE_PATH },
      { sourceCategory: "account-scope", token: ACCOUNT },
    ]);
  });

  it("ignores absent, empty, and whitespace-only candidates", () => {
    const out = toAccountFingerprintInput(
      signals({
        commerceIdCandidate: COMMERCE,
        storeUrlPathCandidate: "   ",
        accountScopeCandidate: "",
      }),
    );
    expect(out.accountContextCandidates).toEqual([{ sourceCategory: "commerce-id", token: COMMERCE }]);
  });

  it("trims surrounding whitespace but preserves case and inner content", () => {
    const out = toAccountFingerprintInput(
      signals({ commerceIdCandidate: `  ${COMMERCE}  `, storeUrlPathCandidate: STORE_PATH }),
    );
    expect(out.accountContextCandidates[0]).toEqual({ sourceCategory: "commerce-id", token: COMMERCE });
    // Case preserved (no lowercasing).
    const mixed = toAccountFingerprintInput(signals({ commerceIdCandidate: "AbCdEf-123" }));
    expect(mixed.accountContextCandidates[0]?.token).toBe("AbCdEf-123");
  });

  it("rejects full URL candidates carrying a query or hash", () => {
    const withQuery = toAccountFingerprintInput(
      signals({ commerceIdCandidate: "https://sell.smartstore.naver.com/#/store?token=SECRET" }),
    );
    expect(withQuery.accountContextCandidates).toEqual([]);
    const withHash = toAccountFingerprintInput(
      signals({ storeUrlPathCandidate: "/store/page#section" }),
    );
    expect(withHash.accountContextCandidates).toEqual([]);
  });

  it("keeps a bare path-like token (no query/hash)", () => {
    const out = toAccountFingerprintInput(signals({ storeUrlPathCandidate: STORE_PATH }));
    expect(out.accountContextCandidates).toEqual([
      { sourceCategory: "store-url-path", token: STORE_PATH },
    ]);
  });
});

describe("adapter output flows into the extractor + connection layer", () => {
  it("resolves a single candidate and binds via completeManualAccountSelection", () => {
    const input = toAccountFingerprintInput(signals({ commerceIdCandidate: COMMERCE }));
    const r = extractAccountFingerprint(input);
    expect(r.resolvable).toBe(true);
    if (!r.resolvable) return;
    const conn = createPendingConnection({
      connectionId: "conn-adapter-1",
      platform: "NAVER_SMARTSTORE",
      userProvidedDisplayName: "내 스토어",
      now: "2026-06-18T00:00:00.000Z",
    });
    const bound = completeManualAccountSelection(
      conn,
      fingerprintHash(r.rawIdentityToken),
      r.sourceCategory,
      "내 스토어",
      "2026-06-18T00:00:00.000Z",
    );
    expect(bound.connectionStatus).toBe("CONNECTED");
    expect(bound.boundStoreFingerprintHash).toBe(fingerprintHash(COMMERCE));
    expect(JSON.stringify(bound)).not.toContain(COMMERCE);
  });

  it("conflicting candidates stay conflicting → extractor returns ambiguous", () => {
    const input = toAccountFingerprintInput(
      signals({ commerceIdCandidate: COMMERCE, accountScopeCandidate: ACCOUNT }),
    );
    expect(extractAccountFingerprint(input)).toEqual({
      resolvable: false,
      reasonCategory: "ambiguous-seller-context",
    });
  });
});

describe("sanitizedAdapterSummary", () => {
  it("reports counts/categories/signals only — never a raw token", () => {
    const input = toAccountFingerprintInput(
      signals({ commerceIdCandidate: COMMERCE, storeUrlPathCandidate: STORE_PATH }),
    );
    const summary = sanitizedAdapterSummary(input);
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
});

describe("module boundary", () => {
  it("imports no Playwright / fs / network / env", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "naver", "account-fingerprint-adapter.ts"),
      "utf8",
    );
    const importLines = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/playwright/i.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?fs(\/promises)?["']/.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?https?["']/.test(imports)).toBe(false);
    expect(/process\.env|\bfetch\(|\baxios\b/.test(src)).toBe(false);
  });

  it("no real NAVER fixture files were added under fixtures/", () => {
    const fixturesDir = join(__dirname, "..", "..", "fixtures");
    const accountFixtures = readdirSync(fixturesDir).filter((f) => f.startsWith("account_fingerprint"));
    expect(accountFixtures).toEqual([]);
  });
});
