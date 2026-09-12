/**
 * **Every sender stamps the version of the engine it is actually talking to.**
 *
 * The Action Window contract has two live versions at once, and that is deliberate: the generic lane's
 * endpoint (`collector/src/bridge/action-window-endpoint.ts`) speaks v1, while acquisition, locate, reply,
 * import and issuance each have their own v2 endpoint. `isActionWindowProtocolCompatible` is EXACT EQUALITY,
 * so a sender paired with the wrong constant is not degraded — it is refused `INVALID_ENVELOPE`, and the lane
 * can never start at all.
 *
 * That is not hypothetical. `acquireRuntime` took the constant from `./contract` — which re-exports **v1** —
 * and every Coupang WING read a seller could press was refused by the engine before it reached the browser,
 * while the unit tests stayed green because they asserted the envelope against fakes (measured live
 * 2026-09-12). `acquireRuntime.envelope.test.ts` now proves that one lane's envelope against the real v2
 * validator; this test is the class-wide fence, because the next lane to be written can make the identical
 * mistake and no behavioural test it does not have will notice.
 *
 * It reads the source rather than the runtime on purpose: what went wrong was an IMPORT, and an import is a
 * fact about the text. The pairing below is checked against the collector endpoints by name in the comment,
 * and a sender that appears without being listed fails — declaring which engine it speaks to is the point.
 */
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";

const HERE = resolve(fileURLToPath(import.meta.url), "..");
const AW = HERE;

/**
 * The declared pairing: sender → the contract version its receiving endpoint validates with.
 *
 *  - `bridgeAdapter.ts` → `collector/src/bridge/action-window-endpoint.ts` (v1/transport)
 *  - every other sender → its own v2 endpoint (`review-acquisition-`, `review-locate-`,
 *    `reply-submission-`, `initial-import-`, `api-issuance-endpoint.ts`)
 */
const DECLARED: Readonly<Record<string, 1 | 2>> = Object.freeze({
  "bridgeAdapter.ts": 1,
  "acquire/acquireRuntime.ts": 2,
  "locate/locateRuntime.ts": 2,
  "reply/replyRuntime.ts": 2,
  "import/importRuntime.ts": 2,
  "issuance/issuanceRuntime.ts": 2,
});

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const name of readdirSync(dir)) {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
      continue;
    }
    if (name.endsWith(".ts") && !name.includes(".test.")) out.push(full);
  }
  return out;
}

/** Files that put a `protocolVersion` on an outgoing command envelope. */
function senders(): string[] {
  return sourceFiles(AW)
    .filter((f) => /protocolVersion:\s*ACTION_WINDOW_PROTOCOL_VERSION/.test(readFileSync(f, "utf8")))
    .map((f) => relative(AW, f))
    .sort();
}

/** Which contract version a file's `ACTION_WINDOW_PROTOCOL_VERSION` import resolves to. */
function versionImportedBy(file: string): 1 | 2 | null {
  const text = readFileSync(join(AW, file), "utf8");
  const clause = text.match(/import\s*{[^}]*\bACTION_WINDOW_PROTOCOL_VERSION\b[^}]*}\s*from\s*"([^"]+)"/s);
  if (!clause) return null;
  const from = clause[1]!;
  if (from.includes("action-window/v2/")) return 2;
  if (from.includes("action-window/v1/")) return 1;
  // The local bridge re-exports one version and one only; resolve it rather than trusting its name.
  if (/(^|\/)(\.\.\/)*contract$/.test(from)) {
    const bridge = readFileSync(join(AW, "contract.ts"), "utf8");
    if (/action-window\/v2\/index/.test(bridge)) return 2;
    if (/action-window\/v1\/index/.test(bridge)) return 1;
  }
  return null;
}

describe("Action Window senders — the stamped version is the receiving engine's", () => {
  it("every sender is declared, and every declared sender exists", () => {
    expect(senders()).toEqual(Object.keys(DECLARED).sort());
  });

  it("each sender imports the constant from the contract version it declares", () => {
    for (const [file, version] of Object.entries(DECLARED)) {
      expect(versionImportedBy(file), `${file} must stamp v${version}`).toBe(version);
    }
  });

  it("the shared bridge is v1, so taking the constant from it is only correct for the v1 lane", () => {
    const bridge = readFileSync(join(AW, "contract.ts"), "utf8");
    expect(bridge).toMatch(/action-window\/v1\/index/);
    const fromBridge = Object.entries(DECLARED).filter(([f]) => versionImportedBy(f) === 1);
    expect(fromBridge.map(([f]) => f)).toEqual(["bridgeAdapter.ts"]);
  });
});
