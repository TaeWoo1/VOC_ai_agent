/**
 * **Every probe-driver method must survive its LAZY wrapper.**
 *
 * The lazy drivers are the PRODUCT path — the resident helper always builds one, so a method the wrapper does
 * not forward is a method the product does not have, however complete the real driver is. And the sessions
 * treat several of these as OPTIONAL (`driver.probeCredentialState?.()`), so a missing one degrades silently
 * into a fail-closed default rather than throwing anywhere a test would see it.
 *
 * That is exactly what happened. `CoupangIssuanceGuidanceSession`'s `CHECK_CREDENTIAL_STATE` reads
 * `probeCredentialState` optionally and treats absence as `UNKNOWN`, which parks — deliberately, because "a
 * driver that cannot answer" must never be read as "this account has no key". `LazyCoupangIssuanceDriver` never
 * forwarded it, so on the product path the answer was `UNKNOWN` **every time**: live 2026-08-19, a seller
 * reached the real open-API page, the runtime classified it correctly 76 times, read `UNKNOWN` 76 times, and
 * parked — no step guided, no highlight on the page they had just reached.
 *
 * A per-method delegation test would have to be remembered for each new method. This is a structural sweep
 * instead: parse each probe-driver interface and assert the wrapper implements every member of it.
 */
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const read = (rel: string): string => readFileSync(fileURLToPath(new URL(rel, import.meta.url)), "utf8");

/** Method names declared on an interface, comments stripped (a docblock legitimately names other methods). */
function interfaceMethods(source: string, name: string): string[] {
  const start = source.indexOf(`export interface ${name} {`);
  if (start < 0) throw new Error(`interface ${name} not found`);
  const body = source.slice(start, source.indexOf("\n}", start));
  const code = body.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\/\/.*/g, "");
  return [...new Set([...code.matchAll(/^\s*(\w+)\??\s*[(<]/gm)].map((m) => m[1]!))];
}

const CASES: ReadonlyArray<{ label: string; iface: string; ifaceName: string; lazy: string }> = [
  {
    label: "Coupang issuance",
    iface: "../../src/action-window/coupang-issuance/coupang-issuance-driver.ts",
    ifaceName: "CoupangIssuanceProbeDriver",
    lazy: "../../src/action-window/coupang-issuance/lazy-coupang-issuance-driver.ts",
  },
  {
    label: "NAVER issuance",
    iface: "../../src/action-window/api-issuance/issuance-driver.ts",
    ifaceName: "IssuanceProbeDriver",
    lazy: "../../src/action-window/api-issuance/lazy-naver-issuance-driver.ts",
  },
  {
    label: "Coupang renewal",
    iface: "../../src/action-window/coupang-renewal/coupang-renewal-driver.ts",
    ifaceName: "CoupangRenewalProbeDriver",
    lazy: "../../src/action-window/coupang-renewal/lazy-coupang-renewal-driver.ts",
  },
  {
    label: "NAVER import",
    iface: "../../src/action-window/initial-import/import-driver.ts",
    ifaceName: "ImportProbeDriver",
    lazy: "../../src/action-window/initial-import/lazy-import-driver.ts",
  },
  {
    label: "Coupang review locate",
    iface: "../../src/action-window/coupang-review/review-locate-driver.ts",
    ifaceName: "ReviewLocateProbeDriver",
    lazy: "../../src/action-window/coupang-review/lazy-review-locate-driver.ts",
  },
];

describe("lazy probe drivers forward EVERY method of the interface they stand in for", () => {
  it.each(CASES)("$label", ({ iface, ifaceName, lazy }) => {
    const methods = interfaceMethods(read(iface), ifaceName);
    expect(methods.length, "the interface parsed to at least one method").toBeGreaterThan(0);
    const wrapper = read(lazy);
    const missing = methods.filter((m) => !new RegExp(`\\b(?:async\\s+)?${m}\\s*[(<]`).test(wrapper));
    // Named, not counted: the failure message has to say WHICH method the product quietly lost.
    expect(missing, `not forwarded by the lazy wrapper: ${missing.join(", ")}`).toEqual([]);
  });
});
