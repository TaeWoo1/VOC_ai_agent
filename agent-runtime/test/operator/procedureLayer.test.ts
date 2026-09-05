/**
 * <b>The Agent Procedure Layer's own invariants — the tests that stop the duplication coming back.</b>
 *
 * Agent Procedure Layer v1. The audit did not find a wrong algorithm; it found the SAME judgement made
 * in several places, which is a shape a passing feature test cannot see. So these assertions are mostly
 * source scans and counts: they fail when a second place starts deciding something this layer owns.
 *
 * §A  one place decides «what does empty mean»
 * §B  one place decides «can this object take a draft»
 * §C  one read decides «what can this seller hold», and the planner is told the token from it
 * §D  the procedure layer never reads the seller's sentence
 */
import { describe, expect, it } from "vitest";
import { readFileSync, readdirSync, statSync } from "node:fs";
import { join } from "node:path";
import {
  absenceSentence, honestZero, inquiryDraftPrecondition, nextStepFor, operationalPrecondition,
  reviewDraftPrecondition,
} from "../../src/operator/procedure/Procedure";
import { UNKNOWN_WORLD, worldStateOf, worldTokenFor } from "../../src/operator/state/WorldState";
import { EXECUTION_REASON } from "../../src/operator/capability/ChannelCapability";
import type { ChannelCapabilityVerdict } from "../../src/operator/capability/ChannelCapability";
import { TOKEN, coverageRow, harness, say } from "../conversation/support";
import { worldHarness } from "../scenario/scenario";

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
 * A guard that fails because a neighbouring file EXPLAINS the defect it closes is not fixed, it is
 * deleted; several files quote 「지금 먼저 하실 일은 없습니다」 in their own docblocks precisely because
 * that sentence is why they exist. The property being pinned is about the code.
 */
const CODE = FILES.map((f) => ({
  path: f.path,
  text: f.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, ""),
}));
const holding = (needle: string) => CODE.filter((f) => f.text.includes(needle)).map((f) => f.path).sort();
const countIn = (path: string, needle: string) =>
  (CODE.find((f) => f.path === path)!.text.split(needle).length - 1);

describe("§A — one place decides what an empty answer MEANS", () => {
  it("every absence sentence exists exactly once in the source", () => {
    // The sentence that started this package. It may be said, but from ONE state and ONE file.
    expect(holding("지금 먼저 하실 일은 없습니다")).toEqual(["operator/procedure/Procedure.ts"]);
    expect(holding("아직 연결된 판매 채널이 없어서")).toEqual(["operator/procedure/Procedure.ts"]);
    expect(holding("연결은 끝났고, 아직 가져온 자료가 없습니다")).toEqual(["operator/procedure/Procedure.ts"]);
    // The two functions this layer replaced are gone, not shadowed.
    expect(holding("notStartedSentence")).toEqual([]);
    expect(holding("withFirstUseStep")).toEqual([]);
  });

  it("`ZERO_MEASURED` is the only reason whose sentence asserts something about the shop", () => {
    const world = worldStateOf([coverageRow({})], { workingSet: null });
    expect(absenceSentence("DAILY_WORK", "ZERO_MEASURED", world)).toBe("지금 먼저 하실 일은 없습니다.");
    // Any other procedure asking the same reason gets nothing: the claim belongs to the checklist.
    expect(absenceSentence("ANSWER_INQUIRY", "ZERO_MEASURED", world)).toBeNull();
    // A state we could not read claims neither way — the one error a connected seller cannot check.
    expect(absenceSentence("DAILY_WORK", "UNKNOWN", world)).toBeNull();
    expect(operationalPrecondition(UNKNOWN_WORLD)).toEqual({ ok: true });
  });

  it("«없습니다» requires having measured nothing — a turn that found work does not claim it", () => {
    // Live on the Demo organisation (2026-09-06): the checklist was empty because the run produced
    // findings rather than a list, and the answer opened 「지금 먼저 하실 일은 없습니다」 directly above
    // its own sentence saying 24 inquiries were waiting.
    expect(honestZero(0, 0)).toBe(true);
    expect(honestZero(0, 2)).toBe(false);
    expect(honestZero(3, 0)).toBe(false);
    // One claim site: nothing else in the runtime decides when that sentence may be said.
    expect(holding("honestZero")).toEqual([
      "conversation/ConversationService.ts", "operator/procedure/Procedure.ts",
    ]);
    expect(countIn("conversation/ConversationService.ts", "honestZero(")).toBe(1);
  });

  it("the connect step is offered for exactly one reason, and its label lives in one place", () => {
    expect(nextStepFor("NO_CHANNEL")).toEqual({ label: "판매 채널 연결하기", to: "/connect" });
    for (const other of ["NO_DATA_YET", "ZERO_MEASURED", "NOT_ACTIONABLE", "NOT_SUPPORTED", "UNKNOWN"] as const) {
      expect(nextStepFor(other)).toBeNull();
    }
    // One constant, two surfaces (the chat card and the checklist item).
    expect(holding('label: "판매 채널 연결하기"')).toEqual(["operator/procedure/Procedure.ts"]);
  });
});

describe("§B — one place decides whether an object can take a draft", () => {
  it("the inquiry gate is asked through one function, and its sentences live with it", () => {
    expect(inquiryDraftPrecondition("DRAFTABLE", true)).toEqual({ ok: true });
    expect(inquiryDraftPrecondition("DRAFTABLE", false)).toEqual({ ok: false, absence: "NOT_ACTIONABLE" });
    for (const state of ["ALREADY_ANSWERED", "AWAITING_SEND", "NOT_WORKABLE"] as const) {
      expect(inquiryDraftPrecondition(state, true)).toEqual({ ok: false, absence: "NOT_ACTIONABLE" });
    }
    // The refusal wording is reached through the procedure layer, never read off the table directly.
    expect(holding("ACTIONABILITY_SENTENCE[")).toEqual(["operator/procedure/Procedure.ts"]);
    // Three callers: the shared PREPARE step, and the knowledge-capture resume that re-checks the row.
    expect(countIn("conversation/ConversationService.ts", "inquiryDraftPrecondition(")).toBe(2);
  });

  it("the review gate refuses BOTH «cannot» and «could not tell», and nothing else compares the verdict", () => {
    const verdict = (execution: string, reason: string): ChannelCapabilityVerdict =>
      ({ execution, reason } as unknown as ChannelCapabilityVerdict);
    expect(reviewDraftPrecondition(verdict("API_EXECUTION", ""))).toEqual({ ok: true });
    expect(reviewDraftPrecondition(verdict("NOT_SUPPORTED", EXECUTION_REASON.CHANNEL_UNSUPPORTED)))
      .toEqual({ ok: false, absence: "NOT_SUPPORTED" });
    // «a draft for a place that may not exist is the Coupang loophole by another door».
    expect(reviewDraftPrecondition(verdict("NOT_SUPPORTED", EXECUTION_REASON.CAPABILITY_UNKNOWN)))
      .toEqual({ ok: false, absence: "UNKNOWN" });
    // The refusal wording moved with the decision: no caller re-derives either sentence.
    expect(holding("리뷰 답글을 어떻게 처리할 수 있는지 확인하지 못해"))
      .toEqual(["operator/procedure/Procedure.ts"]);
    // Two callers ask it — the planner's PREPARE and the tone revision, which before this layer read
    // the verdict and did not compare it at all.
    expect(holding("reviewDraftPrecondition"))
      .toEqual(["conversation/ConversationService.ts", "operator/procedure/Procedure.ts"]);
    expect(countIn("conversation/ConversationService.ts", "reviewDraftPrecondition(")).toBe(2);
  });
});

describe("§C — one read decides what this seller can hold", () => {
  it("the coverage read has one readiness consumer, and it is the turn's world", () => {
    // The planner's own tool may read it (that is a tool, not a judgement) and the acquisition card
    // falls back to it only when the turn's read failed. Nothing else derives readiness from it.
    expect(holding("getChannelCoverage")).toEqual([
      "conversation/ConversationService.ts",
      "conversation/acquisitionStep.ts",
      "operator/tools/OperatorTools.ts",
      "spring/OperatorSpringClient.ts",
      "spring/SpringClient.ts",
    ]);
    expect(holding("sellerReadinessOf")).toEqual([
      "operator/capability/SellerReadiness.ts", "operator/state/WorldState.ts",
    ]);
  });

  it("the planner is told one closed enum and nothing else", () => {
    const rows = [coverageRow({ connected: false, connectionStatus: null, state: "NOT_CONNECTED", rows: 0, openRows: 0 })];
    expect(worldTokenFor(worldStateOf(rows, { workingSet: null }))).toBe("판매자 상태: NO_CHANNEL");
    expect(worldTokenFor(worldStateOf([coverageRow({ state: "ZERO", rows: 0, openRows: 0 })], { workingSet: null })))
      .toBe("판매자 상태: NO_DATA");
    expect(worldTokenFor(worldStateOf([coverageRow({})], { workingSet: null }))).toBe("판매자 상태: WORKING");
    // A state we failed to read is not a state to assert.
    expect(worldTokenFor(UNKNOWN_WORLD)).toBeNull();
  });

  it("that enum reaches the plan request, and carries no channel name, count or id", async () => {
    const h = worldHarness("NO_CHANNEL");
    const { conversationId: id } = await h.service.create(TOKEN);
    await say(h, id, "뭐부터 하면 되냐고");
    const sent = h.operator.planPriorContexts.join("\n");
    expect(sent).toContain("판매자 상태: NO_CHANNEL");
    for (const leak of ["네이버", "카페24", "쿠팡", "0건", "coverage", "NOT_CONNECTED"]) {
      expect(sent, `plan request must not carry ${leak}`).not.toContain(leak);
    }
  });

  it("a working seller costs the same one read, and its token says so", async () => {
    const h = harness();
    const { conversationId: id } = await h.service.create(TOKEN);
    await say(h, id, "내가 해야 할 일 정리해줘");
    expect(h.operator.planPriorContexts.join("\n")).toContain("판매자 상태: WORKING");
  });
});

describe("§D — the procedure layer never reads the seller's sentence", () => {
  it("holds no regular expression, no keyword table and no sentence parameter", () => {
    const layer = FILES.filter((f) => f.path.startsWith("operator/procedure/") || f.path === "operator/state/WorldState.ts");
    expect(layer.map((f) => f.path).sort())
      .toEqual(["operator/procedure/Procedure.ts", "operator/state/WorldState.ts"]);
    for (const file of layer) {
      // Strip docblocks: this file explains itself in prose and the prose is not the code.
      const code = file.text.replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");
      for (const forbidden of ["RegExp", ".test(", ".includes(", "goalText", "userText", "text:"]) {
        expect(code, `${file.path} must not read the seller's words (${forbidden})`).not.toContain(forbidden);
      }
    }
  });
});
