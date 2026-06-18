import { readFileSync, readdirSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import {
  extractAccountFingerprint,
  sanitizedFingerprintSummary,
  type AccountFingerprintInput,
} from "../../src/naver/account-fingerprint";
import { fingerprintHash } from "../../src/connection/connection";
import { completeManualAccountSelection } from "../../src/connection/workflow";
import { createPendingConnection } from "../../src/connection/connection";

const RAW = "FAKE_COMMERCE_ID_홍길동스토어_0001";
const RAW_OTHER = "FAKE_COMMERCE_ID_김철수스토어_9999";

function input(over: Partial<AccountFingerprintInput> = {}): AccountFingerprintInput {
  return {
    urlCategory: "seller-center",
    loggedInSignal: true,
    sellerShellSignal: true,
    accountContextCandidates: [{ sourceCategory: "commerce-id", token: RAW }],
    ...over,
  };
}

describe("extractAccountFingerprint", () => {
  it("not logged in → not-logged-in", () => {
    expect(extractAccountFingerprint(input({ loggedInSignal: false }))).toEqual({
      resolvable: false,
      reasonCategory: "not-logged-in",
    });
  });

  it("not on seller-center → not-logged-in", () => {
    expect(extractAccountFingerprint(input({ urlCategory: "login" }))).toEqual({
      resolvable: false,
      reasonCategory: "not-logged-in",
    });
  });

  it("seller shell not confirmed → unknown (conservative)", () => {
    expect(extractAccountFingerprint(input({ sellerShellSignal: false }))).toEqual({
      resolvable: false,
      reasonCategory: "unknown",
    });
  });

  it("seller-center but no candidate → missing-seller-context", () => {
    expect(extractAccountFingerprint(input({ accountContextCandidates: [] }))).toEqual({
      resolvable: false,
      reasonCategory: "missing-seller-context",
    });
  });

  it("exactly one stable candidate → resolvable with its source category", () => {
    expect(extractAccountFingerprint(input())).toEqual({
      resolvable: true,
      rawIdentityToken: RAW,
      sourceCategory: "commerce-id",
    });
  });

  it("multiple identical candidates → deterministic resolvable", () => {
    const r = extractAccountFingerprint(
      input({
        accountContextCandidates: [
          { sourceCategory: "commerce-id", token: RAW },
          { sourceCategory: "commerce-id", token: RAW },
        ],
      }),
    );
    expect(r).toEqual({ resolvable: true, rawIdentityToken: RAW, sourceCategory: "commerce-id" });
  });

  it("same token under different source labels → resolvable, strongest source wins", () => {
    const r = extractAccountFingerprint(
      input({
        accountContextCandidates: [
          { sourceCategory: "store-url-path", token: RAW },
          { sourceCategory: "commerce-id", token: RAW },
        ],
      }),
    );
    // Same identity (token) → safe; deterministic source by precedence (commerce-id).
    expect(r).toEqual({ resolvable: true, rawIdentityToken: RAW, sourceCategory: "commerce-id" });
  });

  it("multiple conflicting tokens → ambiguous-seller-context", () => {
    const r = extractAccountFingerprint(
      input({
        accountContextCandidates: [
          { sourceCategory: "commerce-id", token: RAW },
          { sourceCategory: "commerce-id", token: RAW_OTHER },
        ],
      }),
    );
    expect(r).toEqual({ resolvable: false, reasonCategory: "ambiguous-seller-context" });
  });
});

describe("safety: no raw identity in failure results or summaries", () => {
  it("failure results never contain the raw token", () => {
    const failures = [
      extractAccountFingerprint(input({ loggedInSignal: false })),
      extractAccountFingerprint(input({ sellerShellSignal: false })),
      extractAccountFingerprint(input({ accountContextCandidates: [] })),
      extractAccountFingerprint(
        input({
          accountContextCandidates: [
            { sourceCategory: "commerce-id", token: RAW },
            { sourceCategory: "commerce-id", token: RAW_OTHER },
          ],
        }),
      ),
    ];
    for (const f of failures) {
      expect(JSON.stringify(f)).not.toContain(RAW);
      expect(JSON.stringify(f)).not.toContain(RAW_OTHER);
      expect(JSON.stringify(f)).not.toContain("홍길동");
    }
  });

  it("sanitizedFingerprintSummary never contains the raw token (resolvable or not)", () => {
    const ok = input();
    const okSummary = sanitizedFingerprintSummary(ok, extractAccountFingerprint(ok));
    expect(okSummary).toEqual({
      resolvable: true,
      sourceCategory: "commerce-id",
      distinctCandidateCount: "one",
    });
    expect(JSON.stringify(okSummary)).not.toContain(RAW);

    const ambiguous = input({
      accountContextCandidates: [
        { sourceCategory: "commerce-id", token: RAW },
        { sourceCategory: "commerce-id", token: RAW_OTHER },
      ],
    });
    const ambSummary = sanitizedFingerprintSummary(ambiguous, extractAccountFingerprint(ambiguous));
    expect(ambSummary.resolvable).toBe(false);
    expect(ambSummary.reasonCategory).toBe("ambiguous-seller-context");
    expect(ambSummary.distinctCandidateCount).toBe("few");
    expect(JSON.stringify(ambSummary)).not.toContain(RAW);
    expect(JSON.stringify(ambSummary)).not.toContain(RAW_OTHER);
  });
});

describe("integration: extractor output threads into the connection layer", () => {
  it("a resolvable token can be hashed and bound via completeManualAccountSelection", () => {
    const r = extractAccountFingerprint(input());
    expect(r.resolvable).toBe(true);
    if (!r.resolvable) return;
    const conn = createPendingConnection({
      connectionId: "conn-fp-1",
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
    expect(bound.boundStoreFingerprintHash).toBe(fingerprintHash(RAW));
    expect(bound.fingerprintSourceCategory).toBe("commerce-id");
    // The raw token must not survive into the bound connection.
    expect(JSON.stringify(bound)).not.toContain(RAW);
  });
});

describe("module boundary", () => {
  it("the extractor imports no Playwright / browser / fs / network", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "naver", "account-fingerprint.ts"),
      "utf8",
    );
    // Check IMPORT statements only (the word "Playwright" may legitimately appear
    // in a doc comment); an import would couple the pure extractor to a runtime.
    const importLines = src
      .split("\n")
      .filter((l) => /^\s*import\b/.test(l) || /\bfrom\s+["']/.test(l));
    const imports = importLines.join("\n");
    expect(/playwright/i.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?fs(\/promises)?["']/.test(imports)).toBe(false);
    expect(/from\s+["'](node:)?https?["']/.test(imports)).toBe(false);
    // No runtime network calls either.
    expect(/\bfetch\(|\baxios\b/.test(src)).toBe(false);
  });

  it("no real NAVER fixture files were added under fixtures/", () => {
    // This slice uses inline synthetic inputs only; assert no account_fingerprint_* fixtures slipped in.
    const fixturesDir = join(__dirname, "..", "..", "fixtures");
    const entries = readdirSync(fixturesDir);
    const accountFixtures = entries.filter((f) => f.startsWith("account_fingerprint"));
    // If any are added later they must be synthetic; for this slice there are none.
    expect(accountFixtures).toEqual([]);
  });
});
