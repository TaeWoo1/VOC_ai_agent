/**
 * The in-page discovery ladder and the in-page fingerprint port, checked as SOURCE. These modules export
 * browser JS as strings, so the properties that keep the live run safe are properties of that text: it must
 * be ASCII-only, it must not contain any way to act on the page, and its only mutation must be the outline.
 *
 * The behavioural proof (that the ladder actually finds an id in a real DOM, and that the in-page digest
 * equals the Node digest) is the browser rung, `review-id-browser.test.ts`.
 */
import { describe, it, expect } from "vitest";
import {
  ID_MATCH_MARKER_ATTRIBUTE,
  IN_PAGE_ID_HELPERS,
  IN_PAGE_ID_OUTLINE_TEARDOWN,
  MAX_CANDIDATE_ROWS,
  MAX_TOKENS_PER_RUNG,
  inPageOutlineRowAt,
  inPageReviewIdLadder,
} from "../../../src/action-window/reply-submission/review-id-probe-inpage";
import { IN_PAGE_REVIEW_ID_FINGERPRINT_FN } from "../../../src/action-window/reply-submission/review-id-fingerprint-inpage";
import { IN_PAGE_ROW_HELPERS } from "../../../src/action-window/reply-submission/reply-row-inpage";
import {
  ALNUM_TOKEN,
  DIGIT_TOKEN,
} from "../../../src/action-window/reply-submission/review-id-network-scan";

const AS_OF = { year: 2026, month: 7, day: 20 };
const FP = "a".repeat(64);
const ALL_SOURCES = [
  IN_PAGE_REVIEW_ID_FINGERPRINT_FN,
  IN_PAGE_ID_HELPERS,
  inPageReviewIdLadder(AS_OF),
  inPageOutlineRowAt(3, FP),
  IN_PAGE_ID_OUTLINE_TEARDOWN,
];

/**
 * The composite sources embed the pre-existing {@link IN_PAGE_ROW_HELPERS}, which deliberately carries literal
 * Korean replacement tokens ("[링크]", "오늘", …) as part of `review-body-fingerprint/v1`. That is the other
 * contract's business; this one only owns what it adds on top, so the ASCII check is applied to the delta.
 */
function ownContribution(source: string): string {
  return source.split(IN_PAGE_ROW_HELPERS).join("");
}

describe("in-page sources are ASCII-only", () => {
  it("nothing this module contributes carries a literal exotic character transport could mangle", () => {
    for (const source of ALL_SOURCES) {
      const exotic = [...ownContribution(source)].filter((c) => {
        const cp = c.codePointAt(0)!;
        return cp !== 0x0a && (cp < 0x20 || cp > 0x7e);
      });
      expect(exotic).toEqual([]);
    }
  });

  it("the inherited body-fingerprint helpers are the ONLY source of non-ASCII, and they are unmodified", () => {
    expect(IN_PAGE_ID_HELPERS).toContain(IN_PAGE_ROW_HELPERS);
    expect(ownContribution(IN_PAGE_ID_HELPERS).length).toBeLessThan(IN_PAGE_ID_HELPERS.length);
  });

  it("the exotic whitespace class is written as escapes, not characters", () => {
    expect(IN_PAGE_REVIEW_ID_FINGERPRINT_FN).toContain("\\u3000");
    expect(IN_PAGE_REVIEW_ID_FINGERPRINT_FN).toContain("\\u200b");
    expect(IN_PAGE_REVIEW_ID_FINGERPRINT_FN).toContain("\\u0000-\\u001f");
  });
});

describe("the ladder can only READ — it has no way to act on the page", () => {
  // The row/outline helpers legitimately set a style and an attribute; nothing may ACT.
  const FORBIDDEN = [
    ".click(",
    ".focus(",
    ".type(",
    ".fill(",
    ".press(",
    ".check(",
    ".submit(",
    ".selectOption(",
    "dispatchEvent",
    "addEventListener",
    "location.href",
    "location.assign",
    "location.replace",
    "window.open",
    "fetch(",
    "XMLHttpRequest",
    "navigator.sendBeacon",
    "document.write",
  ];

  for (const token of FORBIDDEN) {
    it(`no in-page source contains '${token}'`, () => {
      for (const source of ALL_SOURCES) {
        expect(source).not.toContain(token);
      }
    });
  }

  it("the only value assignment is the outline, and the only attribute written is the marker", () => {
    const outline = inPageOutlineRowAt(0, FP);
    expect(outline).toContain("style.outline");
    expect(outline).toContain(`setAttribute('${ID_MATCH_MARKER_ATTRIBUTE}'`);
    // No input value is ever written anywhere in the module.
    for (const source of ALL_SOURCES) {
      expect(source).not.toContain(".value =");
      expect(source).not.toContain(".value=");
      expect(source).not.toContain("innerHTML");
    }
  });

  it("the teardown removes exactly what the outline added", () => {
    expect(IN_PAGE_ID_OUTLINE_TEARDOWN).toContain(`removeAttribute('${ID_MATCH_MARKER_ATTRIBUTE}')`);
    expect(IN_PAGE_ID_OUTLINE_TEARDOWN).toContain("style.outline = ''");
  });

  it("the marker attribute is excluded from the attribute rung, so the probe cannot match its own mark", () => {
    expect(IN_PAGE_ID_HELPERS).toContain(`if (name === '${ID_MATCH_MARKER_ATTRIBUTE}') { continue; }`);
  });
});

describe("the ladder is bounded and emits digests only", () => {
  it("every cap is present in the emitted source", () => {
    expect(IN_PAGE_ID_HELPERS).toContain(String(MAX_CANDIDATE_ROWS));
    expect(IN_PAGE_ID_HELPERS).toContain(String(MAX_TOKENS_PER_RUNG));
  });

  it("token shapes match the Node-side network rung, so the two rungs cannot disagree", () => {
    expect(IN_PAGE_ID_HELPERS).toContain("/[0-9]{6,20}/g");
    expect(IN_PAGE_ID_HELPERS).toContain("/[A-Za-z0-9][A-Za-z0-9_-]{7,39}/g");
    expect(DIGIT_TOKEN.source).toBe("[0-9]{6,20}");
    expect(ALNUM_TOKEN.source).toBe("[A-Za-z0-9][A-Za-z0-9_-]{7,39}");
  });

  it("the ladder returns fingerprints, counts and coarse enums — it never returns a token", () => {
    const source = inPageReviewIdLadder(AS_OF);
    expect(source).toContain("__awFingerprintAll");
    expect(source).toContain("idFingerprints");
    expect(source).not.toContain("tokens: ");
    expect(source).not.toContain("textContent }");
  });

  it("the as-of date is interpolated as plain integers, never as text from the page", () => {
    const source = inPageReviewIdLadder({ year: 2026, month: 2, day: 1 });
    expect(source).toContain("__awParseBucket(row, 2026, 2, 1)");
  });

  it("the row index is truncated to an integer, so nothing arbitrary reaches the emitted source", () => {
    expect(inPageOutlineRowAt(3.9, FP)).toContain("rows[3]");
    expect(inPageOutlineRowAt(-0.5, FP)).toContain("rows[0]");
  });

  it("the ladder reports its truncation flags, so a miss can never be read as a proven absence", () => {
    const source = inPageReviewIdLadder(AS_OF);
    expect(source).toContain("rowsTruncated");
    expect(source).toContain("tokensTruncated");
    expect(IN_PAGE_ID_HELPERS).toContain("__awIdRowsTruncated = ");
    expect(IN_PAGE_ID_HELPERS).toContain("__awIdTokensTruncated = true");
  });

  it("the rating is read via the ambiguity-safe helper, not the calibrated-path parser", () => {
    // Passing a whole row to the path parser would read "별점 1점" out of the review BODY.
    expect(inPageReviewIdLadder(AS_OF)).toContain("__awUniqueRowRating(row)");
    expect(inPageReviewIdLadder(AS_OF)).not.toContain("__awParseRating(row)");
  });

  it("a malformed percent-escape cannot abort the ladder — every decode is guarded", () => {
    expect(IN_PAGE_ID_HELPERS).toContain("function __awDecode(s)");
    expect(IN_PAGE_ID_HELPERS).toContain("try { return decodeURIComponent(s); } catch (e) { return s; }");
    // No unguarded call survives.
    expect(IN_PAGE_ID_HELPERS.split("decodeURIComponent(").length - 1).toBe(1);
  });
});

describe("the outline re-verifies identity before it mutates anything", () => {
  it("embeds the target fingerprint and refuses to outline a row that no longer carries it", () => {
    const source = inPageOutlineRowAt(2, FP);
    expect(source).toContain(FP);
    expect(source).toContain("'row-changed'");
    expect(source).toContain("'absent'");
    expect(source).toContain("'outlined'");
    // The mutation happens only after the re-check.
    expect(source.indexOf("if (!still) { return 'row-changed'; }")).toBeLessThan(source.indexOf("style.outline"));
  });

  it("a non-digest fingerprint is reduced to the empty string, which can never match a real row", () => {
    const source = inPageOutlineRowAt(0, "'); window.__pwned = 1; ('");
    expect(source).not.toContain("__pwned");
    expect(source).toContain("var target = '';");
  });
});
