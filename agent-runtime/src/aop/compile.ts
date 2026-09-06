/**
 * <b>AOP definition → LangGraph subgraph.</b>
 *
 * LangGraph Orchestration Migration + AOP Runtime Core v1 §4. One function, and it is deliberately
 * small: a procedure is an ordered list of named steps, so the graph it compiles to is a chain with
 * one escape — any step that sets {@code terminal} routes to END. That escape is what a precondition
 * failure and a human interrupt have in common, and it is the only branching a procedure needs.
 *
 * <b>The compiler binds names to behaviour; it does not contain behaviour.</b> Each step names a
 * {@link HandlerName} and the handler table is supplied by the runtime, so this file has no idea what
 * preparing a draft means — which is exactly why moving orchestration here could not change semantics.
 *
 * <b>Why a subgraph and not a function.</b> Three things follow from being a real graph and none of
 * them follows from a loop: the checkpointer records which step it stopped after, an interrupt can
 * suspend inside it and resume there, and the trail it writes is the same shape the parent's is.
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver, CompiledStateGraph } from "@langchain/langgraph";
import type { HandlerName, ProcedureDefinition } from "./ProcedureDefinition";
import { ProcedureStateAnnotation } from "./ProcedureState";
import type { ProcedureState, ProcedureUpdate } from "./ProcedureState";

/** What a handler does: read the state, do the work, return the part of the state it changed. */
export type ProcedureHandler = (state: ProcedureState) => Promise<ProcedureUpdate> | ProcedureUpdate;

export interface ProcedureHandlers {
  readonly handlers: Readonly<Partial<Record<HandlerName, ProcedureHandler>>>;
  /**
   * Whether an OPTIONAL step runs on this state.
   *
   * Only consulted for steps the definition marks optional — a required step that could be skipped is
   * not required, and a definition that said so would be lying about its own shape.
   */
  readonly shouldRun?: (stepId: string, state: ProcedureState) => boolean;
}

/** A step whose handler the runtime did not publish. Named loudly: a silent no-op would pass tests. */
export class MissingHandlerError extends Error {
  constructor(procedure: string, stepId: string, handler: HandlerName) {
    super(`procedure ${procedure} step "${stepId}" names handler "${handler}", which the runtime does not publish`);
    this.name = "MissingHandlerError";
  }
}

export type CompiledProcedure = CompiledStateGraph<
  ProcedureState, ProcedureUpdate, string, typeof ProcedureStateAnnotation.spec,
  typeof ProcedureStateAnnotation.spec, typeof ProcedureStateAnnotation.spec
>;

/**
 * Compile one definition.
 *
 * Every step becomes a node named `<stepId>`; the chain is the definition's own order. A node that
 * returns a `terminal` ends the run there, and the trail records what actually ran — which is not the
 * same list as the definition's steps, and that difference is the point of recording it.
 */
export function compileProcedure(
  definition: ProcedureDefinition, table: ProcedureHandlers, checkpointer?: BaseCheckpointSaver,
): CompiledProcedure {
  for (const step of definition.steps) {
    if (!table.handlers[step.handler]) {
      throw new MissingHandlerError(definition.id, step.id, step.handler);
    }
  }

  const graph = new StateGraph(ProcedureStateAnnotation);
  for (const step of definition.steps) {
    const handler = table.handlers[step.handler]!;
    graph.addNode(step.id, async (state: ProcedureState): Promise<ProcedureUpdate> => {
      if (step.optional && table.shouldRun && !table.shouldRun(step.id, state)) {
        return {};
      }
      const update = await handler(state);
      return { ...update, stepTrail: [step.id] };
    });
  }

  const names = definition.steps.map((s) => s.id);
  graph.addEdge(START, names[0]! as never);
  for (let i = 0; i < names.length; i += 1) {
    const here = names[i]! as never;
    const next = names[i + 1];
    if (!next) {
      graph.addEdge(here, END);
      continue;
    }
    // The one branch a procedure has: a step that ended the run does not fall through to the next one.
    graph.addConditionalEdges(
      here,
      (state: ProcedureState) => (state.terminal ? "__end__" : next),
      { __end__: END, [next]: next } as never,
    );
  }

  return graph.compile({
    name: definition.version, ...(checkpointer ? { checkpointer } : {}),
  }) as unknown as CompiledProcedure;
}

/** Compile the whole catalogue against one handler table. */
export function compileAll(
  definitions: readonly ProcedureDefinition[], table: ProcedureHandlers, checkpointer?: BaseCheckpointSaver,
): Map<string, CompiledProcedure> {
  return new Map(definitions.map((d) => [d.id, compileProcedure(d, table, checkpointer)]));
}
