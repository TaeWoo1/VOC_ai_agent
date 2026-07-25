/**
 * DOM-protocol step 2: test the modeled shape offline, so the only question a live run has to answer is
 * whether the model was right — not whether the code works.
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import {
  IMPORT_DOM_QUESTION_KEYS,
  dateInputTags,
  importDomQuestionsFor,
  importLocateDiagnostic,
  importDomQuestionsFor as questionsFor,
  inferRequiresApply,
  locateApplyDecision,
  locateDateDecision,
} from "../../src/naver/import-locate";

const RANGE = `
  <div class="search-area">
    <input type="text" class="date-input" value="2026.01.01." />
    <input type="text" class="date-input" value="2026.01.31." />
    <button type="button" class="btn-search">조회</button>
  </div>`;

describe("date control locate", () => {
  it("resolves start and end from exactly two date inputs, in document order", () => {
    expect(locateDateDecision(RANGE, "start")).toEqual({ count: 1, index: 0 });
    expect(locateDateDecision(RANGE, "end")).toEqual({ count: 1, index: 1 });
  });

  it("recognises a native date input as well as a class-marked one", () => {
    const html = `<input type="date" /><input type="date" />`;
    expect(locateDateDecision(html, "start")).toEqual({ count: 1, index: 0 });
  });

  it("uses the same predicate the live scope read-back uses", () => {
    // Divergence between locate and read-back is the bug class this guards: the runtime would highlight
    // one control and validate another.
    const source = readFileSync(
      join(__dirname, "../../src/action-window/naver-live-driver.ts"),
      "utf8",
    );
    for (const marker of ['type="date"', "date", "calendar", "picker"]) {
      expect(source).toContain(marker);
    }
    expect(dateInputTags(`<input class="calendar-field" /><input class="picker" />`)).toHaveLength(2);
  });

  /** Fewer than two means the surface is not what we modeled. */
  it("fails closed when there is only one date input", () => {
    expect(locateDateDecision(`<input type="date" />`, "start")).toEqual({ count: 1 });
    expect(locateDateDecision(`<input type="date" />`, "end")).toEqual({ count: 1 });
  });

  it("reports zero when there is no date input at all", () => {
    expect(locateDateDecision(`<div>없음</div>`, "start")).toEqual({ count: 0 });
  });

  /** Three means we cannot tell which pair is the range, and taking the first two would be a guess. */
  it("fails closed on more than two date inputs rather than taking the first pair", () => {
    const html = `<input type="date" /><input type="date" /><input type="date" />`;
    expect(locateDateDecision(html, "start")).toEqual({ count: 3 });
  });

  it("ignores inputs the seller cannot act on", () => {
    const html = `
      <input type="date" />
      <input type="date" />
      <input type="hidden" class="date-template" />
      <input type="date" disabled />
      <input type="date" readonly />
      <input type="date" style="display:none" />`;
    // Only the two real controls count, so an off-screen template cannot make the match ambiguous.
    expect(locateDateDecision(html, "end")).toEqual({ count: 1, index: 1 });
  });
});

describe("apply control locate", () => {
  it("resolves a single apply-worded control", () => {
    expect(locateApplyDecision(RANGE)).toEqual({ count: 1, index: 0 });
    expect(inferRequiresApply(RANGE)).toBe(true);
  });

  it("recognises the wording variants and nothing beyond them", () => {
    for (const word of ["조회", "검색", "적용", "Search"]) {
      expect(locateApplyDecision(`<button>${word}</button>`).count).toBe(1);
    }
    // A generic verb is not apply wording — widening it is how a locate starts matching unrelated buttons.
    for (const word of ["확인", "저장", "닫기", "다운로드"]) {
      expect(locateApplyDecision(`<button>${word}</button>`).count).toBe(0);
    }
  });

  it("reports no apply control when the surface has none", () => {
    const html = `<input type="date" /><input type="date" />`;
    expect(locateApplyDecision(html)).toEqual({ count: 0 });
    expect(inferRequiresApply(html)).toBe(false);
  });

  /** Two 조회 buttons is a surface we do not understand yet; the honest response is to stop. */
  it("fails closed on two apply candidates rather than taking the first", () => {
    const html = `<button>조회</button><button>조회</button>`;
    expect(locateApplyDecision(html)).toEqual({ count: 2 });
    expect(inferRequiresApply(html)).toBe(false);
  });

  it("does not treat prose as a control", () => {
    expect(locateApplyDecision(`<p>기간을 선택한 뒤 조회해 주세요</p>`)).toEqual({ count: 0 });
  });

  it("ignores a disabled apply control", () => {
    expect(locateApplyDecision(`<button disabled>조회</button>`)).toEqual({ count: 0 });
  });
});

describe("sanitized diagnostics", () => {
  it("reports counts and booleans only", () => {
    const diagnostic = importLocateDiagnostic(RANGE);
    expect(diagnostic).toEqual({
      dateInputCount: 2,
      applyWordingPresent: true,
      applyCandidateCount: 1,
      iframePresent: false,
    });
    for (const value of Object.values(diagnostic)) {
      expect(["number", "boolean"]).toContain(typeof value);
    }
  });

  it("notes an iframe's presence without naming a host", () => {
    const diagnostic = importLocateDiagnostic(`<iframe src="https://example.test/a/b?c=d"></iframe>`);
    expect(diagnostic.iframePresent).toBe(true);
    expect(JSON.stringify(diagnostic)).not.toContain("example.test");
    expect(JSON.stringify(diagnostic)).not.toContain("?c=d");
  });

  it("never carries a value, a class name, or page text", () => {
    const leaky = `<input class="secret-date-cls" value="2026.01.01." /><input class="secret-date-cls" value="2026.01.31." />`;
    const serialized = JSON.stringify(importLocateDiagnostic(leaky));
    expect(serialized).not.toContain("secret-date-cls");
    expect(serialized).not.toContain("2026.01.01");
  });
});

describe("the DOM questions asked when the model is wrong", () => {
  it("asks nothing when everything resolved", () => {
    expect(importDomQuestionsFor(importLocateDiagnostic(RANGE))).toEqual([]);
  });

  it("asks about the date controls when they did not resolve", () => {
    const questions = questionsFor(importLocateDiagnostic(`<button>조회</button>`));
    expect(questions).toContain("dom.question.dateInput.tagName");
    expect(questions).toContain("dom.question.dateInput.startAndEndAreSiblings");
    // The apply control resolved, so it is not asked about.
    expect(questions.some((q) => q.startsWith("dom.question.applyControl"))).toBe(false);
  });

  it("asks about the apply control when it did not resolve", () => {
    const questions = questionsFor(importLocateDiagnostic(`<input type="date" /><input type="date" />`));
    expect(questions).toContain("dom.question.applyControl.exists");
    expect(questions.some((q) => q.startsWith("dom.question.dateInput"))).toBe(false);
  });

  /**
   * The safety property of the whole protocol: the questions may ask about STRUCTURE and never about
   * content. A question key that drifted toward review text or an identifier would turn a debugging aid
   * into a data request.
   *
   * Asserted as a WHITELIST, not a forbidden-substring scan. A scan is both too weak and too strong:
   * `tagName` and `nonSensitiveClassNames` are exactly the structural questions the protocol permits, yet
   * both contain "name". Enumerating what may be asked cannot drift — adding a question means adding it
   * here deliberately.
   */
  it("asks only the structural questions the protocol permits", () => {
    const permitted = new Set([
      // "element tag", "role and type", "relevant non-sensitive class names"
      "tagName",
      "typeAttribute",
      "roleAttribute",
      "nonSensitiveClassNames",
      // "whether it is inside an iframe"
      "insideIframe",
      // "parent container structure", "whether related buttons are siblings"
      "parentContainerStructure",
      "startAndEndAreSiblings",
      "siblingOfDateInputs",
      // "date input or calendar structure"
      "calendarWidgetOrPlainInput",
      // presence, not content
      "exists",
    ]);
    for (const key of IMPORT_DOM_QUESTION_KEYS) {
      const leaf = key.split(".").pop()!;
      expect(permitted.has(leaf), `${key} is not a permitted structural question`).toBe(true);
    }
  });

  /** And the things that must never be askable stay absent from the whitelist itself. */
  it("has no question that would request content, identity, or a URL", () => {
    const leaves = IMPORT_DOM_QUESTION_KEYS.map((k) => k.split(".").pop()!.toLowerCase());
    for (const banned of ["reviewtext", "body", "customer", "buyer", "href", "url", "cookie", "token", "outerhtml", "innerhtml", "inputvalue", "screenshot"]) {
      expect(leaves, banned).not.toContain(banned);
    }
  });

  it("asks only about things an operator can answer by looking at structure", () => {
    expect(IMPORT_DOM_QUESTION_KEYS.length).toBeGreaterThan(0);
    for (const key of IMPORT_DOM_QUESTION_KEYS) {
      expect(key).toMatch(/^dom\.question\.(dateInput|applyControl)\.[A-Za-z]+$/);
    }
  });
});

describe("module purity", () => {
  it("reaches no DOM, no clock, and no I/O", () => {
    const source = readFileSync(join(__dirname, "../../src/naver/import-locate.ts"), "utf8");
    const code = source
      .split("\n")
      .filter((line) => !line.trim().startsWith("*") && !line.trim().startsWith("//") && !line.trim().startsWith("/*"))
      .join("\n");
    for (const token of ["import ", "require(", "Date.", "new Date", "process."]) {
      expect(code, token).not.toContain(token);
    }
  });
});
