/**
 * <b>The planner benchmark runner — the scenario eval with a LIVE plan.</b>
 *
 * Planner Model & Prompt Benchmark v1 §3. This is not a second execution path and not a second
 * scorer. It builds the same {@link worldHarness} the scenario suites build, runs the same
 * {@link ConversationService} over the same faked reads, and grades with the same
 * {@link violationsOf}. Exactly ONE thing is swapped: `planGoal` no longer replays a recording, it
 * calls `POST /api/agent/plan` on the running backend. Whatever model and prompt that backend is
 * configured with is the arm.
 *
 * <b>Why the seller data stays faked.</b> The plan request carries the seller's sentence, a static
 * tool catalogue and a closed-vocabulary progress line — no row, no id, no org. So a model can be
 * measured against a fixed corpus without a disposable organisation, and the corpus cannot drift
 * between arms. It also means this runner reads no marketplace, writes nothing, and touches no
 * seller row: the only network call it makes is the plan.
 *
 * Usage (the stack must be up):
 *   npx tsx bench/run.ts --arm=baseline --set=selection --out=bench/.out/baseline.json
 */
import { writeFileSync, mkdirSync } from "node:fs";
import { dirname } from "node:path";
import type { AgentPlanView } from "../src/spring/types";
import type { TurnView } from "../src/conversation/contract";
import { violationsOf, visibleTextOf, worldHarness } from "../test/scenario/grade";
import type { NamedScenario } from "../test/scenario/cases";
import { CI_SCENARIO_CASES } from "../test/scenario/cases";
import { HOLDOUT, SELECTION_EXTRA } from "./evalSet";
import { TOKEN, say } from "../test/conversation/support";

const BACKEND = process.env.BENCH_BACKEND ?? "http://127.0.0.1:8080";
const EMAIL = process.env.BENCH_EMAIL ?? "demo@sellerops.ai";
const PASSWORD = process.env.BENCH_PASSWORD ?? "demo1234";

interface PlanCall {
  readonly scenario: string;
  readonly turn: number;
  readonly retry: boolean;
  readonly ms: number;
  readonly ok: boolean;
  readonly supported: boolean;
  readonly tools: string[];
  readonly specialists: string[];
  readonly needKinds: string[];
  readonly filters: Record<string, unknown> | null;
  readonly requestedAction: string | null;
  readonly targetSelector: string | null;
}

interface TurnResult {
  readonly scenario: string;
  readonly world: string;
  readonly index: number;
  readonly say: string;
  readonly pass: boolean;
  readonly violations: string[];
  readonly status: string;
  readonly artifacts: string[];
  readonly llmCalls: number;
  readonly toolCalls: number;
  readonly turnMs: number;
  readonly planMs: number;
  readonly planCalls: number;
  /** Only kept for a turn that failed — what the seller would have read. */
  readonly visible?: string;
}

async function login(): Promise<string> {
  const res = await fetch(`${BACKEND}/api/auth/login`, {
    method: "POST", headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ email: EMAIL, password: PASSWORD }),
  });
  if (!res.ok) throw new Error(`login failed: ${res.status}`);
  return ((await res.json()) as { token: string }).token;
}

function setFor(name: string): NamedScenario[] {
  if (name === "selection") return [...CI_SCENARIO_CASES, ...SELECTION_EXTRA];
  if (name === "holdout") return [...HOLDOUT];
  if (name === "ci") return [...CI_SCENARIO_CASES];
  if (name === "extra") return [...SELECTION_EXTRA];
  throw new Error(`unknown set ${name}`);
}

async function main(): Promise<void> {
  const args = Object.fromEntries(process.argv.slice(2).map((a) => {
    const [k, ...v] = a.replace(/^--/, "").split("=");
    return [k!, v.join("=") || "true"];
  })) as Record<string, string>;
  const arm = args.arm ?? "unnamed";
  const setName = args.set ?? "selection";
  const out = args.out ?? `bench/.out/${arm}-${setName}.json`;
  const cases = setFor(setName);
  const jwt = await login();

  const planCalls: PlanCall[] = [];
  const turns: TurnResult[] = [];
  let scenarioIndex = 0;

  for (const c of cases) {
    scenarioIndex += 1;
    const h = worldHarness(c.world);
    // The one swap. Everything else in this process is the product.
    let inTurn = 0;
    let planMsThisTurn = 0;
    let planCallsThisTurn = 0;
    (h.operator as { planGoal?: unknown }).planGoal = async (request: {
      goalText: string; toolCatalogue: string[]; priorContext?: string; runId?: string; retry?: boolean;
    }): Promise<AgentPlanView> => {
      const started = Date.now();
      let view: AgentPlanView = { available: false, supported: false, specialists: [], tools: [], rationale: null, providerVersion: null };
      let ok = false;
      try {
        const res = await fetch(`${BACKEND}/api/agent/plan`, {
          method: "POST",
          headers: { "Content-Type": "application/json", Authorization: `Bearer ${jwt}` },
          body: JSON.stringify(request),
        });
        if (res.ok) { view = (await res.json()) as AgentPlanView; ok = true; }
        else { process.stderr.write(`plan HTTP ${res.status} for «${request.goalText}»\n`); }
      } catch (e) {
        process.stderr.write(`plan threw for «${request.goalText}»: ${String(e)}\n`);
      }
      const ms = Date.now() - started;
      planMsThisTurn += ms;
      planCallsThisTurn += 1;
      const v = view as unknown as Record<string, unknown>;
      planCalls.push({
        scenario: c.name, turn: inTurn, retry: request.retry === true, ms, ok,
        supported: view.supported === true,
        tools: view.tools ?? [], specialists: view.specialists ?? [],
        needKinds: (view.informationNeeds ?? []).map((n) => n.kind ?? "?"),
        filters: (v.filters as Record<string, unknown> | undefined) ?? null,
        requestedAction: (v.requestedAction as string | undefined) ?? null,
        targetSelector: ((v.target as { selector?: string } | undefined)?.selector) ?? null,
      });
      return view;
    };

    const { conversationId: id } = await h.service.create(TOKEN);
    const seen: string[] = [];
    for (let i = 0; i < c.turns.length; i += 1) {
      const t = c.turns[i]!;
      inTurn = i;
      planMsThisTurn = 0;
      planCallsThisTurn = 0;
      const startedTurn = Date.now();
      let turn: TurnView;
      try {
        turn = (await say(h, id, t.say)).turn;
      } catch (e) {
        turns.push({
          scenario: c.name, world: c.world, index: i, say: t.say, pass: false,
          violations: [`threw: ${String(e)}`], status: "THREW", artifacts: [], llmCalls: 0, toolCalls: 0,
          turnMs: Date.now() - startedTurn, planMs: planMsThisTurn, planCalls: planCallsThisTurn,
        });
        break;
      }
      const violations = violationsOf(turn, t.expect, seen);
      turns.push({
        scenario: c.name, world: c.world, index: i, say: t.say,
        pass: violations.length === 0, violations,
        ...(violations.length ? { visible: visibleTextOf(turn) } : {}),
        status: turn.status, artifacts: turn.artifacts.map((a) => a.type),
        llmCalls: turn.budget?.llmCalls ?? 0, toolCalls: turn.budget?.toolCalls ?? 0,
        turnMs: Date.now() - startedTurn, planMs: planMsThisTurn, planCalls: planCallsThisTurn,
      });
      seen.push(visibleTextOf(turn));
    }
    process.stderr.write(`[${arm}/${setName}] ${scenarioIndex}/${cases.length} ${c.name}\n`);
  }

  const passed = turns.filter((t) => t.pass).length;
  const planned = planCalls.filter((p) => p.ok);
  const sorted = planned.map((p) => p.ms).sort((a, b) => a - b);
  const pct = (q: number) => (sorted.length === 0 ? 0 : sorted[Math.min(sorted.length - 1, Math.floor(q * sorted.length))]!);
  const report = {
    arm, set: setName, at: new Date().toISOString(),
    turns: turns.length, passed, accuracy: turns.length ? passed / turns.length : 0,
    planCalls: planCalls.length, planFailed: planCalls.length - planned.length,
    planUnsupported: planned.filter((p) => !p.supported).length,
    planRetries: planCalls.filter((p) => p.retry).length,
    planP50: pct(0.5), planP90: pct(0.9), planP95: pct(0.95), planMax: sorted.at(-1) ?? 0,
    planMean: sorted.length ? Math.round(sorted.reduce((a, b) => a + b, 0) / sorted.length) : 0,
    turnP50: [...turns].map((t) => t.turnMs).sort((a, b) => a - b)[Math.floor(turns.length / 2)] ?? 0,
    toolCallsTotal: turns.reduce((a, t) => a + t.toolCalls, 0),
    llmCallsTotal: turns.reduce((a, t) => a + t.llmCalls, 0),
    failedTurns: turns.filter((t) => !t.pass),
    allTurns: turns, planDetail: planCalls,
  };
  mkdirSync(dirname(out), { recursive: true });
  writeFileSync(out, JSON.stringify(report, null, 2));
  process.stdout.write(
    `${arm}/${setName}: ${passed}/${turns.length} (${(100 * report.accuracy).toFixed(1)}%) · ` +
    `plan p50 ${report.planP50}ms p95 ${report.planP95}ms · calls ${planCalls.length} · → ${out}\n`);
}

void main();
