/**
 * **LangGraph.js shadow of the review-import journey — OBSERVE ONLY.**
 *
 * A LangGraph `StateGraph` that runs the pure journey kernel over the events a real run produces, in parallel
 * with the real runtime, and reports where its computed phase disagrees with the runtime's own observable
 * state. It exists to prove the kernel tracks reality before any cutover — it drives nothing.
 *
 * ## Structurally side-effect-free
 *
 * The graph's only node calls `reduceJourney` and returns a phase. It performs no I/O, no logging, no browser
 * or network access, and cannot: this module imports only the pure kernel, the pure projection, LangGraph, and
 * the sanitized metadata logger. A source guard test pins that. The runtime is never touched — the shadow is
 * FED observations, it does not reach into any live object.
 *
 * ## Checkpointing
 *
 * Phase is threaded across per-event invocations by an in-memory `MemorySaver`, keyed by a synthetic thread id
 * (never a launch ref). It is deliberately in-memory and per-instance — it does NOT persist and does NOT
 * replace the abandon-only run-store. No external tracing: LangSmith is neither imported nor enabled.
 *
 * ## Divergence
 *
 * The only place the runtime exposes a single authoritative phase for comparison is the v2 run status of the
 * in-flight segment. At each observed `run_status` the detector checks the shadow phase against the phases that
 * status permits; a mismatch is a divergence, logged as enums/booleans/counts only.
 */
import { Annotation, MemorySaver, START, StateGraph } from "@langchain/langgraph";
import { log } from "../../log";
import {
  INITIAL_JOURNEY_STATE,
  reduceJourney,
  type JourneyEvent,
  type JourneyPhase,
} from "../../../../contracts/review-import-journey/v1/index";
import { projectJourneyEvent, type JourneyObservation } from "./journey-projection";

/**
 * Graph state: the current phase (persisted via checkpoint) and the event being applied this invocation.
 * Both channels are last-value; the phase carries across invocations, the event is the per-call input.
 */
const ShadowAnnotation = Annotation.Root({
  phase: Annotation<JourneyPhase>({
    reducer: (_prev, next) => next,
    default: () => INITIAL_JOURNEY_STATE.phase,
  }),
  event: Annotation<JourneyEvent | null>({
    reducer: (_prev, next) => next ?? null,
    default: () => null,
  }),
});

type ShadowState = typeof ShadowAnnotation.State;

/** The one node. PURE: kernel only — no I/O, no log, no side effect. */
function advance(state: ShadowState): Partial<ShadowState> {
  if (!state.event) return {};
  return { phase: reduceJourney({ phase: state.phase }, state.event).phase };
}

/** Build the compiled observe-only graph with an in-memory checkpointer. No tracer is attached. */
export function buildJourneyShadowGraph() {
  const graph = new StateGraph(ShadowAnnotation)
    .addNode("advance", advance)
    .addEdge(START, "advance")
    .addEdge("advance", "__end__");
  return graph.compile({ checkpointer: new MemorySaver() });
}

/** v2 run statuses that mean the segment run ended in success / failure. */
const COMPLETED_STATUSES: ReadonlySet<string> = new Set(["COMPLETED", "OPERATOR_REPORTED"]);
const FAILED_STATUSES: ReadonlySet<string> = new Set(["FAILED"]);

/** The journey phases each observed run status permits — the shadow must be in one of them, or it has diverged. */
function allowedPhasesForStatus(status: string): ReadonlySet<JourneyPhase> {
  if (COMPLETED_STATUSES.has(status)) {
    // After a completion the next-segment signal may already have advanced the shadow.
    return new Set<JourneyPhase>(["SEGMENT_DONE", "PLAN_READY", "PLAN_COMPLETE"]);
  }
  if (FAILED_STATUSES.has(status)) return new Set<JourneyPhase>(["SEGMENT_FAILED"]);
  if (status === "CANCELLED") return new Set<JourneyPhase>(["ABANDONED", "SEGMENT_FAILED"]);
  // Every intermediate status means the segment is still running.
  return new Set<JourneyPhase>(["SEGMENT_RUNNING"]);
}

/** A sanitized divergence record — enums and a boolean only, never a ref/date/id/url. */
export interface DivergenceRecord {
  readonly consistent: boolean;
  readonly shadowPhase: JourneyPhase;
  readonly observedStatus: string;
}

/** Compare the shadow phase against the phases a real run status permits. Pure. */
export function detectRunDivergence(shadowPhase: JourneyPhase, status: string): DivergenceRecord {
  return { consistent: allowedPhasesForStatus(status).has(shadowPhase), shadowPhase, observedStatus: status };
}

/**
 * The observe-only shadow runner: feed it the observations a run emits, and it tracks the expected journey
 * phase and counts divergences. It drives nothing and holds no runtime handle.
 */
export class JourneyShadow {
  private readonly graph = buildJourneyShadowGraph();
  private readonly thread: string;
  private phaseValue: JourneyPhase = INITIAL_JOURNEY_STATE.phase;
  private divergences = 0;

  /** @param thread a synthetic checkpoint thread id — NEVER a launch ref or any real identity. */
  constructor(thread = "journey-shadow") {
    this.thread = thread;
  }

  /** Project one observation, advance the shadow graph, and (at a run status) check for divergence. */
  async observe(obs: JourneyObservation): Promise<void> {
    const event = projectJourneyEvent(obs);
    if (event) {
      const out = await this.graph.invoke({ event }, { configurable: { thread_id: this.thread } });
      this.phaseValue = out.phase;
    }
    if (obs.kind === "run_status") {
      const record = detectRunDivergence(this.phaseValue, obs.status);
      if (!record.consistent) {
        this.divergences += 1;
        // Sanitized: a boolean, two enums, and a count. No ref, date, id, url, path, token, or page text.
        log("journey_shadow_divergence", {
          consistent: record.consistent,
          shadowPhase: record.shadowPhase,
          observedStatus: record.observedStatus,
          count: this.divergences,
        });
      }
    }
  }

  /** Feed a whole sequence in order. */
  async observeAll(observations: readonly JourneyObservation[]): Promise<void> {
    for (const obs of observations) await this.observe(obs);
  }

  currentPhase(): JourneyPhase {
    return this.phaseValue;
  }

  divergenceCount(): number {
    return this.divergences;
  }
}
