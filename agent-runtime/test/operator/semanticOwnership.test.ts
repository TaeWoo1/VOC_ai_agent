/**
 * <b>Who owns the MEANING of the seller's sentence — and the proof that only one layer reads it.</b>
 *
 * Agent Semantic Ownership v1. The contract is four owners, and the defect this file exists to catch is
 * a fifth reader appearing downstream of the first:
 *
 *   Planner   → what the seller's goal MEANS (the only thing that reads the sentence for meaning)
 *   WorldState→ what is true of this seller's shop
 *   Procedure → precondition / absence / next step
 *   Composer  → how it is said
 *
 * A census (`docs/agent_semantic_ownership_v1.md` §1) classified every post-planner read of the goal
 * text as A (a deterministic lane BEFORE the planner), B (a boundary, or a meaning the planner provably
 * does not carry) or C (a second judgement of something the plan already decided). Only C was removed.
 * These are source scans and call-site counts because "the same question answered twice" is a shape no
 * passing feature test can see.
 *
 * §A  the review sense is the plan's
 * §B  「회사 얘기가 질문이었나」 is the plan's
 * §C  the run's axis and subject are settled once and carried
 * §D  no word list stands in for a planner token
 * §E  what stayed, and why — the B census, pinned so it does not quietly grow
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import { senseOf } from "../../src/operator/group/ReviewEvidenceSense";
import { companyIsTheQuestion } from "../../src/conversation/ConversationService";

const SRC = join(__dirname, "../../src");

function sources(dir = SRC): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    return statSync(full).isDirectory() ? sources(full) : full.endsWith(".ts") ? [full] : [];
  });
}
const FILES = sources().map((path) => ({ path: path.slice(SRC.length + 1), text: readFileSync(path, "utf8") }));

/**
 * The CODE of each file — docblocks and line comments removed.
 *
 * Every module this package touched EXPLAINS in its own docblock what it used to read and why it
 * stopped, quoting the removed words. A guard that fails because of its neighbour's explanation is
 * deleted, not fixed; the property being pinned is about the code.
 */
const CODE = FILES.map((f) => ({
  path: f.path,
  text: f.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
}));
const holding = (needle: string) => CODE.filter((f) => f.text.includes(needle)).map((f) => f.path).sort();
const countIn = (path: string, needle: string) =>
  (CODE.find((f) => f.path === path)!.text.split(needle).length - 1);

/** Everything downstream of the planner: the graph, the specialists, and the answer's composer. */
const POST_PLANNER = CODE.filter((f) =>
  f.path.startsWith("operator/graph/") || f.path.startsWith("operator/group/")
  || f.path === "conversation/ConversationService.ts");

describe("§A — which review evidence a question is about is the plan's answer", () => {
  it("the sense is decided from the plan's own reads, and nothing about it reads a sentence", () => {
    // Measured against the real planner on 2026-09-06; each list is what it returned for the sentence
    // in the comment (`docs/agent_semantic_ownership_v1.md` §2).
    expect(senseOf(["list_recent_reviews", "get_dashboard_product_issues"])).toBe("NEGATIVE_REVIEW");
    expect(senseOf(["search_review_issues", "get_dashboard_product_issues"])).toBe("ISSUE_EVIDENCE");
    expect(senseOf([])).toBe("ISSUE_EVIDENCE");

    // The word table is gone, not shadowed — and its words are gone with it.
    expect(holding("NEGATIVE_WORDS")).toEqual([]);
    expect(holding("ISSUE_WORDS")).toEqual([]);
    const sense = CODE.find((f) => f.path === "operator/group/ReviewEvidenceSense.ts")!.text;
    expect(sense).not.toContain("goalText");
    expect(sense).not.toContain("plannerGoal");
  });

  it("one caller decides it, and the specialist reads the decision", () => {
    expect(holding("senseOf(")).toEqual([
      "operator/graph/operatorGraph.ts",        // the one caller
      "operator/group/ReviewEvidenceSense.ts",  // the definition
    ]);
    // The specialist takes it as a value, the way it already takes `grouping` and `channelScope`.
    expect(countIn("operator/graph/reviewOps.ts", "input.reviewSense")).toBe(1);
  });
});

describe("§B — whether the company itself was the question is the plan's answer", () => {
  it("the sole COMPANY_PROFILE need decides it, and the regex that used to is gone", () => {
    const needs = (kinds: string[]) => ({
      needs: kinds.map((kind, i) => ({ id: `n${i}`, kind, question: "", status: "SATISFIED", required: true, evidenceIds: [] })),
    } as unknown as Parameters<typeof companyIsTheQuestion>[0]);
    expect(companyIsTheQuestion(needs(["COMPANY_PROFILE"]))).toBe(true);
    // Measured 2026-09-06: 「우리 회사 특성 고려하면 배송 문의에 어떻게 답하는 게 좋을까」 plans exactly this.
    expect(companyIsTheQuestion(needs(["POLICY", "COMPANY_PROFILE", "PAST_ANSWER"]))).toBe(false);

    expect(holding("COMPANY_INTRO_ASK")).toEqual([]);
    // The need's own token is reported on the answer, so nothing has to re-infer what a turn was about.
    expect(countIn("operator/graph/operatorGraph.ts", "kind: need.kind")).toBe(1);
  });
});

describe("§C — the run's axis and its subject are settled once", () => {
  it("the graph settles the axis and the composer reads it back off the answer", () => {
    // Settled in the dispatch, carried on the state channel, put on the answer.
    expect(holding("effectiveAxisOf(")).toEqual([
      "operator/graph/operatorGraph.ts", "operator/plan/scopeOverride.ts",
    ]);
    expect(holding("focusForAxis(")).toEqual([
      "conversation/channelFocus.ts", "operator/graph/operatorGraph.ts",
    ]);
    // The composer no longer re-derives it — the read that used to pass `emitLog = false` because it
    // knew it was the repeat.
    expect(countIn("conversation/ConversationService.ts", "answer.axis")).toBe(1);
  });

  it("the sentence is read for a subject noun in one place, and the steps take the value", () => {
    expect(holding("sentenceSubjectOf(")).toEqual([
      "operator/graph/operatorGraph.ts", "operator/plan/scopeOverride.ts",
    ]);
    // The two inquiry reads that used to ask the sentence themselves.
    expect(countIn("operator/graph/inquiryRowsStep.ts", "input.subjectTerm")).toBe(1);
    expect(countIn("operator/graph/inquiryWorkloadStep.ts", "input.subjectTerm")).toBe(1);
    expect(holding("subjectTermOf(")).toEqual([
      "conversation/ConversationService.ts",   // the DIRECT lane, before any planner call (class A)
      "conversation/subjectTerm.ts",           // the definition
      "conversation/taskInterpreter.ts",       // the deterministic filter lane, likewise class A
      "operator/plan/scopeOverride.ts",        // the one place a settled run reads it
    ]);
  });
});

describe("§D — no word list stands in for a token the planner already emits", () => {
  it("the draft-word notice is gone, and its list with it", () => {
    expect(holding("DRAFT_WORDS")).toEqual([]);
    expect(holding("답변 초안 작성은 이 대화 창구에서 하지 않습니다")).toEqual([]);
  });

  it("no post-planner module carries a Korean word ARRAY to classify the goal", () => {
    // A literal array of Korean strings tested against the goal is the shape this package removed three
    // times. Not a ban on Korean — every one of these files writes sentences the seller reads — but on
    // a LIST of words used as a classifier beside a `goalText`.
    for (const file of POST_PLANNER) {
      const listsWords = /const [A-Z_]+ *(?::[^=]*)?= *\[\s*"[가-힣]/.test(file.text);
      const readsGoal = /goalText|userText/.test(file.text);
      expect(listsWords && readsGoal, `${file.path} classifies the goal with a word list`).toBe(false);
    }
  });
});

describe("§E — what stayed, and the reason it is allowed to", () => {
  it("the survivors read meanings the planner provably does not carry, and they are these", () => {
    // Class B, from the census. Each was traced against the real planner and each named a distinction
    // no plan token expresses. Pinned by count so a fourth one cannot arrive unnoticed.
    //
    //  · isAcquisitionRequest — 「새로 가져와줘」. Traced: the plan comes back `NONE` with no acquisition
    //    token anywhere in the schema.
    //  · analyzeIntentOf     — advice («뭐라고 답하면 좋을까») vs command («초안 만들어줘»). Traced: the
    //    planner answers `PREPARE_INQUIRY_DRAFT` for BOTH, so the distinction is not in the plan.
    //  · policy / fact / memory QUERY text — the words a search is run WITH, not a judgement about them.
    expect(holding("isAcquisitionRequest(")).toEqual([
      "conversation/ConversationService.ts", "conversation/acquisitionRequest.ts",
      "operator/graph/reviewRows.ts", "operator/plan/scopeOverride.ts",
    ]);
    // AOP Execution Closure v1 moved this reading OUT of the conversation service: the sentence is now
    // read once, in `procedureIntent.ts`, into a closed token that procedure routing takes. The service
    // no longer branches on it — which is the point, and is why the file list changed rather than grew.
    // Agent Runtime Production Closure v1 §4 closed the residue: the POST-PLAN twin (a plan that routed an
    // advisory question as PREPARE over a non-draftable target) no longer re-reads the sentence. Both
    // lanes ask `inquiryAnswerStep`, so the sentence is read exactly once per turn, at route time.
    expect(holding("analyzeIntentOf(")).toEqual([
      "conversation/procedureIntent.ts", "conversation/taskInterpreter.ts",
    ]);
    // The policy lane is the shape the rest should follow: the planner's token first, the sentence only
    // when there is no token to read.
    expect(countIn("operator/graph/inquiryOps.ts", "input.filters?.topic")).toBeGreaterThan(0);
  });

  it("the goal text is read in fewer places than it was, and the count is pinned", () => {
    // 70 reads across 21 files at `62c9ed2e`, counted this way (code only, comments stripped); 61 across
    // 16 after this package. A number that may fall freely and may not rise without this test being
    // changed on purpose.
    const reads = CODE.reduce((n, f) => n + (f.text.match(/goalText|userText/g) ?? []).length, 0);
    const files = CODE.filter((f) => /goalText|userText/.test(f.text)).length;
    expect(reads).toBeLessThanOrEqual(61);
    expect(files).toBeLessThanOrEqual(16);
  });
});
