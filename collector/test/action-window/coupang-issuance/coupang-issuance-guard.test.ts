/**
 * Boundary proofs for the ISOLATED Coupang WING API-issuance runtime:
 *  - a SOURCE GUARD that no pure `coupang-issuance/` module can click/type/submit/issue or read a field VALUE
 *    (incl. the Access Key / Secret Key / 업체코드), mirroring the NAVER issuance purity guard. The general
 *    "run anything in the page" primitives (`.evaluate` / `.$eval` / `.$$eval`) are forbidden outright here —
 *    the pure tree observes/annotates via the injected driver only;
 *  - the driver INTERFACE has NO read-value / click / issue method (secret access = 0, structurally);
 *  - the engine's 16-hex gate: a non-opaque locate signature can never become a `targetRef`.
 */
import { describe, it, expect } from "vitest";
import { readFileSync, readdirSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { dirname, resolve } from "node:path";
import { CoupangIssuanceEngine, makeCoupangIssuanceClock } from "../../../src/action-window/coupang-issuance/coupang-issuance-engine";
import { validateEventEnvelope } from "../../../../contracts/action-window/v2/index";

const HERE = dirname(fileURLToPath(import.meta.url));
const SRC = resolve(HERE, "../../../src/action-window/coupang-issuance");
const DRIVER_IFACE = resolve(SRC, "coupang-issuance-driver.ts");

/** Strip block comments and comment/JSDoc lines so prose mentioning a forbidden token never trips. */
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

/** auto click / submit / issue = 0 — no way to act on a WING control (incl. pressing 발급). */
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

/** Secret DOM read = 0 — no way to read a field value, attribute, text, clipboard, or screenshot. */
const NO_VALUE_READ_TOKENS = [
  ".inputValue(",
  ".value", // a bare read (`node.value`) OR a write (`x.value =`) — both forbidden.
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

function coupangIssuanceModules(): Record<string, string> {
  const files: Record<string, string> = {};
  for (const f of readdirSync(SRC).filter((f) => f.endsWith(".ts"))) files[f] = resolve(SRC, f);
  return files;
}

describe("coupang issuance runtime — source guard: auto click/submit/issue = 0", () => {
  for (const [name, path] of Object.entries(coupangIssuanceModules())) {
    const code = codeOnly(path);
    it.each(NO_CLICK_TOKENS)(`${name} never contains %s`, (token) => {
      expect(code).not.toContain(token);
    });
  }
});

describe("coupang issuance runtime — source guard: Secret DOM read = 0", () => {
  for (const [name, path] of Object.entries(coupangIssuanceModules())) {
    const code = codeOnly(path);
    it.each(NO_VALUE_READ_TOKENS)(`${name} never reads a field value / clipboard / screenshot (%s)`, (token) => {
      expect(code).not.toContain(token);
    });
  }
});

describe("coupang issuance driver INTERFACE — secret access = 0, structurally", () => {
  const code = codeOnly(DRIVER_IFACE);

  it("declares only observation/annotation methods — NO login/click/type/submit/issue/read-value method exists", () => {
    // The interface's method surface: probe/settle/locate/highlight/clear/arm/observe/cleanup/close only.
    for (const forbidden of [
      "login",
      "click",
      "type(",
      "fill(",
      "submit",
      "issue(",
      "pressIssue",
      "readValue",
      "readCredential",
      "inputValue",
      "getValue",
      "copyKeys(",
    ]) {
      expect(code, forbidden).not.toContain(forbidden);
    }
    // The methods that DO exist are the sanitized observation/annotation seam.
    for (const method of ["probeSurface", "locateTarget", "highlightTarget", "clearHighlight", "armObserve", "observeUserAction", "cleanup"]) {
      expect(code).toContain(method);
    }
  });

  it("locateTarget returns a LocateResult (an opaque 16-hex sig), never a selector/value", () => {
    expect(code).toContain("LocateResult");
    expect(code).not.toContain("selector");
  });
});

describe("coupang issuance engine — a non-opaque locate signature can never become a targetRef", () => {
  it("parks target_not_found on a raw-value sig, and never emits that value on the wire", () => {
    const RAW = "raw-secret-value-1234"; // exactly what a mis-written live driver might return as a "sig"
    const eng = new CoupangIssuanceEngine({ runId: "r", channelCode: "coupang" }, { clock: makeCoupangIssuanceClock() });
    eng.command({ type: "START_RUN", expectedRevision: 0 });
    eng.onSurfaceProbed({ ok: true, pageCategory: "open_api_issuance" }); // → guide self_dev
    eng.onTargetLocated("issue", { count: 1, sig: RAW });

    expect(eng.currentStage()).toBe("target_not_found");
    for (const e of eng.events()) expect(JSON.stringify(e)).not.toContain(RAW);
    for (const e of eng.events()) expect(validateEventEnvelope(e).ok).toBe(true);
  });
});
