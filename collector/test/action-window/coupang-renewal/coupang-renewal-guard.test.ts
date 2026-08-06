/**
 * Boundary proofs for the ISOLATED Coupang WING credential-RENEWAL runtime:
 *  - a SOURCE GUARD that no pure `coupang-renewal/` WALK module (engine/stages/driver/session/fixture) can
 *    click/type/submit/re-issue or read a field VALUE (incl. the Access Key / Secret Key / 업체코드). The general
 *    "run anything in the page" primitives (`.evaluate` / `.$eval` / `.$$eval`) are forbidden outright — the pure
 *    tree observes/annotates via the injected driver only. (The `wing-validity-reader` is deliberately NOT in this
 *    set: it carries the ONE allowlisted 유효기간 read and has its own guard in `wing-validity-reader.test.ts`.)
 *  - the driver INTERFACE has NO click / re-issue / read-KEY method (secret access = 0, structurally); its ONLY
 *    read seam is the allowlisted `readValidityDate` (returns an ISO date or null, never a key);
 *  - the engine's 16-hex gate: a non-opaque locate signature can never become a `targetRef`;
 *  - the fixture reader seam can never emit a KEY value.
 */
import { describe, it, expect } from "vitest";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CoupangRenewalEngine, makeCoupangRenewalClock } from "../../../src/action-window/coupang-renewal/coupang-renewal-engine";
import { CoupangRenewalFixtureDriver } from "../../../src/action-window/coupang-renewal/coupang-renewal-fixture-driver";
import { validateEventEnvelope } from "../../../../contracts/action-window/v2/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../../src/action-window/coupang-renewal");
const DRIVER_IFACE = resolve(SRC, "coupang-renewal-driver.ts");

/** The pure WALK modules — everything except the allowlisted `wing-validity-reader`. */
const WALK_MODULES: Record<string, string> = {
  "coupang-renewal-engine.ts": resolve(SRC, "coupang-renewal-engine.ts"),
  "coupang-renewal-stages.ts": resolve(SRC, "coupang-renewal-stages.ts"),
  "coupang-renewal-driver.ts": resolve(SRC, "coupang-renewal-driver.ts"),
  "coupang-renewal-session.ts": resolve(SRC, "coupang-renewal-session.ts"),
  "coupang-renewal-fixture-driver.ts": resolve(SRC, "coupang-renewal-fixture-driver.ts"),
};

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

const NO_CLICK_TOKENS = [
  ".click(",
  ".dblclick(",
  ".tap(",
  ".hover(",
  ".type(",
  ".fill(",
  ".press(",
  ".check(",
  ".uncheck(",
  ".selectOption(",
  ".setInputFiles(",
  ".keyboard",
  "dispatchEvent",
  ".submit(",
  ".evaluate(",
  ".evaluateHandle(",
  ".$eval(",
  ".$$eval(",
  'waitForEvent("download"',
  "waitForEvent('download'",
] as const;

const NO_VALUE_READ_TOKENS = [
  ".inputValue(",
  ".value",
  "= el.value",
  ".textContent",
  ".innerText",
  ".innerHTML",
  ".getAttribute(",
  ".getProperty(",
  ".getProperties(",
  ".content(",
  "clipboard",
  "readText(",
  ".screenshot(",
] as const;

describe("coupang renewal runtime — source guard: auto click/submit/re-issue = 0", () => {
  for (const [name, path] of Object.entries(WALK_MODULES)) {
    const code = codeOnly(path);
    it.each(NO_CLICK_TOKENS)(`${name} never contains %s`, (token) => {
      expect(code).not.toContain(token);
    });
  }
});

describe("coupang renewal runtime — source guard: Secret DOM read = 0", () => {
  for (const [name, path] of Object.entries(WALK_MODULES)) {
    const code = codeOnly(path);
    it.each(NO_VALUE_READ_TOKENS)(`${name} never reads a field value / clipboard / screenshot (%s)`, (token) => {
      expect(code).not.toContain(token);
    });
  }
});

describe("coupang renewal driver INTERFACE — secret access = 0, structurally", () => {
  const code = codeOnly(DRIVER_IFACE);

  it("declares NO login/click/type/submit/re-issue/read-KEY method — only observation/annotation + the allowlisted date seam", () => {
    for (const forbidden of [
      "login",
      "click",
      "type(",
      "fill(",
      "submit",
      "reissue(",
      "pressReissue",
      "readValue",
      "readCredential",
      "readSecret",
      "readKey(",
      "inputValue",
      "getValue",
      "copyKeys(",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    for (const method of ["probeSurface", "locateTarget", "highlightTarget", "clearHighlight", "armObserve", "observeUserAction", "cleanup"]) {
      expect(code).toContain(method);
    }
    // The ONE read seam is the allowlisted validity date — an ISO date or null, never a key.
    expect(code).toContain("readValidityDate");
  });

  it("locateTarget returns a LocateResult (an opaque 16-hex sig), never a selector/value", () => {
    expect(code).toContain("LocateResult");
    expect(code).not.toContain("selector");
  });
});

describe("coupang renewal engine — a non-opaque locate signature can never become a targetRef", () => {
  it("parks target_not_found on a raw-value sig, and never emits that value on the wire", () => {
    const RAW = "raw-secret-value-1234";
    const eng = new CoupangRenewalEngine({ runId: "r", channelCode: "coupang" }, { clock: makeCoupangRenewalClock() });
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" }); // → guide check_expiry
    eng.onTargetLocated("check_expiry", { count: 1, sig: RAW });

    expect(eng.currentStage()).toBe("target_not_found");
    for (const e of eng.events()) expect(JSON.stringify(e)).not.toContain(RAW);
    for (const e of eng.events()) expect(validateEventEnvelope(e).ok).toBe(true);
  });
});

describe("coupang renewal fixture reader seam — can only ever emit a sanitized date, never a key", () => {
  it("returns an ISO date for a clean value, null for a key-shaped one", async () => {
    const clean = new CoupangRenewalFixtureDriver({ validityRaw: "2027-03-15" });
    expect(await clean.readValidityDate()).toBe("2027-03-15");

    const secret = new CoupangRenewalFixtureDriver({ validityRaw: "wJalrXUtnFEMI/K7MDENG/bPxRfiCYEXAMPLEKEY" });
    expect(await secret.readValidityDate()).toBeNull();

    const missing = new CoupangRenewalFixtureDriver({ validityRaw: null });
    expect(await missing.readValidityDate()).toBeNull();

    // Default (no script field) → a clean synthetic ISO date.
    const dflt = new CoupangRenewalFixtureDriver();
    expect(await dflt.readValidityDate()).toMatch(/^\d{4}-\d{2}-\d{2}$/);
  });
});
