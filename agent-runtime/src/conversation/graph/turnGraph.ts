/**
 * <b>The turn, as a LangGraph.</b>
 *
 * LangGraph Orchestration Migration + AOP Runtime Core v1 §2. What moved here is CONTROL FLOW and
 * nothing else: which phase runs next, where a turn stops, what a resume continues, and what gets
 * checkpointed. Every phase delegates to the code that already owned its meaning — the direct lanes,
 * the operator graph, the composer, the store — so this migration cannot change an answer. That is
 * the property parity is measured against, and it is a property of the shape, not of care.
 *
 * <b>The node is `chooseRoute`, not `route`</b>: LangGraph refuses a node whose name collides with a
 * state channel, and `route` is the channel this node writes — the same rule the operator graph
 * records about its own `interpretGoal`.
 *
 * <pre>
 *   START → hydrate → chooseRoute ─┬→ click ───────────────────────────────→ END
 *                            ├→ captureDecision ─────────────────────→ END
 *                            ├→ resume ──┬→ (still waiting) ─────────→ END
 *                            │           └→ operator …
 *                            ├→ direct ──┬→ (handled) ───────────────→ END
 *                            │           └→ operator …
 *                            └→ operator → procedure → compose → persist → END
 * </pre>
 *
 * <b>Why `procedure` is its own node.</b> Selecting a business procedure and settling its precondition
 * were decisions made inside the composer, interleaved with building sentences. They are now taken by
 * the router (a table over closed tokens) and handed to the composer as a verdict — the same functions,
 * the same inputs, one owner.
 *
 * <b>What is NOT here.</b> The approval decision. An interrupt is a pause; §6's order is
 * interrupt → existing approval validation → separate execute node, and neither this file nor the
 * checkpoint may stand in for the middle one.
 */
import { END, START, StateGraph } from "@langchain/langgraph";
import type { BaseCheckpointSaver } from "@langchain/langgraph";
import { TurnStateAnnotation } from "./TurnState";
import type { TurnGraphState, TurnGraphUpdate, TurnRoute } from "./TurnState";

/**
 * The turn's collaborators and its scratch space.
 *
 * Deliberately opaque here: this file routes, and a router that could read a draft would be tempted to
 * decide something about it. It travels in `configurable`, which LangGraph does not checkpoint.
 */
export interface TurnContext {
  [key: string]: unknown;
}

/**
 * The phases, as the runtime implements them.
 *
 * Each returns the small part of the state the checkpoint needs; everything else it produces is
 * written onto the context, which is where the turn's own machinery already kept it.
 */
export interface TurnPhases {
  hydrate(ctx: TurnContext): Promise<TurnGraphUpdate>;
  route(ctx: TurnContext): Promise<TurnRoute>;
  click(ctx: TurnContext): Promise<TurnGraphUpdate>;
  captureDecision(ctx: TurnContext): Promise<TurnGraphUpdate>;
  /** Returns `true` when the turn is finished here (still waiting on a person). */
  resume(ctx: TurnContext): Promise<{ readonly done: boolean; readonly update: TurnGraphUpdate }>;
  /** Returns `true` when a closed intent answered the turn without a planner call. */
  direct(ctx: TurnContext): Promise<{ readonly handled: boolean; readonly update: TurnGraphUpdate }>;
  operator(ctx: TurnContext): Promise<TurnGraphUpdate>;
  /** Select the business procedure and settle its precondition. No sentence is written here. */
  procedure(ctx: TurnContext): Promise<TurnGraphUpdate>;
  compose(ctx: TurnContext): Promise<TurnGraphUpdate>;
  persist(ctx: TurnContext): Promise<TurnGraphUpdate>;
}

const ctxOf = (config: unknown): TurnContext =>
  ((config as { configurable?: { ctx?: TurnContext } } | undefined)?.configurable?.ctx ?? {}) as TurnContext;

export function buildTurnGraph(phases: TurnPhases, checkpointer?: BaseCheckpointSaver) {
  const graph = new StateGraph(TurnStateAnnotation)
    .addNode("hydrate", async (_s: TurnGraphState, c: unknown) =>
      ({ ...(await phases.hydrate(ctxOf(c))), trail: ["hydrate"] }))
    .addNode("chooseRoute", async (_s: TurnGraphState, c: unknown) =>
      ({ route: await phases.route(ctxOf(c)), trail: ["chooseRoute"] }))
    .addNode("click", async (_s: TurnGraphState, c: unknown) =>
      ({ ...(await phases.click(ctxOf(c))), terminal: "ANSWERED" as const, trail: ["click"] }))
    .addNode("captureDecision", async (_s: TurnGraphState, c: unknown) =>
      ({ ...(await phases.captureDecision(ctxOf(c))), terminal: "ANSWERED" as const, trail: ["captureDecision"] }))
    .addNode("resume", async (_s: TurnGraphState, c: unknown) => {
      const { done, update } = await phases.resume(ctxOf(c));
      // «still waiting» is a terminal, and it is the one a checkpoint exists to make resumable.
      return { ...update, ...(done ? { terminal: "WAITING_HUMAN" as const } : {}), trail: ["resume"] };
    })
    .addNode("direct", async (_s: TurnGraphState, c: unknown) => {
      const { handled, update } = await phases.direct(ctxOf(c));
      return { ...update, ...(handled ? { terminal: "ANSWERED" as const } : {}), trail: ["direct"] };
    })
    .addNode("operator", async (_s: TurnGraphState, c: unknown) =>
      ({ ...(await phases.operator(ctxOf(c))), trail: ["operator"] }))
    .addNode("procedure", async (_s: TurnGraphState, c: unknown) =>
      ({ ...(await phases.procedure(ctxOf(c))), trail: ["procedure"] }))
    .addNode("compose", async (_s: TurnGraphState, c: unknown) =>
      ({ ...(await phases.compose(ctxOf(c))), trail: ["compose"] }))
    .addNode("persist", async (_s: TurnGraphState, c: unknown) =>
      ({ ...(await phases.persist(ctxOf(c))), trail: ["persist"] }));

  graph
    .addEdge(START, "hydrate" as never)
    .addEdge("hydrate" as never, "chooseRoute" as never)
    .addConditionalEdges(
      "chooseRoute" as never,
      (state: TurnGraphState) => state.route ?? "OPERATOR",
      {
        CLICK: "click", CAPTURE_DECISION: "captureDecision", RESUME: "resume",
        PROCEDURE: "procedure", DIRECT: "direct", OPERATOR: "operator",
      } as never,
    )
    .addEdge("click" as never, END)
    .addEdge("captureDecision" as never, END)
    // A resumed turn that is still waiting ends; one whose steps are all done runs the original request.
    .addConditionalEdges(
      "resume" as never,
      (state: TurnGraphState) => (state.terminal ? "__end__" : "operator"),
      { __end__: END, operator: "operator" } as never,
    )
    // A closed intent answers here; anything else falls through to the planner, exactly as before.
    .addConditionalEdges(
      "direct" as never,
      (state: TurnGraphState) => (state.terminal ? "__end__" : "operator"),
      { __end__: END, operator: "operator" } as never,
    )
    // A cancelled run composes nothing — the seller stopped it, and a half-answer is not an answer.
    .addConditionalEdges(
      "operator" as never,
      (state: TurnGraphState) => (state.terminal === "UNKNOWN" ? "__end__" : "procedure"),
      { __end__: END, procedure: "procedure" } as never,
    )
    /**
     * The procedure node is reached from two places and they end differently.
     *
     * Before the planner it IS the turn: a procedure that reached a terminal answered, and one that
     * could not load its object hands the turn back to the ordinary lanes — which is what the `if`
     * that used to sit in the direct lane did when it fell through. After the planner it settles the
     * precondition and the composer draws the answer.
     */
    .addConditionalEdges(
      "procedure" as never,
      (state: TurnGraphState) => {
        // The FIRST visit is the pre-plan one; the trail is what distinguishes them, because a node
        // cannot tell where it was entered from and the route must keep saying how this turn started.
        const firstVisit = state.trail.filter((t) => t === "procedure").length <= 1;
        if (state.route !== "PROCEDURE" || !firstVisit) return "compose";
        return state.terminal ? "__end__" : "direct";
      },
      { __end__: END, direct: "direct", compose: "compose" } as never,
    )
    .addEdge("compose" as never, "persist" as never)
    .addEdge("persist" as never, END);

  return graph.compile({ name: "conversation-turn/v1", ...(checkpointer ? { checkpointer } : {}) });
}
