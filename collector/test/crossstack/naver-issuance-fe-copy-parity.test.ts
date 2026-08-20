/**
 * **The frontend's NAVER-issuance step copy is PINNED to the runtime's API-centre panel copy** — the same
 * relationship the Coupang walk has, now that this walk has a panel too.
 *
 * It was not a duplication problem before: the FE was the ONLY place these strings were rendered, because the
 * NAVER walk showed its step prose in the SellerOps tab and nothing on the marketplace window. Moving the
 * guidance onto the window the seller works in created a second copy of every step — and these strings carry
 * claims the seller acts on ("SellerOps는 시크릿 값도, 클립보드도 읽지 않습니다", "스토어당 1개만 가능하고
 * 삭제할 수 없습니다"). Two places wording one step is how one of them quietly loses a clause.
 *
 * So the panel's copy IS the FE's copy, character for character, and this asserts it. Direction of the read:
 * the runtime constants are IMPORTED (real values), the FE file is PARSED (the collector package does not
 * compile the frontend). The parser is proved non-vacuous — it must find every key, and a planted mismatch
 * must fail.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { dirname, resolve } from "node:path";
import { fileURLToPath } from "node:url";
import { NAVER_STEP_DETAIL, NAVER_STEP_TITLE, NAVER_APP_USAGE_COPY } from "../../src/action-window/naver-issuance-driver";
import type { IssuanceTarget } from "../../src/action-window/api-issuance/issuance-driver";

const HERE = dirname(fileURLToPath(import.meta.url));
const FE_COPY = resolve(HERE, "../../../frontend/src/lib/actionWindow/copy.ts");

/** Which FE copy key carries which runtime target's step. */
const KEY_FOR_TARGET: Readonly<Record<IssuanceTarget, string>> = {
  create_app: "actionWindow.issuance.createApp",
  open_app: "actionWindow.issuance.openApp",
  api_group: "actionWindow.issuance.apiGroup",
  application_id: "actionWindow.issuance.applicationId",
  application_secret: "actionWindow.issuance.applicationSecret",
  return: "actionWindow.issuance.return",
};

/**
 * One of the two maps in that file. The SAME copy keys appear twice — once in `COPY` as a short label, once in
 * `ISSUANCE_STEP_DETAIL` as the full instruction — so a search has to say which it means, or it pins the wrong
 * string. The panel uses BOTH: the short one on its chip, the full one behind its disclosure.
 */
function block(src: string, name: string): string {
  const from = src.indexOf(`const ${name}`);
  expect(from, `${name} not found in the FE copy module`).toBeGreaterThan(-1);
  const to = src.indexOf("\n};", from);
  expect(to, `${name} is not closed`).toBeGreaterThan(from);
  return src.slice(from, to);
}

/** Read one `"key": "value",` entry. Narrow on purpose: anything else returns null and the assertion fails. */
function feCopyValue(src: string, key: string): string | null {
  const at = src.indexOf(`"${key}":`);
  if (at < 0) return null;
  const rest = src.slice(at + key.length + 3);
  const m = /^\s*"((?:[^"\\]|\\.)*)"\s*,/.exec(rest);
  if (!m?.[1]) return null;
  return JSON.parse(`"${m[1]}"`) as string;
}

describe("NAVER issuance step copy — the FE and the API-centre panel say the SAME thing", () => {
  const raw = readFileSync(FE_COPY, "utf8");
  const detail = block(raw, "ISSUANCE_STEP_DETAIL");
  const short = block(raw, "COPY");

  it("the parser finds every mapped key (it cannot pass by finding nothing)", () => {
    for (const key of Object.values(KEY_FOR_TARGET)) {
      expect(feCopyValue(detail, key), key).toBeTruthy();
      expect(feCopyValue(short, key), key).toBeTruthy();
    }
  });

  it("a planted mismatch is caught (the comparison is real)", () => {
    const planted = detail.replace(NAVER_STEP_DETAIL.application_secret, "시크릿을 복사하세요.");
    expect(planted).not.toBe(detail);
    expect(feCopyValue(planted, KEY_FOR_TARGET.application_secret)).not.toBe(NAVER_STEP_DETAIL.application_secret);
  });

  it.each(Object.entries(KEY_FOR_TARGET))("%s — the panel's full copy is verbatim", (target, key) => {
    expect(feCopyValue(detail, key)).toBe(NAVER_STEP_DETAIL[target as IssuanceTarget]);
  });

  it.each(Object.entries(KEY_FOR_TARGET))("%s — the panel's chip is the FE's short label", (target, key) => {
    expect(feCopyValue(short, key)).toBe(NAVER_STEP_TITLE[target as IssuanceTarget]);
  });

  it("**step 3's advisory is pinned too** — the step with no control still carries its safety claim", () => {
    // "버튼이 보이지 않더라도 SellerOps가 활성 상태라고 단정하지 않습니다" is the claim this step exists for, and
    // it is the step most likely to be reworded by whoever is not thinking about it.
    expect(feCopyValue(detail, "actionWindow.issuance.appUsageCheck")).toBe(NAVER_APP_USAGE_COPY.existing.detail);
    expect(feCopyValue(detail, "actionWindow.issuance.appUsageCheckNew")).toBe(NAVER_APP_USAGE_COPY.new.detail);
    expect(feCopyValue(short, "actionWindow.issuance.appUsageCheck")).toBe(NAVER_APP_USAGE_COPY.existing.badge);
    expect(feCopyValue(short, "actionWindow.issuance.appUsageCheckNew")).toBe(NAVER_APP_USAGE_COPY.new.badge);
  });

  it("no step is left unmapped — a new step must be given FE copy, not silently omitted", () => {
    expect(Object.keys(KEY_FOR_TARGET).sort()).toEqual(Object.keys(NAVER_STEP_DETAIL).sort());
  });
});
