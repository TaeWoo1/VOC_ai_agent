import { readFileSync } from "node:fs";
import { describe, expect, it } from "vitest";

/**
 * <b>One renderer for a repeated problem, and it invents no number.</b>
 *
 * <p>The behaviour — what a row says and where it links — is asserted where a seller meets it, in
 * {@code CustomerOpsHome.test.tsx}. What cannot be asserted by rendering one Home is the property that made this
 * component exist: that the OTHER Home draws the same row. There are two Homes, only one of them was drawing these
 * rows, and the one that was not is the one a delegated organisation sees — so the divergence was invisible to every
 * test that rendered either screen on its own.
 *
 * <p>The second scan is the rule the whole repeated-problem surface rests on: this component may print numbers a read
 * returned and may not produce one of its own. The specific arithmetic banned here is the one that shipped —
 * {@code decidable + observing}, a sum of two populations the server documents as un-addable, printed under the name
 * of one of them.
 */
describe("RepeatedProblemList — the row a Home draws for a repeated problem", () => {
  const source = (path: string) => readFileSync(path, "utf-8");
  /** Comments say what the code must not do; scanning them would fail on this file's own explanations. */
  const code = (text: string) =>
    text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/\{\/\*[\s\S]*?\*\/\}/g, "").replace(/^\s*\/\/.*$/gm, "");

  const LIST = "src/components/home/RepeatedProblemList.tsx";
  const HOMES = [
    "src/components/home/OperationsAreas.tsx",
    "src/components/customerOperations/CustomerOpsHome.tsx",
  ];

  it("is the only place a repeated problem is turned into a row", () => {
    for (const home of HOMES) {
      const body = code(source(home));
      expect(body, `${home} draws its own repeated-problem row`).not.toContain("/memory/${issue.id}");
      expect(body, `${home} reaches into a problem's per-product evidence itself`).not.toContain("byProduct");
      expect(body, `${home} does not use the shared renderer`).toContain("RepeatedProblemList");
    }
  });

  it("prints what the read returned and derives nothing", () => {
    const body = code(source(LIST));

    // The pair, never a rate — dividing evidence by reviews asserts a rate over a population nobody examined.
    expect(body).not.toContain("%");
    expect(body).not.toMatch(/evidenceCount\s*\/|productReviews\s*\//);

    // The sum that shipped, and any other arithmetic over the two population counts.
    expect(body).not.toContain("decidable");
    expect(body).not.toContain("observing");
  });

  it("hands every row to the problem's own workspace and decides nothing itself", () => {
    const body = code(source(LIST));

    expect(body).toContain("/memory/${issue.id}");
    // No verb, no control: 관찰 중 means nothing was concluded, and a Home that drew these as tasks would be
    // manufacturing urgency out of an evidence trickle.
    expect(body).not.toContain("<button");
    expect(body).not.toContain("onClick");
    expect(body).not.toContain("api.");
  });
});
