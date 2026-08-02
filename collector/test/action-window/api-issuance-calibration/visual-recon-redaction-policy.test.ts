/**
 * The NARROWED redaction policy + the proposed selector candidates.
 *
 *  - `isIdentityTextToRedact` covers ONLY account handle / IP / long credential-token / "<handle> 님"; a public
 *    store name and a general (Korean-prose) app description stay visible.
 *  - the in-page redaction script builds its identity regexes from the SAME shared sources (no drift), gates
 *    coverage to the viewport (so an off-screen element can no longer trip the NO_OVERLAY backstop = the
 *    api_group HALT), and no longer blanket-covers the header/footer chrome.
 *  - every proposed candidate is NON-adoptable offline (matchCount unmeasured) and uses only fixed NAVER labels.
 */
import { describe, it, expect } from "vitest";
import {
  IDENTITY_REDACT_PATTERN_SOURCES,
  isIdentityTextToRedact,
} from "../../../src/action-window/api-issuance-calibration/visual-recon";
import { buildRedactionScript } from "../../../src/action-window/api-issuance-calibration/visual-recon-inpage";
import {
  evaluateVisualReconCandidates,
  MATCH_COUNT_UNMEASURED,
  VISUAL_RECON_CANDIDATES,
} from "../../../src/action-window/api-issuance-calibration/visual-recon-candidates";
import { evaluateSelectorCandidate } from "../../../src/action-window/api-issuance-calibration/visual-recon";

describe("identity_text redaction policy — cover account/IP/credential, allow public store name + description", () => {
  // Sanitized stand-ins shaped like the real leaks the live recon surfaced (no real account/store values).
  const MUST_REDACT = [
    "abcde1234", // login-id-like handle (letters then ≥2 digits)
    "abcde1234 님", // the logged-in account rendered "<handle> 님"
    "seller 님", // a digit-less handle still caught by the 님 honorific
    "홍길동 님", // a Korean-name account greeting (Hangul before 님)
    "홍길동님", // …with the honorific attached (no space)
    "211.222.138.6", // an API-call IP
    "192.168.0.25",
    "ops@example.com", // email
    "AbCd1234EfGh56xy", // a long credential/token (12+ chars incl. a digit)
    "100200300", // a long numeric id (≥6 digits)
  ];
  const MUST_STAY_VISIBLE = [
    "나누리샵", // PUBLIC store display name (Hangul → no ASCII identifier)
    "나누리샵의 api를 통한 데이터 수집용", // general app description
    "데이터수집", // an application display name (Hangul)
    "애플리케이션 등록", // fixed UI label
    "애플리케이션 ID",
    "애플리케이션 시크릿",
    "API 그룹",
    "커머스API센터",
    "일시중단",
    "2026-07-29", // a date (no 6-digit run, no leading letter)
    "2027-01-18~2027-01-31",
    "인증 기간 시작 169일 전",
    "nanu******", // an already NAVER-masked id (asterisks are not digits)
    "13:35",
  ];

  for (const t of MUST_REDACT) {
    it(`redacts: ${JSON.stringify(t)}`, () => expect(isIdentityTextToRedact(t)).toBe(true));
  }
  for (const t of MUST_STAY_VISIBLE) {
    it(`leaves visible: ${JSON.stringify(t)}`, () => expect(isIdentityTextToRedact(t)).toBe(false));
  }

  it("empty / oversized text is never redacted (nothing to cover)", () => {
    expect(isIdentityTextToRedact("")).toBe(false);
    expect(isIdentityTextToRedact("x".repeat(4001))).toBe(false);
  });

  it("every shared pattern source is a valid RegExp (no drift into a malformed source)", () => {
    expect(IDENTITY_REDACT_PATTERN_SOURCES.length).toBeGreaterThan(0);
    for (const src of IDENTITY_REDACT_PATTERN_SOURCES) {
      expect(() => new RegExp(src)).not.toThrow();
    }
  });
});

describe("in-page redaction script — shares the policy, gates to the viewport, drops blanket chrome cover", () => {
  const apply = buildRedactionScript("apply");
  const verify = buildRedactionScript("verify");

  it("builds its identity regexes from the SAME shared sources (single source of truth, no drift)", () => {
    const embedded = JSON.stringify(IDENTITY_REDACT_PATTERN_SOURCES);
    expect(apply.includes(embedded)).toBe(true);
    expect(verify.includes(embedded)).toBe(true);
    expect(apply).toContain("new RegExp(IDSRC");
  });

  it("gates coverage to the viewport (on the element's OWN box) so an off-screen element can't trip the NO_OVERLAY backstop", () => {
    // The skip is keyed on the element's OWN real box (not an ancestor), so a zero-area overflowing leaf is kept.
    expect(apply).toContain("ownR.top >= VH");
    expect(apply).toContain("ownR.bottom <= 0");
    expect(apply).toContain("ownR.width > 0 && ownR.height > 0");
  });

  it("no longer blanket-covers the header/footer chrome", () => {
    expect(apply.includes("[role='banner']")).toBe(false);
    expect(apply.includes("[role='contentinfo']")).toBe(false);
  });

  it("a box-less element that renders NOTHING (display:none / zero client rects, not display:contents) is covered, not a HALT", () => {
    // Stops a not-rendered node (e.g. a collapsed header account menu still in the DOM) from forcing a
    // fail-closed HALT for text that never appears in the viewport-only screenshot …
    expect(apply).toContain("cs.display === 'none'");
    expect(apply).toContain("getClientRects().length === 0");
    // … but display:contents (children DO paint) is excluded from the zero-client-rects path.
    expect(apply).toContain("cs.display === 'contents'");
    expect(apply).toContain("isContents");
    expect(apply).toContain("paintsNothing");
    // the not-rendered relaxation keys on display:none / paintsNothing — it does NOT relax on visibility:hidden.
    expect(apply).toContain("(cs && cs.display === 'none') || paintsNothing");
    // genuinely-rendered text we could not box still HALTs (the branch only relaxes for not-rendered nodes).
    expect(apply).toContain("UNCOVERED → HALT");
  });

  it("still draws opaque, hit-testable, max-z overlays (coverage proof unchanged)", () => {
    expect(apply).toContain("elementFromPoint");
    expect(apply).toContain("pointer-events:auto");
    expect(apply).toContain("z-index:2147483647");
    expect(apply).toContain("background:#111827");
  });
});

describe("proposed selector candidates — recorded, screenshot-derived, NOT adopted", () => {
  const evaluated = evaluateVisualReconCandidates();

  it("covers the requested targets and every one uses ONLY a fixed NAVER label", () => {
    const ids = VISUAL_RECON_CANDIDATES.map((c) => c.targetId);
    expect(ids).toContain("app_list.register_application");
    expect(ids).toContain("app_detail.application_section");
    expect(ids).toContain("api_group.section");
    expect(ids).toContain("credentials.application_id_label");
    expect(ids).toContain("credentials.secret_view_button");
    expect(ids).toContain("credentials.secret_copy_button");
    for (const p of VISUAL_RECON_CANDIDATES) {
      expect(p.candidate.usesFixedLabelTextOnly).toBe(true);
      expect(p.candidate.dependsOnAccountOrCredential).toBe(false);
      expect(p.candidate.positionOnly).toBe(false);
      // never embeds an application display name or a credential value
      expect(/데이터수집|secret|시크릿값|\[value=/i.test(p.candidate.selector.replace("애플리케이션 시크릿", ""))).toBe(false);
    }
  });

  it("NONE is adoptable offline — matchCount is unmeasured, so the gate refuses with NOT_UNIQUE", () => {
    for (const e of evaluated) {
      expect(e.candidate.matchCount).toBe(MATCH_COUNT_UNMEASURED);
      expect(e.adoptable).toBe(false);
      expect(e.reasons).toContain("NOT_UNIQUE");
    }
  });

  it("no candidate is rejected for a sensitive/position/account/non-fixed-label reason (only live matchCount is missing)", () => {
    for (const e of evaluated) {
      expect(e.reasons).not.toContain("SENSITIVE_SELECTOR");
      expect(e.reasons).not.toContain("POSITION_ONLY");
      expect(e.reasons).not.toContain("DEPENDS_ON_ACCOUNT_OR_CREDENTIAL");
      expect(e.reasons).not.toContain("TEXT_SELECTOR_NOT_FIXED_LABEL");
      expect(e.reasons).not.toContain("SCREENSHOT_TARGET_UNCONFIRMED");
    }
  });

  it("the frozen gate STILL protects the secret label: a credentials selector naming 시크릿 is CREDENTIAL_VALUE_TARGET", () => {
    const secret = evaluated.find((e) => e.targetId === "credentials.application_secret_label")!;
    expect(secret.reasons).toContain("CREDENTIAL_VALUE_TARGET");
    expect(secret.adoptable).toBe(false);
    // the ID label and the view/copy buttons are NOT falsely flagged as value targets
    for (const id of ["credentials.application_id_label", "credentials.secret_view_button", "credentials.secret_copy_button"] as const) {
      const e = evaluated.find((x) => x.targetId === id)!;
      expect(e.reasons).not.toContain("CREDENTIAL_VALUE_TARGET");
    }
  });

  it("a clean candidate WOULD become adoptable once a live run measures matchCount===1 (gate is the only thing pending)", () => {
    const register = VISUAL_RECON_CANDIDATES.find((c) => c.targetId === "app_list.register_application")!;
    const measured = { ...register.candidate, matchCount: 1 };
    expect(evaluateSelectorCandidate(measured).adoptable).toBe(true);
  });
});
