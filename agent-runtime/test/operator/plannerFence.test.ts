/**
 * The structural fences behind invariant I2 — the ones that make "there is no deterministic planner"
 * checkable rather than merely stated.
 *
 * <b>Why a source scan rather than a behavioural test.</b> A behavioural test can only observe what the
 * code happens to do on the inputs it was given; these assert what the code IS. The same technique
 * `AgentDraftBoundaryTest` uses on the backend for "one door per capability", and the same technique
 * `operatorToolRegistry.test.ts` uses for "no WRITE tool" — a property that could be re-introduced by a
 * well-meaning refactor needs a test that fails at the refactor, not one that fails later at some
 * behaviour nobody thought to exercise.
 */
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { LlmInvestigationPlanner } from "../../src/operator/plan/LlmInvestigationPlanner";

const SRC = join(__dirname, "../../src");

function sourceFiles(dir: string): string[] {
  const out: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    if (statSync(full).isDirectory()) {
      out.push(...sourceFiles(full));
    } else if (entry.endsWith(".ts")) {
      out.push(full);
    }
  }
  return out;
}

const FILES = sourceFiles(SRC).map((path) => ({ path, text: readFileSync(path, "utf8") }));

describe("planner fence — exactly one planner, and it is the LLM one", () => {
  it("only one class in src/ implements Planner", () => {
    const implementers = FILES
      .filter((f) => /class\s+\w+\s+implements\s+Planner\b/.test(f.text))
      .map((f) => f.path.replace(SRC, "src"));
    expect(implementers, `expected exactly one Planner implementation, found: ${implementers.join(", ")}`)
      .toHaveLength(1);
    expect(implementers[0]).toContain("LlmInvestigationPlanner");
  });

  it("the one planner declares kind LLM", () => {
    // Constructed with a backend that has no planGoal — enough to read `kind`, and it proves the type
    // is not something that only becomes LLM when a model is present.
    const planner = new LlmInvestigationPlanner({});
    expect(planner.kind).toBe("LLM");
  });

  it("no source file defines a keyword, fallback or emergency planner", () => {
    const banned = /\b(KeywordPlanner|FallbackPlanner|EmergencyPlanner|DeterministicPlanner|StubPlanner)\b/;
    const offenders = FILES.filter((f) => banned.test(f.text)).map((f) => f.path.replace(SRC, "src"));
    expect(offenders, `deterministic planner reintroduced in: ${offenders.join(", ")}`).toEqual([]);
  });
});

describe("goal routing fence — free text is never interpreted deterministically", () => {
  const parseGoalSource = FILES.find((f) => f.path.endsWith("goal/parseGoal.ts"))!;

  it("parseGoal holds no keyword table", () => {
    expect(parseGoalSource.text).not.toContain("INTENT_KEYWORDS");
    // The give-away shape of a keyword router: a per-intent keyword list.
    expect(parseGoalSource.text).not.toMatch(/keywords\s*:/);
  });

  it("parseGoal never matches text against anything", () => {
    // `includes` over the request text IS the keyword table, whatever it is named.
    expect(parseGoalSource.text).not.toMatch(/request\.text[^\n]*\.includes\(/);
    expect(parseGoalSource.text).not.toMatch(/lower[^\n]*\.includes\(/);
  });

  it("no source file extracts a product mention from a sentence", () => {
    // v1's `productHint` regex read the seller's sentence and pulled a product name out of it — a
    // phrase router by another name, and one the planner now owns via `entities.unresolved`.
    const offenders = FILES
      .filter((f) => /\bproductHints?\s*\(/.test(f.text))
      .map((f) => f.path.replace(SRC, "src"));
    expect(offenders, `sentence-level product extraction found in: ${offenders.join(", ")}`).toEqual([]);
  });
});
