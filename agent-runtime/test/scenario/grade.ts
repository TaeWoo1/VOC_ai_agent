/**
 * <b>The scenario format and its scorer — the half with no test framework in it.</b>
 *
 * Split out of {@link ./scenario.ts} by Planner Model & Prompt Benchmark v1 §3 for one reason: the
 * benchmark runs the same conversations against the same assertions from a plain `tsx` process, and a
 * module that imports `vitest` cannot be loaded outside a test run. Nothing here changed in the split.
 */
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

/**
 * Every expectation this turn did not meet, as one line each — the scorer both consumers share.
 *
 * `assertTurn` below turns the first of these into a vitest failure; the benchmark counts them. A
 * second implementation would let a model be graded by assertions CI does not make.
 */
export function violationsOf(turn: TurnView, e: Expectation, seen: readonly string[]): string[] {
  const visible = visibleTextOf(turn);
  const types = turn.artifacts.map((a) => a.type);
  const links = turn.suggestedActions.filter((a) => a.kind === "LINK").map((a) => a.to);
  const out: string[] = [];
  for (const t of e.artifacts ?? []) if (!types.includes(t)) out.push(`missing artifact ${t}`);
  for (const t of e.noArtifacts ?? []) if (types.includes(t)) out.push(`unexpected artifact ${t}`);
  for (const s of e.says ?? []) if (!visible.includes(s)) out.push(`should say «${s}»`);
  for (const s of e.never ?? []) if (visible.includes(s)) out.push(`must never say «${s}»`);
  if (e.link && !links.includes(e.link)) out.push(`should offer ${e.link}`);
  if (e.noLink && links.includes(e.noLink)) out.push(`must not offer ${e.noLink}`);
  if (e.status && turn.status !== e.status) out.push(`status ${turn.status} ≠ ${e.status}`);
  if (e.llmCalls != null && (turn.budget?.llmCalls ?? 0) !== e.llmCalls) {
    out.push(`llmCalls ${turn.budget?.llmCalls ?? 0} ≠ ${e.llmCalls}`);
  }
  if (e.differsFrom != null && visible === seen[e.differsFrom]) out.push(`must differ from turn ${e.differsFrom}`);
  return out;
}
