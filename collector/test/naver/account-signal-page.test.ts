import { existsSync, mkdtempSync, readFileSync, readdirSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, describe, expect, it } from "vitest";
import {
  toAccountSignalSnapshot,
  type AccountSignalPageProbe,
} from "../../src/naver/account-signal-page";
import {
  captureAccountSignals,
  sanitizedAccountSignalSummary,
} from "../../src/naver/account-signal-capture";
import { toAccountFingerprintInput } from "../../src/naver/account-fingerprint-adapter";
import { extractAccountFingerprint } from "../../src/naver/account-fingerprint";
import { runConnectionBindFromSignals } from "../../src/connection/onboarding";
import { createPendingConnection, fingerprintHash } from "../../src/connection/connection";
import { createConnectionRegistry } from "../../src/connection/registry";
import { saveConnectionRegistryToFile, loadConnectionRegistryFromFile } from "../../src/connection/store";

// Synthetic raw URL carrying a query token — must never reach the snapshot.
const SELLER_URL = "https://sell.smartstore.naver.com/#/seller/home?token=SECRET_QUERY_TOKEN";
const LOGIN_URL = "https://nid.naver.com/nidlogin.login?url=x";
const COMMERCE = "FAKE_COMMERCE_ID_홍길동스토어_0001";
const ACCOUNT = "FAKE_ACCOUNT_SCOPE_김철수_9999";
const ALIAS = "내 메인 스토어";

function probe(over: Partial<AccountSignalPageProbe> = {}): AccountSignalPageProbe {
  return {
    currentUrl: SELLER_URL,
    loggedInSignal: true,
    sellerShellSignal: true,
    ...over,
  };
}

describe("toAccountSignalSnapshot", () => {
  it("maps a logged-in seller-center probe to a snapshot (URL → category)", () => {
    const snap = toAccountSignalSnapshot(probe({ commerceIdCandidate: COMMERCE }));
    expect(snap).toEqual({
      urlCategory: "seller-center",
      loggedInSignal: true,
      sellerShellSignal: true,
      commerceIdTextCandidate: COMMERCE,
      storeUrlPathCandidate: null,
      accountScopeTextCandidate: null,
    });
  });

  it("categorizes a login URL conservatively and never emits the raw URL", () => {
    const snap = toAccountSignalSnapshot(probe({ currentUrl: LOGIN_URL, loggedInSignal: false }));
    expect(snap.urlCategory).toBe("login");
    const serialized = JSON.stringify(snap);
    expect(serialized).not.toContain(SELLER_URL);
    expect(serialized).not.toContain(LOGIN_URL);
    expect(serialized).not.toContain("SECRET_QUERY_TOKEN");
  });

  it("carries candidates only as named fields (no raw URL, no blobs)", () => {
    const snap = toAccountSignalSnapshot(
      probe({ commerceIdCandidate: COMMERCE, accountScopeCandidate: ACCOUNT }),
    );
    expect(snap.commerceIdTextCandidate).toBe(COMMERCE);
    expect(snap.accountScopeTextCandidate).toBe(ACCOUNT);
    expect(JSON.stringify(snap)).not.toContain("?token=");
  });
});

describe("downstream integration", () => {
  it("login/logged-out snapshot → captureAccountSignals fails (not-logged-in)", () => {
    const snap = toAccountSignalSnapshot(probe({ currentUrl: LOGIN_URL, loggedInSignal: false }));
    expect(captureAccountSignals(snap)).toEqual({ ok: false, reasonCategory: "not-logged-in" });
  });

  it("a query/hash URL candidate is not surfaced as identity downstream", () => {
    // The candidate itself is a URL with query → captureAccountSignals normalizes it away.
    const snap = toAccountSignalSnapshot(
      probe({ commerceIdCandidate: "https://x/store#/a?token=Y" }),
    );
    const cap = captureAccountSignals(snap);
    expect(cap.ok).toBe(true);
    if (!cap.ok) return;
    expect(cap.rawSignals.commerceIdCandidate).toBeNull();
    // No resolvable identity from a dropped candidate.
    expect(extractAccountFingerprint(toAccountFingerprintInput(cap.rawSignals))).toEqual({
      resolvable: false,
      reasonCategory: "missing-seller-context",
    });
  });

  it("the snapshot's raw URL never appears in a sanitized summary", () => {
    const snap = toAccountSignalSnapshot(probe({ commerceIdCandidate: COMMERCE }));
    const summary = sanitizedAccountSignalSummary(snap);
    const serialized = JSON.stringify(summary);
    expect(serialized).not.toContain("SECRET_QUERY_TOKEN");
    expect(serialized).not.toContain(COMMERCE);
    expect(serialized).not.toContain("홍길동");
  });
});

describe("full pipeline: page probe → bind (temp store)", () => {
  let dir: string;
  let storeFile: string;
  beforeEach(() => {
    dir = mkdtempSync(join(tmpdir(), "conn-page-"));
    storeFile = join(dir, ".connections", "connections.json");
    saveConnectionRegistryToFile(
      storeFile,
      createConnectionRegistry([
        createPendingConnection({
          connectionId: "conn-1",
          platform: "NAVER_SMARTSTORE",
          userProvidedDisplayName: ALIAS,
          now: "2026-06-18T00:00:00.000Z",
        }),
      ]),
    );
  });
  afterEach(() => rmSync(dir, { recursive: true, force: true }));

  it("resolvable probe → capture → bind connection to CONNECTED", () => {
    const cap = captureAccountSignals(toAccountSignalSnapshot(probe({ commerceIdCandidate: COMMERCE })));
    expect(cap.ok).toBe(true);
    if (!cap.ok) return;
    const out = runConnectionBindFromSignals({
      connectionId: "conn-1",
      storeFile,
      rawSignals: cap.rawSignals,
      now: "2026-06-18T04:00:00.000Z",
    });
    expect(out.ok).toBe(true);
    if (!out.ok) return;
    expect(out.result.connectionStatus).toBe("CONNECTED");
    expect(out.result.sourceCategory).toBe("commerce-id");
    // Persisted with the hash only, never the raw token.
    const conn = loadConnectionRegistryFromFile(storeFile).get("conn-1");
    expect(conn?.boundStoreFingerprintHash).toBe(fingerprintHash(COMMERCE));
    expect(readFileSync(storeFile, "utf8")).not.toContain(COMMERCE);
    expect(existsSync(storeFile)).toBe(true);
  });
});

describe("module boundary", () => {
  it("imports no Playwright / browser / fs / network / env", () => {
    const src = readFileSync(
      join(__dirname, "..", "..", "src", "naver", "account-signal-page.ts"),
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

  it("no real NAVER fixtures/raw HTML/screenshots were added under fixtures/", () => {
    const fixturesDir = join(__dirname, "..", "..", "fixtures");
    const added = readdirSync(fixturesDir).filter(
      (f) => f.startsWith("account_signal") || f.startsWith("account_fingerprint"),
    );
    expect(added).toEqual([]);
  });
});
