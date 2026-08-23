/**
 * Resolving a product by the name the seller can actually read.
 *
 * <b>The red case is a live one, twice.</b> On 2026-08-23 a seller asked about
 * "판도리 일체형 종이컵 수거함" — the title on their own Coupang listing — and both runs ended
 * "해당하는 상품을 찾지 못했습니다". The product existed and carried seven real reviews; its
 * `products.name` was the number 15223228019, because that is what a Coupang-derived catalogue stores
 * there, and `resolve_product` read only that field (`docs/agent_real_validation_v1.md` §9.5, C1).
 *
 * <b>What this does NOT loosen.</b> The alias is matched whole and nothing else is: no similarity, no
 * model, no merging of products. When one title belongs to two products the run refuses instead of
 * picking, and when the product IS resolved the org-wide evidence that used to answer for it is still
 * refused — the A1 gate does not soften because a name got easier to find.
 */
import { describe, expect, it } from "vitest";
import { OperatorAgentRuntime } from "../../src/operator/operatorRuntime";
import type { OperatorRunResult } from "../../src/operator/operatorRuntime";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import type { FakeOperatorSeed, SeedProduct } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { fourIssues } from "../support/issueFixtures";
import {
  ANALYSES, CABLE, CUP_BIN, INBOX, KNOWLEDGE, MEMORY, MOLDING, REPEATS,
  coveredSignals, cupBinKnowledge, cupBinSignals, unlinkedSignals,
} from "../support/operatorFixtures";
import { RECORDED_PLANS } from "../support/recordedPlans";
import type { OperatorAnswer } from "../../src/operator/state/OperatorState";

const GOAL = "판도리 일체형 종이컵 수거함 상품의 리뷰와 문의를 같이 보고 고객 불만이나 반복 이슈가 있는지 알려줘.";
const HUMAN_NAME = "판도리 일체형 종이컵 수거함";
const SKU_NAME = "15223228019";
const HEALTH_GOAL = "전선몰딩 상품 요즘 문제 있어?";

function build(seed: Partial<FakeOperatorSeed> = {}) {
  return new OperatorAgentRuntime({
    operator: new FakeOperatorSpringClient({
      inbox: INBOX,
      products: [MOLDING, CABLE, CUP_BIN],
      signals: {
        [MOLDING.id]: coveredSignals(),
        [CABLE.id]: unlinkedSignals(),
        [CUP_BIN.id]: cupBinSignals(),
      },
      knowledge: { ...KNOWLEDGE, [CUP_BIN.id]: cupBinKnowledge() },
      customerMemory: MEMORY,
      repeats: REPEATS,
      itemAnalyses: ANALYSES,
      plansByGoal: RECORDED_PLANS,
      ...seed,
    }),
    inquiry: new FakeSpringClient(twoInquiries()),
    issue: new FakeIssueSpringClient(fourIssues()),
  });
}

function done(result: OperatorRunResult): OperatorAnswer {
  if (result.status !== "DONE") {
    throw new Error(`expected DONE, got FAILED: ${result.failureCode} — ${result.reason}`);
  }
  return result.answer;
}

/**
 * Every product attribution the run actually STATED, as (productId, productName).
 *
 * Read off the findings rather than off `evidence`, because rejected rows stay in the answer on
 * purpose — the org-wide issues REVIEW_OPS read are still there, and still belong to other products.
 * What matters is which of them reached a sentence.
 */
function attributions(answer: OperatorAnswer): Array<{ id: unknown; name: unknown }> {
  const cited = new Set(answer.findings.filter((f) => !f.claimsCoverageLimit)
    .flatMap((f) => f.evidenceIds));
  return answer.evidence
    .filter((e) => cited.has(e.evidenceId) && e.locator.productId != null)
    .map((e) => ({ id: e.locator.productId, name: e.locator.productName }));
}

// --------------------------------------------------------------------------- the canonical red test

describe("C1 regression — the seller's own listing title finds their product", () => {
  it("resolves the product whose canonical name is a SKU number", async () => {
    const answer = done(await build().run("c1-red", { text: GOAL }));

    // Before: zero resolved entities, every piece of evidence rejected as NO_RESOLVED_PRODUCT, and a
    // final answer that said the product did not exist.
    const rows = attributions(answer);
    expect(rows.length, "the run reached a product").toBeGreaterThan(0);
    expect(rows.every((r) => r.id === CUP_BIN.id)).toBe(true);
  });

  it("calls the product what the seller called it, not what the catalogue calls it", async () => {
    const answer = done(await build().run("c1-name", { text: GOAL }));

    expect(attributions(answer).every((r) => r.name === HUMAN_NAME)).toBe(true);
    const stated = answer.findings.map((f) => f.statement).join(" ");
    expect(stated).toContain(HUMAN_NAME);
    // Reading a product code back at a seller who typed the product's title is not an answer about
    // their product. The number stays in the catalogue where it belongs.
    expect(stated).not.toContain(SKU_NAME);
  });

  it("resolves to the same product on a second run of the same sentence", async () => {
    const first = done(await build().run("c1-a", { text: GOAL }));
    const second = done(await build().run("c1-b", { text: GOAL }));
    expect(attributions(first)).toEqual(attributions(second));
  });

  it("still refuses the org-wide rows — a resolved name does not widen what may be said", async () => {
    const answer = done(await build().run("c1-gate", { text: GOAL }));

    // `search_review_issues` has no product parameter, so REVIEW_OPS still reads the whole org. Those
    // rows were the three HIGH-severity issues the baseline attributed to this product.
    expect(answer.specialists).toContain("REVIEW_OPS");
    for (const finding of answer.findings) {
      for (const id of finding.evidenceIds) {
        const ref = answer.evidence.find((e) => e.evidenceId === id);
        if (ref && !finding.claimsCoverageLimit) {
          expect(ref.locator.productId, `${finding.statement} cites org-scope evidence`)
            .toBe(CUP_BIN.id);
        }
      }
    }
  });

  it("asserts no WRITE and proposes none", async () => {
    const answer = done(await build().run("c1-write", { text: GOAL }));
    expect(answer.nextActions.every((a) => a.actionClass !== "WRITE")).toBe(true);
  });
});

// --------------------------------------------------------------------------- one title, two products

describe("an alias that names two products names neither", () => {
  const TWIN: SeedProduct = {
    id: "p-twin", name: "94", sku: "94", status: "ACTIVE",
    listingNames: [HUMAN_NAME],
  };

  it("refuses to pick, and says what would settle it", async () => {
    const answer = done(await build({ products: [MOLDING, CABLE, CUP_BIN, TWIN] })
      .run("c1-ambiguous", { text: GOAL }));

    expect(attributions(answer), "no product may be attributed").toHaveLength(0);
    expect(answer.note ?? "").toContain("2개");
    expect(answer.note ?? "").toContain("SKU");
  });

  it("states nothing about either candidate rather than answering about one of them", async () => {
    const answer = done(await build({ products: [MOLDING, CABLE, CUP_BIN, TWIN] })
      .run("c1-nocoin", { text: GOAL }));
    // Not "does not name the human title" — either product would answer under that. The claim is that
    // no product-scoped statement survives at all, whichever one a coin flip would have chosen.
    expect(answer.findings.filter((f) => !f.claimsCoverageLimit)).toHaveLength(0);
    for (const finding of answer.findings) {
      expect(finding.statement).not.toContain(HUMAN_NAME);
    }
  });
});

// --------------------------------------------------------------------------- what must not change

describe("the surfaces that already worked still work", () => {
  it("a fragment of a canonical name still resolves, and still discloses that it was one of several",
    async () => {
      const SIBLING: SeedProduct = {
        id: "p-molding-2", name: "전선몰딩 2호", sku: "SKU-78", status: "ACTIVE",
      };
      const answer = done(await build({ products: [MOLDING, SIBLING, CABLE, CUP_BIN] })
        .run("c1-partial", { text: HEALTH_GOAL }));

      // A partial match is a DIFFERENT situation from an exact tie: the seller gave a fragment, so
      // one of the two may well be the one they meant. The run proceeds and says which it took.
      expect(attributions(answer).every((r) => r.id === MOLDING.id)).toBe(true);
      expect(answer.note ?? "").toContain("여러 개");
    });

  it("a name nobody sells still resolves to nothing and claims nothing", async () => {
    const answer = done(await build({ products: [MOLDING, CABLE] }).run("c1-unknown", { text: GOAL }));
    expect(attributions(answer)).toHaveLength(0);
    expect(answer.findings.filter((f) => !f.claimsCoverageLimit)).toHaveLength(0);
    expect(answer.note ?? "").toContain(HUMAN_NAME);
  });
});
