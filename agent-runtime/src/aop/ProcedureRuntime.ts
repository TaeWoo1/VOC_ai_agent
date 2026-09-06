/**
 * <b>The AOP runtime — where a definition becomes a running subgraph.</b>
 *
 * AOP Execution Closure v1. The definitions were data with a compiler and no caller; this is the
 * caller. It compiles the six once, runs the one the router chose, and writes the durable cursor that
 * lets a stopped procedure continue in another process.
 *
 * <b>The runtime owns transitions, not meaning.</b> Every handler below delegates to {@link ProcedureOps},
 * which {@code ConversationService} implements out of the methods that already owned each step — the
 * exact object read, the production draft path, the tone revision, the approval boundary, the
 * capture write. Moving the CONTROL here cannot change an answer, and that is the property parity
 * measures.
 *
 * <b>What the runtime refuses to do.</b> It does not decide whether an approval is valid (that is
 * {@code validateApproval}, against the approval's own record), it does not perform a side effect
 * (that is {@code execute}, once, behind the existing fence), and it does not write a sentence
 * (composition stays where it lives). An interrupt here is a pause, never a permission.
 */
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { compileProcedure } from "./compile";
import type { CompiledProcedure, ProcedureHandlers } from "./compile";
import { PROCEDURES } from "./procedures";
import type { HandlerName, ProcedureDefinition } from "./ProcedureDefinition";
import type { ProcedureState, ProcedureUpdate } from "./ProcedureState";
import type { ProcedureId } from "../operator/procedure/Procedure";
import type { AopCheckpoint, AopCheckpointStore } from "./AopCheckpointStore";
import { log } from "../log";

/**
 * What the product must be able to do for a procedure to run.
 *
 * One method per {@link HandlerName}, plus the optional-step predicate. A new workflow is a new
 * DEFINITION over these — not a new branch in the conversation service, which is the structural
 * success criterion this package is measured by.
 */
export interface ProcedureOps<C> {
  hydrateWorld(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  loadObject(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  checkPrecondition(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  investigate(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  evidence(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  prepare(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  revise(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  humanWait(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  resume(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  readOpportunities(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  validateApproval(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  execute(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  terminal(state: ProcedureState, ctx: C): Promise<ProcedureUpdate>;
  /** Whether an OPTIONAL step applies to this run. Required steps are never asked. */
  shouldRun(stepId: string, state: ProcedureState, ctx: C): boolean;
}

const HANDLER_NAMES: HandlerName[] = [
  "hydrateWorld", "loadObject", "checkPrecondition", "investigate", "evidence", "prepare", "revise",
  "humanWait", "resume", "readOpportunities", "validateApproval", "execute", "terminal",
];

export interface ProcedureRunResult {
  readonly state: ProcedureState;
  /** The cursor that was persisted, when the run stopped somewhere a person has to act. */
  readonly checkpoint: AopCheckpoint | null;
}

export class ProcedureRuntime<C> {
  private readonly compiled: Map<ProcedureId, CompiledProcedure>;
  private readonly checkpoints: AopCheckpointStore | null;

  constructor(ops: ProcedureOps<C>, options: {
    checkpoints?: AopCheckpointStore | null;
    /** LangGraph's own saver, for suites that resume INSIDE a process. Optional by design. */
    saver?: BaseCheckpointSaver;
  } = {}) {
    const handlers: Partial<Record<HandlerName, ProcedureHandlers<C>["handlers"][HandlerName]>> = {};
    for (const name of HANDLER_NAMES) {
      handlers[name] = (state, ctx) => ops[name](state, ctx);
    }
    const table: ProcedureHandlers<C> = {
      handlers: handlers as ProcedureHandlers<C>["handlers"],
      shouldRun: (stepId, state, ctx) => ops.shouldRun(stepId, state, ctx),
    };
    this.compiled = new Map(
      (Object.values(PROCEDURES) as ProcedureDefinition[])
        .map((d) => [d.id, compileProcedure<C>(d, table, options.saver)]),
    );
    this.checkpoints = options.checkpoints ?? null;
  }

  definitionOf(id: ProcedureId): ProcedureDefinition {
    return PROCEDURES[id];
  }

  /**
   * Run one procedure to its terminal, and persist the cursor when it stopped for a person.
   *
   * <b>A resume claims first.</b> When a cursor already exists for this thread the claim decides
   * whether this caller may continue it — the same exactly-once contract the inquiry run store states,
   * and the reason a second resume performs no side effect.
   */
  async run(id: ProcedureId, ctx: C, options: {
    conversationId: string; threadId: string; initial?: ProcedureUpdate;
  }): Promise<ProcedureRunResult> {
    const definition = this.definitionOf(id);
    const graph = this.compiled.get(id)!;
    const existing = this.checkpoints ? await this.checkpoints.load(options.threadId) : null;
    if (existing) {
      const claim = await this.checkpoints!.claim(options.threadId);
      if (claim.outcome !== "CLAIMED") {
        log("aop_resume_refused", { procedure: id, outcome: claim.outcome });
        return { state: stateFrom(existing), checkpoint: existing };
      }
    }
    const seed: ProcedureUpdate = {
      procedureId: id, version: definition.version,
      ...(existing ? { refs: existing.refs } : {}),
      ...(options.initial ?? {}),
    };
    const state = await graph.invoke(seed as never, {
      configurable: { ctx, thread_id: options.threadId },
      recursionLimit: 32,
    } as never) as ProcedureState;

    log("aop_procedure_run", {
      procedure: id, version: definition.version, steps: state.stepTrail.join(">"),
      terminal: state.terminal ?? "NONE", interrupt: state.interrupt ?? "NONE",
      resumed: existing != null,
    });

    let checkpoint: AopCheckpoint | null = null;
    if (this.checkpoints) {
      if (state.terminal === "WAITING_HUMAN") {
        checkpoint = {
          threadId: options.threadId, conversationId: options.conversationId,
          procedureId: id, procedureVersion: definition.version,
          step: state.stepTrail.at(-1) ?? "", stepTrail: [...state.stepTrail],
          refs: state.refs,
          draftId: state.refs.draftVersion != null ? String(state.refs.draftVersion) : null,
          approvalId: state.approvalId ?? null,
          terminal: state.terminal, absence: state.absence, interrupt: state.interrupt,
          updatedAt: new Date().toISOString(),
        };
        await this.checkpoints.save(checkpoint);
      } else if (existing) {
        // The procedure finished: the cursor has nothing left to point at, and a cursor that outlives
        // its run is the thing a later resume would mistake for work still to do.
        await this.checkpoints.delete(options.threadId);
      }
    }
    return { state, checkpoint };
  }
}

/** Rebuild the state a stored cursor represents — refs and terminal only, never content. */
function stateFrom(checkpoint: AopCheckpoint): ProcedureState {
  return {
    procedureId: checkpoint.procedureId, version: checkpoint.procedureVersion,
    refs: checkpoint.refs, terminal: checkpoint.terminal, absence: checkpoint.absence,
    interrupt: checkpoint.interrupt, stepTrail: [...checkpoint.stepTrail],
    approvalId: checkpoint.approvalId,
  } as ProcedureState;
}
