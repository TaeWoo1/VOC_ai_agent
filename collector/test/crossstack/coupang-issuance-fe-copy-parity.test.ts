/**
 * **The frontend's Coupang-issuance step copy is PINNED to the runtime's WING-resident panel copy.**
 *
 * `frontend/src/lib/actionWindow/copy.ts` carries a block comment saying its five long instruction strings are
 * "VERBATIM from `OPERATOR_STEP_LABELS`" — reused rather than rewritten, because two places wording one step
 * differently is how the tutorial and the runtime drift apart.
 *
 * The comment was already false when it was written. `reachOpenApi`, `revealForm` and `return` were the
 * PRE-auto-advance strings: the SellerOps tab told the seller "화면이 열리면 **아래 버튼을 누르세요**" for a step
 * the runtime now advances by watching the screen, and named the WING home for a step that starts at login. A
 * seller reading the SellerOps tab was being told to press a button that had stopped being the mechanism.
 *
 * So this test replaces the comment's claim with an assertion. It is deliberately a CHARACTER-FOR-CHARACTER
 * comparison, not a similarity check: the whole value of reuse is that neither side can be edited alone.
 *
 * Direction of the read: the runtime constant is IMPORTED (a real value), the FE file is PARSED (the collector
 * package does not compile the frontend). The parser is proved non-vacuous below — it must find every key, and
 * a planted mismatch must fail.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { OPERATOR_STEP_LABELS } from "../../src/action-window/coupang-wing-issuance-driver";
import type { CoupangIssuanceTarget } from "../../src/action-window/coupang-issuance/coupang-issuance-driver";

const HERE = dirname(fileURLToPath(import.meta.url));
const FE_COPY = resolve(HERE, "../../../frontend/src/lib/actionWindow/copy.ts");

/**
 * Which FE copy key carries which runtime target's label. Not every target has one: `reach_open_api` …
 * `return` are the SEVEN steps, but the FE keys the four screens the seller works through plus the two
 * bookends, under the names `coupangIssuanceStepPlan()` gives them.
 */
const KEY_FOR_TARGET: Readonly<Partial<Record<CoupangIssuanceTarget, string>>> = {
  reach_open_api: "actionWindow.coupangIssuance.reachOpenApi",
  issue: "actionWindow.coupangIssuance.revealForm",
  confirm_purpose: "actionWindow.coupangIssuance.confirmPurpose",
  terms_consent: "actionWindow.coupangIssuance.termsConsent",
  issue_final: "actionWindow.coupangIssuance.issueCheckpoint",
  vendor_method: "actionWindow.coupangIssuance.vendorMethod",
  vendor_confirm: "actionWindow.coupangIssuance.vendorConfirm",
  credentials: "actionWindow.coupangIssuance.copyKeys",
};

/**
 * Just the `ISSUANCE_STEP_DETAIL` map.
 *
 * Scoped, because the SAME copy keys appear TWICE in that file: once in `COPY` as a short one-line step label
 * ("'API Key 발급 받기' 직접 누르기") and once here as the full instruction. Only the full instruction claims to be
 * verbatim; an unscoped search finds the short label first and would pin the wrong string.
 */
function detailBlock(src: string): string {
  const from = src.indexOf("const ISSUANCE_STEP_DETAIL");
  expect(from, "ISSUANCE_STEP_DETAIL not found in the FE copy module").toBeGreaterThan(-1);
  const to = src.indexOf("\n};", from);
  expect(to, "ISSUANCE_STEP_DETAIL is not closed").toBeGreaterThan(from);
  return src.slice(from, to);
}

/**
 * Read one `"key": "value",` entry out of the FE copy source. A deliberately narrow parser: the value must be a
 * single double-quoted literal on the line after its key, which is exactly how every entry in that file is
 * written. Anything else returns null and the assertion below fails loudly rather than silently passing.
 */
function feCopyValue(src: string, key: string): string | null {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return null;
  const rest = src.slice(at + key.length + 3);
  const m = /^\s*"((?:[^"\\]|\\.)*)"\s*,/.exec(rest);
  if (!m?.[1]) return null;
  return JSON.parse(`"${m[1]}"`) as string;
}

describe("Coupang issuance step copy — the FE and the WING-resident panel say the SAME thing", () => {
  const src = detailBlock(readFileSync(FE_COPY, "utf8"));

  it("the parser finds every mapped key (it cannot pass by finding nothing)", () => {
    for (const key of Object.values(KEY_FOR_TARGET)) {
      expect(feCopyValue(src, key), key).toBeTruthy();
    }
  });

  it("a planted mismatch is caught (the comparison is real)", () => {
    const planted = src.replace(
      OPERATOR_STEP_LABELS.credentials,
      "표시된 값을 복사하세요.",
    );
    expect(planted).not.toBe(src);
    expect(feCopyValue(planted, "actionWindow.coupangIssuance.copyKeys")).not.toBe(OPERATOR_STEP_LABELS.credentials);
  });

  it.each(Object.entries(KEY_FOR_TARGET))("%s is verbatim", (target, key) => {
    expect(feCopyValue(src, key)).toBe(OPERATOR_STEP_LABELS[target as CoupangIssuanceTarget]);
  });

  it("no step is left unmapped — a new step must be given FE copy, not silently omitted", () => {
    // `OPERATOR_STEP_LABELS` is keyed by every target. If a target is added and nobody adds its FE string, the
    // pin would quietly cover one fewer step; this is what stops that.
    expect(Object.keys(KEY_FOR_TARGET).sort()).toEqual(Object.keys(OPERATOR_STEP_LABELS).sort());
  });
});
