/**
 * Source guard for the Coupang issuance LIVE-PROOF **bridge client** (`coupang-issuance-live-proof.ts`).
 *
 * This CLI is a diagnostic bridge client — it drives an already-hosted Coupang issuance run over `/bridge/ws`
 * exactly as the frontend would. It NEVER opens a browser, touches WING, or reads a value; it can send only the
 * two benign guidance commands (`START_RUN`, `REQUEST_STEP_RECHECK`). This guard proves that structurally, and
 * that it is gated on the Coupang WING approval flag (a NAVER grant never authorizes it) and inert on import.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";

const HERE = dirname(fileURLToPath(import.meta.url));
const CLI = resolve(HERE, "../../src/cli/coupang-issuance-live-proof.ts");

function codeOnly(path: string): string {
  const raw = readFileSync(path, "utf8").replace(/\/\*[\s\S]*?\*\//g, "");
  return raw
    .split("\n")
    .filter((l) => {
      const t = l.trim();
      return !t.startsWith("//") && !t.startsWith("*");
    })
    .join("\n");
}

/** A bridge client speaks only to the local socket — it can never drive a browser or WING. */
const NO_BROWSER_TOKENS = [
  "playwright",
  "chromium",
  "page.",
  ".evaluate(",
  ".goto(",
  ".click(",
  ".fill(",
  ".type(",
  ".press(",
  "waitForNavigation",
  "window.open",
] as const;

/** No credential/value read of any kind crosses this client. */
const NO_VALUE_READ_TOKENS = [
  ".inputValue(",
  ".textContent",
  ".innerHTML",
  ".getAttribute(",
  "clipboard",
  ".screenshot(",
] as const;

describe("coupang-issuance-live-proof — bridge-client source guard", () => {
  const code = codeOnly(CLI);

  it.each(NO_BROWSER_TOKENS)("never drives a browser / WING (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it.each(NO_VALUE_READ_TOKENS)("never reads a field value / clipboard / screenshot (%s)", (token) => {
    expect(code).not.toContain(token);
  });

  it("**sends ONE command — START_RUN — and cannot advance a checkpoint**", () => {
    expect(code).toContain('type: "START_RUN"');
    // It used to send `REQUEST_STEP_RECHECK` once per appearance of a sentinel file the operator touched: a
    // file any process can create, standing in for "I have SEEN the overlay and done what it asks". A
    // DIAGNOSTIC must not be able to move a live guided walk on to the next instruction — 다음 is the
    // SellerOps frontend's own button, pressed by the seller, in the product path.
    expect(code).not.toContain("REQUEST_STEP_RECHECK");
    expect(code).not.toContain("NEXT_SIGNAL");
    expect(code).not.toContain("sendNext");
    // No mutating/marketplace command types leak into the client either.
    for (const forbidden of ["SUBMIT", "EXPORT", "DOWNLOAD", "APPROVE_"]) {
      expect(code).not.toContain(forbidden);
    }
  });

  it("is gated on the Coupang WING approval flag — a NAVER grant never authorizes it", () => {
    expect(code).toContain("hasCoupangWingRunApproval");
    expect(code).not.toContain("hasLiveRunApproval");
  });

  it("is inert on import — main() runs only when invoked directly", () => {
    expect(code).toContain("import.meta.url === pathToFileURL(process.argv[1]).href");
  });

  it("declares the issuance carrier + coupang channel it drives (never a NAVER channel)", () => {
    expect(code).toContain('const EXPECTED_CARRIER = "issuance"');
    expect(code).toContain('const CHANNEL_CODE = "coupang"');
    expect(code).not.toContain('CHANNEL_CODE = "naver"');
  });
});
