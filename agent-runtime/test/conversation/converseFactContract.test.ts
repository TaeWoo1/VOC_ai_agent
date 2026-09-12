/**
 * <b>The lines this runtime renders, written down so the backend's floor can be run against them.</b>
 *
 * Every canonical fact is prose we assemble here and the backend refuses or accepts there
 * ({@code ConverseRequestFloor}). Until this file existed the two halves were only ever checked apart:
 * the runtime suite asserted on rendered text with no floor in sight, and the backend suite asserted on
 * the floor with hand-typed strings — so seven reviewed rows could grow past
 * {@code MAX_FACT_LENGTH} and refuse EVERY product question while both suites stayed green. That is not
 * a gap a stricter unit test closes; it is a gap that closes only when the real lines meet the real
 * floor.
 *
 * <b>How the halves meet without a second copy of anything.</b> This test regenerates
 * `contracts/product-truth/v1/converse-facts.json` from the reviewed ledger contract, and
 * {@code ProductTruthConverseFloorTest} on the backend reads that file and runs the production floor
 * over it. Neither side types a fact by hand; edit a YAML row and the ledger contract moves, this file
 * moves with it, and the floor gets the new sentences.
 *
 * <b>Plans, not questions.</b> The rows are keyed by the selection plan a turn resolves to, because the
 * floor's limits are per-request and a request carries one plan's facts. All six shapes are written,
 * including the widest, so the artifact says plainly how large each one is.
 */
import { describe, expect, it } from "vitest";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import type { CanonicalProductTruth } from "../../src/spring/types";
import { planSelection, selectCanonicalFacts } from "../../src/operator/capability/CanonicalProductTruth";
import type { CanonicalSelection } from "../../src/operator/capability/CanonicalProductTruth";

const CONTRACTS = resolve(__dirname, "../../../contracts/product-truth/v1");
const LEDGER: CanonicalProductTruth = JSON.parse(readFileSync(`${CONTRACTS}/ledger.json`, "utf8"));
const ARTIFACT = `${CONTRACTS}/converse-facts.json`;

/** The seller-facing channel names a deployment offers; the renderer takes them from the coverage read. */
const NAMES = { NAVER: "네이버 스마트스토어", CAFE24: "카페24", COUPANG: "쿠팡" };

/** Every shape `planSelection` can produce, named the way the log names it. */
const SHAPES: ReadonlyArray<{ readonly label: string; readonly selection: CanonicalSelection }> = [
  { label: "CHANNEL_ACTION+CAFE24", selection: { aspect: "CHANNEL_ACTION", channel: "CAFE24", focusObject: null } },
  { label: "CHANNEL_ACTION+NAVER", selection: { aspect: "CHANNEL_ACTION", channel: "NAVER", focusObject: null } },
  { label: "CHANNEL_ACTION+COUPANG", selection: { aspect: "CHANNEL_ACTION", channel: "COUPANG", focusObject: null } },
  { label: "AFTER_CONNECT+CAFE24", selection: { aspect: "AFTER_CONNECT", channel: "CAFE24", focusObject: null } },
  { label: "SUPPORTED_CHANNELS", selection: { aspect: "SUPPORTED_CHANNELS", channel: null, focusObject: null } },
  { label: "HOW_TO_CONNECT", selection: { aspect: "HOW_TO_CONNECT", channel: null, focusObject: null } },
  { label: "PRODUCT_OVERVIEW", selection: { aspect: "PRODUCT_OVERVIEW", channel: null, focusObject: null } },
  { label: "COLLECTION_STATE", selection: { aspect: "COLLECTION_STATE", channel: null, focusObject: null } },
  { label: "DAILY_OPERATION", selection: { aspect: "DAILY_OPERATION", channel: null, focusObject: null } },
  { label: "TEAM_ACCESS", selection: { aspect: "TEAM_ACCESS", channel: null, focusObject: null } },
  { label: "SECURITY_AND_DATA", selection: { aspect: "SECURITY_AND_DATA", channel: null, focusObject: null } },
  { label: "PRODUCT_DIFFERENCE", selection: { aspect: "PRODUCT_DIFFERENCE", channel: null, focusObject: null } },
  { label: "FUTURE_DIRECTION", selection: { aspect: "FUTURE_DIRECTION", channel: null, focusObject: null } },
  { label: "UNPLACED", selection: { aspect: null, channel: null, focusObject: null } },
  { label: "UNPLACED+INQUIRY", selection: { aspect: null, channel: null, focusObject: "INQUIRY" } },
];

/** The renderer collapses whitespace before comparing; a YAML block scalar arrives with newlines. */
function collapse(text: string): string {
  return text.replace(/\s+/g, " ").trim();
}

function render() {
  return SHAPES.map(({ label, selection }) => {
    const plan = planSelection(selection);
    const selected = selectCanonicalFacts(LEDGER, plan, NAMES);
    return {
      plan: label,
      categories: plan.categories,
      capabilityDepth: plan.capabilityDepth,
      runtimeOverlay: plan.runtimeOverlay,
      ids: selected.map((f) => f.id),
      facts: selected.map((f) => f.text),
    };
  });
}

describe("the rendered canonical facts, as a contract the backend floor is run against", () => {
  it("regenerates the artifact and fails when it has moved", () => {
    const rendered = `${JSON.stringify(render(), null, 2)}\n`;
    const before = (() => {
      try {
        return readFileSync(ARTIFACT, "utf8");
      } catch {
        return null;
      }
    })();
    writeFileSync(ARTIFACT, rendered);
    // Regenerated, then compared: a run that rewrites the file leaves the tree correct, and a run that
    // found it different says so — the same shape as the ledger contract's own drift fence.
    expect(before, "converse-facts.json 이 갱신되었습니다 — 새 파일을 커밋하세요").toBe(rendered);
  });

  /**
   * The property the backend enforces, asserted here too so a bad render is named in the suite that
   * produced it rather than only in the one that consumes it. The number is the backend's
   * {@code MAX_FACT_LENGTH}; {@code ProductTruthConverseFloorTest} is what keeps the two equal.
   */
  it("no rendered fact exceeds one line of the backend's floor", () => {
    for (const shape of render()) {
      for (const fact of shape.facts) {
        expect(fact.length, `${shape.plan}: ${fact.slice(0, 60)}…`).toBeLessThanOrEqual(400);
        expect(fact.trim().length).toBeGreaterThan(0);
      }
    }
  });

  /**
   * <b>The claim and its admission ticket stay in one string.</b>
   *
   * {@code admits()} lets a row below LIVE_PROVEN travel only because its own Korean limitation says
   * what has not been proven — so a split that put the capability on one line and 「실제 몰에 게시한 적이
   * 없습니다」 on the next would hand the model exactly the overclaim the ledger exists to prevent. The
   * assembler orders limitations directly after the notes for this reason; this asserts it on the
   * rendered output rather than trusting the ordering.
   */
  it("no line states a capability without the limitation that admitted it", () => {
    // Only the rows where a limitation IS the ticket: a LIVE_PROVEN row travels on its evidence, and
    // asking it to qualify itself would assert something `admits()` never required.
    const ticketed = (r: { status: string; evidence: string; limitations: readonly string[];
                           sellerFacingNotes: readonly string[] }) =>
      (r.status === "SUPPORTED" || r.status === "PARTIAL") && r.evidence !== "LIVE_PROVEN"
      && r.limitations.length > 0 && r.sellerFacingNotes.length > 0;
    const claims = new Map<string, readonly string[]>();
    for (const row of LEDGER.capabilities) {
      if (ticketed(row)) claims.set(row.id, row.limitations);
      for (const sub of row.subtypes) if (ticketed(sub)) claims.set(sub.id, sub.limitations);
    }
    expect(claims.size).toBeGreaterThan(0);
    for (const shape of render()) {
      shape.ids.forEach((id, i) => {
        const limitations = claims.get(id);
        if (!limitations) return;
        const text = shape.facts[i]!;
        // A part is a claim when it carries the row's own notes; the notes are what say what the
        // product does. A part carrying only 「실행하려면: …」 states a precondition, not a capability.
        const row = [...LEDGER.capabilities, ...LEDGER.capabilities.flatMap((c) => c.subtypes)]
          .find((r) => r.id === id)!;
        const claimsHere = row.sellerFacingNotes.some((n) => text.includes(collapse(n)));
        if (!claimsHere) return;
        // A caveat that names an internal token is dropped by the output guard's own patterns before
        // it can be spoken; when every one of a row's caveats is dropped there is nothing for this
        // property to be about, and the ledger's validator owns that case rather than this test.
        const speakable = limitations.some((l) =>
          shape.facts.some((f, j) => shape.ids[j] === id && f.includes(collapse(l))));
        if (!speakable) return;
        expect(
          limitations.some((l) => text.includes(collapse(l))),
          `${shape.plan}: ${id} 가 한계 없이 주장합니다`,
        ).toBe(true);
      });
    }
  });

  /**
   * <b>A narrowed layer names ledger ids, and an id that has left the ledger selects nothing.</b>
   *
   * `PRODUCT_DIFFERENCE` and `FUTURE_DIRECTION` answer from a named handful rather than from every
   * item of their layers, which is what keeps them inside the floor's fact bound. The cost of naming
   * ids is that a rename in the YAML would quietly shrink the answer instead of breaking anything —
   * so it breaks here instead.
   */
  it("every id a narrowed plan names exists in the reviewed ledger", () => {
    const known = new Set<string>([
      ...LEDGER.narratives.map((n) => n.id), ...LEDGER.features.map((f) => f.id),
      ...LEDGER.invariants.map((i) => i.id), ...LEDGER.directions.map((d) => d.id),
      ...LEDGER.roadmap.map((r) => r.id), ...LEDGER.capabilities.map((c) => c.id),
    ]);
    for (const { label, selection } of SHAPES) {
      const only = planSelection(selection).onlyIds;
      if (!only) continue;
      for (const ids of Object.values(only)) {
        for (const id of ids ?? []) expect(known, `${label}: ${id}`).toContain(id);
      }
    }
  });

  /** The two narrowed plans, asserted on what they must and must not carry. */
  it("a difference question stands on the narrative written for it, and not on the channel grid", () => {
    const shape = render().find((s) => s.plan === "PRODUCT_DIFFERENCE")!;
    expect(shape.ids).toContain("NARRATIVE.SELLER_CENTER_DIFFERENCE");
    expect(shape.capabilityDepth).toBe("NONE");
    expect(shape.ids.filter((id) => /^(NAVER|CAFE24|COUPANG)\./.test(id))).toEqual([]);
    expect(shape.ids.filter((id) => id.startsWith("ROADMAP."))).toEqual([]);
    expect(shape.ids.filter((id) => id.startsWith("DIRECTION."))).toEqual([]);
  });

  it("a future question carries both future layers whole, and today's line once", () => {
    const shape = render().find((s) => s.plan === "FUTURE_DIRECTION")!;
    expect(new Set(shape.ids.filter((id) => id.startsWith("ROADMAP."))).size)
      .toBe(LEDGER.roadmap.length);
    expect(new Set(shape.ids.filter((id) => id.startsWith("DIRECTION."))).size)
      .toBe(LEDGER.directions.length);
    // Deduplicated: this invariant is long enough to be split across two lines under one id.
    expect([...new Set(shape.ids.filter((id) => id.startsWith("INVARIANT.")))])
      .toEqual(["INVARIANT.OPERATING_OBJECTS"]);
    expect(shape.ids.filter((id) => /^(NAVER|CAFE24|COUPANG)\./.test(id))).toEqual([]);
    // Rule 13's hedge is not optional and does not depend on the model noticing: every roadmap line
    // announces itself, and each item's own qualifier travels with it.
    shape.ids.forEach((id, i) => {
      if (!id.startsWith("ROADMAP.")) return;
      expect(shape.facts[i]).toContain("앞으로의 방향(현재 제공되는 기능이 아닙니다)");
    });
    for (const item of LEDGER.roadmap) {
      const lines = shape.ids.map((id, i) => (id === item.id ? shape.facts[i]! : "")).join(" ");
      expect(lines, item.id).toContain(collapse(item.qualifier));
    }
  });

  /**
   * The two state/operation plans, asserted on what they must and must not carry. A question about
   * whether collection is running is not a question about sending answers, and neither is a question
   * about how often to log in.
   */
  it("the state and operation plans keep to the acquisition axis", () => {
    for (const label of ["COLLECTION_STATE", "DAILY_OPERATION"]) {
      const shape = render().find((s) => s.plan === label)!;
      const capability = shape.ids.filter((id) => /^(NAVER|CAFE24|COUPANG)\./.test(id));
      expect(capability.length, label).toBeGreaterThan(0);
      for (const id of capability) expect(id, label).toContain(".ACQUISITION");
      expect(shape.runtimeOverlay, label).toBe(true);
    }
  });

  /**
   * <b>Two questions are not about now, and the overlay is about now.</b> 「판매자센터랑 뭐가 달라?」
   * answered with 「지금 이 환경에서는 초안까지만…」 finished an answer about the product with a fact
   * about this host. Everything else keeps it: a capability that is built and one that is switched on
   * here are different sentences.
   */
  it("only the questions that are not about now drop the runtime overlay", () => {
    const off = render().filter((s) => s.runtimeOverlay === false).map((s) => s.plan);
    // What the product IS, what it WILL BE, who may use it, and how it keeps things — none of them is
    // a question about what this deployment is doing at this moment.
    expect(off).toEqual(["TEAM_ACCESS", "SECURITY_AND_DATA", "PRODUCT_DIFFERENCE", "FUTURE_DIRECTION"]);
  });

  /**
   * The two v21 aspects. Both used to plan as PRODUCT_OVERVIEW and arrive at 79 lines against a floor
   * of 80 — correct answers one ledger addition away from disappearing. What is asserted is that each
   * stands on its own reviewed items and that neither carries the channel grid.
   */
  it("the team and security plans stand on their own items and not on the product tour", () => {
    const team = render().find((s) => s.plan === "TEAM_ACCESS")!;
    expect(team.ids).toContain("FEATURE.ACCOUNT_AND_ORGANIZATION");
    expect(team.ids).toContain("ROADMAP.TEAM_ACCESS");
    expect(team.ids.filter((id) => /^(NAVER|CAFE24|COUPANG)\./.test(id))).toEqual([]);
    expect(team.ids).not.toContain("NARRATIVE.WHAT_IT_IS");

    const security = render().find((s) => s.plan === "SECURITY_AND_DATA")!;
    for (const id of ["FEATURE.CHANNEL_CREDENTIAL_STORAGE", "FEATURE.HELPER_DEVICE_ACCESS",
                      "INVARIANT.ORG_ISOLATION", "INVARIANT.SECURITY_CLAIM_LIMIT"]) {
      expect(security.ids, id).toContain(id);
    }
    expect(security.ids.filter((id) => /^(NAVER|CAFE24|COUPANG)\./.test(id))).toEqual([]);
    // Both stay far under the floor's fact bound, which is the point of having them at all.
    for (const shape of [team, security]) expect(shape.facts.length).toBeLessThan(30);
  });

  /**
   * <b>Our words for our own machinery do not travel in a seller's answer.</b> A live turn came back
   * with 「이 원장에서 확인되지 않아」 — the model repeating the ledger's own noun for itself. The
   * output guard's patterns are Latin-script, so nothing would have caught it on the way out either.
   */
  it("no seller-facing line names our own machinery", () => {
    const ours = ["원장", "저장소", "레저", "ledger", "YAML", "yaml"];
    for (const shape of render()) {
      for (const fact of shape.facts) {
        for (const word of ours) {
          expect(fact.includes(word), `${shape.plan}: ${word} — ${fact.slice(0, 60)}…`).toBe(false);
        }
      }
    }
  });

  /** 「파일로 올릴 수도 있어?」 is answered by the ledger's own statement of what a file may carry. */
  it("the connection plans carry the manual file path", () => {
    for (const label of ["HOW_TO_CONNECT", "SUPPORTED_CHANNELS"]) {
      const shape = render().find((s) => s.plan === label)!;
      expect(shape.ids, label).toContain("FEATURE.MANUAL_FILE_ACQUISITION");
      // …and nothing else from the feature layer: this is a connection question, not a tour.
      expect(shape.ids.filter((id) => id.startsWith("FEATURE.")), label)
        .toEqual(["FEATURE.MANUAL_FILE_ACQUISITION"]);
    }
  });

  /**
   * Splitting a long item must not lose a clause or its subject. Each part re-states the row's subject,
   * so a limitation can never be read as belonging to a different channel — and the ledger id is the
   * same on every part, which is what keeps the log answering "which reviewed item".
   */
  it("a split item keeps its id and re-states its subject on every part", () => {
    const shape = render().find((s) => s.plan === "CHANNEL_ACTION+CAFE24")!;
    const split = shape.ids.filter((id, i) => shape.ids.indexOf(id) !== i);
    expect(split.length, "이 원장에는 나뉜 행이 있어야 합니다").toBeGreaterThan(0);
    for (const id of new Set(split)) {
      const parts = shape.facts.filter((_, i) => shape.ids[i] === id);
      const subject = parts[0]!.split(" — ")[0]!;
      for (const part of parts) expect(part.startsWith(`${subject} —`)).toBe(true);
    }
  });
});
