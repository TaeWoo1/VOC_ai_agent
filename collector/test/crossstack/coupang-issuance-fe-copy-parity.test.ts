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
import {
  COUPANG_ISSUANCE_KEY_CREATION_STEP,
  coupangIssuanceStepPlan,
} from "../../src/action-window/coupang-issuance/coupang-issuance-stages";
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

/* ─────────────── D2: the return URL and the reader that has to accept it ─────────────── */

/**
 * **The agent builds the return URL; the frontend decides what it means.** Two files, one string, and a
 * disagreement between them is silent: the seller lands on the connect page, the resume marker is not
 * recognized, and they are shown the start of a walk they have just finished — which is D2 itself, arriving a
 * second time through a typo.
 *
 * The frontend module is PARSED rather than imported, for the same reason as the copy above: the collector
 * package does not compile the frontend. What is executed here is the collector's real screening function.
 */
describe("the guided walk's return marker survives the trip to the frontend", () => {
  const FE_TUTORIAL = resolve(HERE, "../../../frontend/src/lib/coupangTutorial.ts");

  it("the URL the agent opens carries exactly the query the FE reader looks for", async () => {
    const { screenSellerOpsReturnUrl, SELLEROPS_ISSUANCE_RESUME_QUERY } = await import("../../src/cli/sellerops-return-url");
    const screened = screenSellerOpsReturnUrl("http://localhost:5173");
    expect(screened.ok).toBe(true);
    const url = new URL((screened as { url: string }).url);
    expect(url.pathname).toBe("/connect/coupang");
    // The marker, parsed back out of the built URL rather than re-stated: `key=value`, split on the `=`.
    const [key, value] = SELLEROPS_ISSUANCE_RESUME_QUERY.split("=");
    expect(url.searchParams.get(key!)).toBe(value);

    // …and the FE reader tests for that same pair. Parsed, so an edit on either side breaks this.
    const fe = readFileSync(FE_TUTORIAL, "utf8");
    const reader = fe.slice(fe.indexOf("export function isIssuanceResumeReturn"));
    expect(reader).toContain(`get("${key}") === "${value}"`);
  });

  it("the FE reader is where the FE says it is — a renamed export would pass the string check alone", () => {
    const fe = readFileSync(FE_TUTORIAL, "utf8");
    expect(fe).toContain("export function isIssuanceResumeReturn(search: string): boolean");
  });
});

/* ─────────── D3: the TEXT fallback checklist and the measured screen order ─────────── */

/**
 * **The guided walk was corrected by five live walks; the text fallback was not, because nothing held it.**
 *
 * `frontend/src/lib/guidedConnection/tutorial.ts` carries the checklist a seller lands on the moment guided
 * in-screen help is impossible (no local agent), or when they switch to text, or after they end the walk. It
 * is the SAME issuance, described twice — and until 2026-08-23 the second description was the pre-measurement
 * plan: 자체개발 third (a screen that has none), 업체명/URL/호출 IP before 발급 (fields that appear five screens
 * later), and 발급 named as the press that creates the key, with "copy your keys" straight after it.
 *
 * The copy pin above is what kept the Action Window honest. This is the same pin for the fallback: the
 * checklist must walk the runtime's measured screens IN THE RUNTIME'S ORDER. It deliberately checks order and
 * not wording — the fallback is a manual checklist and says more per step than a highlight panel can — so the
 * copy stays free to improve while the sequence cannot silently diverge again.
 */
describe("the text-fallback checklist walks the runtime's measured screen order", () => {
  const FE_TUTORIAL = resolve(HERE, "../../../frontend/src/lib/guidedConnection/tutorial.ts");

  /** The checklist's step ids, in order, read out of the FE source. */
  function checklistIds(src: string): string[] {
    const from = src.indexOf("export const COUPANG_ISSUANCE_TUTORIAL");
    expect(from, "COUPANG_ISSUANCE_TUTORIAL not found").toBeGreaterThan(-1);
    const to = src.indexOf("\n] as const;", from);
    expect(to, "COUPANG_ISSUANCE_TUTORIAL is not closed").toBeGreaterThan(from);
    return [...src.slice(from, to).matchAll(/id:\s*"([^"]+)"/g)].map((m) => m[1]!);
  }

  /**
   * Which checklist step stands on which runtime screen. The two bookends (`open_wing`,
   * `return_to_sellerops`) have no runtime step — the walk never leaves SellerOps to open a tab, and its
   * return is a button, not a checkbox — and `register_call_ip` splits the vendor screen's fields out of
   * `vendor_method` so the shared call-IP panel has somewhere to render.
   */
  const SCREEN_FOR_STEP: Readonly<Record<string, CoupangIssuanceTarget>> = {
    reach_open_api: "reach_open_api",
    reveal_form: "issue",
    confirm_purpose: "confirm_purpose",
    terms_consent: "terms_consent",
    terms_issue_button: "issue_final",
    vendor_method: "vendor_method",
    register_call_ip: "vendor_method",
    issue_checkpoint: "vendor_confirm",
    copy_keys: "credentials",
  };

  const ids = checklistIds(readFileSync(FE_TUTORIAL, "utf8"));

  it("the parser finds the checklist (it cannot pass by finding nothing)", () => {
    expect(ids.length).toBeGreaterThan(5);
    expect(ids[0]).toBe("open_wing");
  });

  it("every checklist step stands on a known runtime screen — a new step must be placed, not ignored", () => {
    const unplaced = ids.filter((id) => !(id in SCREEN_FOR_STEP) && id !== "open_wing" && id !== "return_to_sellerops");
    expect(unplaced, "checklist steps with no runtime screen").toEqual([]);
  });

  /**
   * The screen a runtime step stands on. Step 1 carries no highlighted control (it guides by text), so it has
   * no `copyParams.targetKind`; its stepId suffix names the screen instead. Reading both is what keeps step 1
   * inside the comparison rather than silently dropping out of it.
   */
  function screenOf(step: ReturnType<typeof coupangIssuanceStepPlan>[number]): CoupangIssuanceTarget {
    const named = step.copyParams?.targetKind as CoupangIssuanceTarget | undefined;
    return named ?? (step.stepId.replace(/^aw\.coupang_issuance_/, "") as CoupangIssuanceTarget);
  }

  /** Screen → the runtime step number that first reaches it. */
  const runtimeOrder = new Map<CoupangIssuanceTarget, number>();
  coupangIssuanceStepPlan().forEach((s) => {
    const t = screenOf(s);
    if (!runtimeOrder.has(t)) runtimeOrder.set(t, s.stepNumber);
  });

  it("covers every screen the runtime guides — none may be dropped from the manual path", () => {
    const covered = new Set(ids.map((id) => SCREEN_FOR_STEP[id]).filter(Boolean));
    for (const target of runtimeOrder.keys()) {
      expect(covered.has(target), `screen ${target} missing from the checklist`).toBe(true);
    }
  });

  it("visits those screens in the runtime's order (this is what 자체개발-third violated)", () => {
    const walked = ids
      .map((id) => SCREEN_FOR_STEP[id])
      .filter((t): t is CoupangIssuanceTarget => Boolean(t))
      .map((t) => {
        const n = runtimeOrder.get(t);
        expect(n, `screen ${t} is not in the runtime step plan`).toBeDefined();
        return n!;
      });
    expect(walked).toEqual([...walked].sort((a, b) => a - b));
  });

  it("the key-creating step sits where the runtime says the key is created, and copying follows it", () => {
    const keyScreen = screenOf(coupangIssuanceStepPlan()[COUPANG_ISSUANCE_KEY_CREATION_STEP - 1]!);
    const createIndex = ids.findIndex((id) => SCREEN_FOR_STEP[id] === keyScreen);
    expect(createIndex).toBeGreaterThan(-1);
    // Nothing before it may be described as producing a key…
    expect(ids.slice(0, createIndex).some((id) => SCREEN_FOR_STEP[id] === "credentials")).toBe(false);
    // …and reading the values comes after it, never before.
    expect(ids.indexOf("copy_keys")).toBeGreaterThan(createIndex);
  });
});
