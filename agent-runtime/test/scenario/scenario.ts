/**
 * <b>Multi-turn scenario eval — a conversation stated as data, run against the real assembly.</b>
 *
 * Agent Procedure Layer v1 §4. The runner is deliberately thin: it is a declarative layer over the
 * harness the conversation suites already use ({@code test/conversation/support.ts}), which runs the
 * real {@link ConversationService}, the real operator graph and the real planner + validator, with only
 * the TRANSPORT faked. Nothing here is a second execution path.
 *
 * <b>Why the format exists.</b> The architecture audit measured the cost of not having it: 38 test
 * files each assembled their own plan recordings, eight assembled their own coverage fixture, and every
 * QA defect arrived as a new file. The axis that actually distinguishes the answers — WHAT KIND OF SHOP
 * this is — was dissolved into those fixtures, so the same sentence could not be asked of a clean
 * seller and a working one and the two answers compared. {@link WORLD} makes that axis a parameter.
 *
 * <b>`never` is a first-class assertion.</b> Every symptom of the defect this layer was built for was a
 * sentence that should not have been said — 「지금 먼저 하실 일은 없습니다」 to a shop with no channels,
 * the capability card printed twice, a connect CTA at a seller who has connected everything. A format
 * that can only say what MUST appear cannot express any of them, so {@link Expectation.never} scans
 * everything the seller can see: the message, the notes, every artifact's title, lines, items and
 * labels, and every suggested action.
 *
 * <b>CI calls no vendor.</b> Plans are replayed at `planGoal` from {@link SCENARIO_PLANS}; a sentence
 * with no recording fails with that sentence printed, so adding a turn is «record it once, paste it in»
 * rather than «hand-write a plan to the wire schema».
 */
import { expect, it } from "vitest";
import type { Artifact, TurnView } from "../../src/conversation/contract";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { fourIssues } from "../support/issueFixtures";
import { CONVERSATION_PLANS, RECORDED_PLANS, SCENARIO_PLANS } from "../support/recordedPlans";
import { TOKEN, harness, say } from "../conversation/support";
import type { Harness } from "../conversation/support";
import { WORLD } from "./worlds";
import type { WorldName } from "./worlds";

type ArtifactType = Artifact["type"];

export interface Expectation {
  /** Artifact types this turn must draw. */
  readonly artifacts?: readonly ArtifactType[];
  /** Artifact types this turn must NOT draw. */
  readonly noArtifacts?: readonly ArtifactType[];
  /** Substrings that must appear somewhere the seller can see. */
  readonly says?: readonly string[];
  /** Substrings that must appear NOWHERE the seller can see. First-class: see the file docblock. */
  readonly never?: readonly string[];
  /** A LINK action with this destination must be offered. */
  readonly link?: string;
  /** No LINK action may point here. */
  readonly noLink?: string;
  readonly status?: TurnView["status"];
  /** How many model calls this turn is allowed to have cost. */
  readonly llmCalls?: number;
  /** The visible surface must differ from that of an earlier turn (0-based index in this scenario). */
  readonly differsFrom?: number;
}

export interface ScenarioTurn {
  readonly say: string;
  readonly expect: Expectation;
}

export interface Scenario {
  readonly world: WorldName;
  readonly turns: readonly ScenarioTurn[];
}

/** Every string this turn puts in front of the seller — the surface `never` is checked against. */
export function visibleTextOf(turn: TurnView): string {
  const parts: string[] = [turn.message, ...(turn.notes ?? [])];
  const push = (v: unknown): void => { if (typeof v === "string") parts.push(v); };
  for (const a of turn.artifacts) {
    const any = a as unknown as Record<string, unknown>;
    push(any.title); push(any.headline); push(any.note); push(any.summary);
    for (const key of ["lines", "items", "groups", "findings", "rows", "steps"]) {
      const value = any[key];
      if (!Array.isArray(value)) continue;
      for (const entry of value) {
        if (typeof entry === "string") { parts.push(entry); continue; }
        const row = entry as Record<string, unknown>;
        push(row.label); push(row.title); push(row.detail); push(row.text); push(row.statement); push(row.preview);
        if (Array.isArray(row.items)) {
          for (const inner of row.items as Record<string, unknown>[]) { push(inner.label); push(inner.title); push(inner.preview); }
        }
      }
    }
  }
  for (const action of turn.suggestedActions) parts.push(action.label);
  return parts.filter((p) => p.length > 0).join("\n");
}

/** A harness seeded from a named world. Everything else is the conversation suite's own fixture. */
export function worldHarness(name: WorldName): Harness {
  const world = WORLD[name];
  const plansByGoal = { ...RECORDED_PLANS, ...CONVERSATION_PLANS, ...SCENARIO_PLANS };
  return harness({
    plansByGoal,
    channelCoverage: world.coverage,
    reviewDetails: world.reviewDetails,
    ...(world.inbox ? { inbox: world.inbox } : {}),
    ...(world.reviews
      ? { recentReviews: { "false:ALL": world.reviews, "true:ALL": { ...world.reviews, negativeOnly: true } } }
      : {}),
  }, world.inquiries, new FakeIssueSpringClient(name === "WORKING" ? fourIssues() : []));
}

function assertTurn(turn: TurnView, e: Expectation, seen: readonly string[], sentence: string): void {
  const visible = visibleTextOf(turn);
  const where = (what: string) => `${sentence} → ${what}\n--- visible ---\n${visible}`;
  const types = turn.artifacts.map((a) => a.type);
  for (const t of e.artifacts ?? []) expect(types, where(`missing artifact ${t}`)).toContain(t);
  for (const t of e.noArtifacts ?? []) expect(types, where(`unexpected artifact ${t}`)).not.toContain(t);
  for (const s of e.says ?? []) expect(visible, where(`should say «${s}»`)).toContain(s);
  for (const s of e.never ?? []) expect(visible, where(`must never say «${s}»`)).not.toContain(s);
  const links = turn.suggestedActions.filter((a) => a.kind === "LINK").map((a) => a.to);
  if (e.link) expect(links, where(`should offer ${e.link}`)).toContain(e.link);
  if (e.noLink) expect(links, where(`must not offer ${e.noLink}`)).not.toContain(e.noLink);
  if (e.status) expect(turn.status, where("status")).toBe(e.status);
  if (e.llmCalls != null) expect(turn.budget?.llmCalls ?? 0, where("llmCalls")).toBe(e.llmCalls);
  if (e.differsFrom != null) expect(visible, where(`must differ from turn ${e.differsFrom}`)).not.toBe(seen[e.differsFrom]);
}

/** Run one scenario as one `it`. The world is the parameter; the turns are the data. */
export function scenario(name: string, s: Scenario): void {
  it(`[${s.world}] ${name}`, async () => {
    const h = worldHarness(s.world);
    const { conversationId: id } = await h.service.create(TOKEN);
    const seen: string[] = [];
    for (const t of s.turns) {
      const { turn } = await say(h, id, t.say);
      // A sentence nobody recorded a plan for reaches the planner and is refused by the fake — which
      // would otherwise read as a product failure. Say which sentence, so recording it is the fix.
      if (turn.failureCode === "GOAL_UNSUPPORTED" && !t.expect.status) {
        throw new Error(`no recorded plan for «${t.say}» — record it once and add it to SCENARIO_PLANS`);
      }
      assertTurn(turn, t.expect, seen, t.say);
      seen.push(visibleTextOf(turn));
    }
  });
}
