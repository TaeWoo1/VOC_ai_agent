/**
 * <b>What LangGraph owns after the migration — pinned, because the old shape can grow back.</b>
 *
 * LangGraph Orchestration Migration + AOP Runtime Core v1 §2/§7. The migration moved control flow and
 * nothing else: which phase runs next, where a turn stops, what a resume continues. The risk it
 * carries is not that an answer changes today — the whole suite says it did not — but that a later
 * edit puts a second `if` chain back beside the graph and the graph slowly becomes decoration.
 *
 * So these are mostly source scans and shape assertions:
 *   §A  the turn has ONE driver, and it is the graph
 *   §B  the graph's nodes are the phases, and every phase is a method
 *   §C  the checkpoint carries ids and closed tokens — never a token, a body or an artifact
 *   §D  procedure selection happens in the graph's own node, through the AOP router
 */
import { describe, expect, it } from "vitest";
import { readFileSync } from "node:fs";
import { join } from "node:path";
import { buildTurnGraph } from "../../src/conversation/graph/turnGraph";
import { TurnStateAnnotation } from "../../src/conversation/graph/TurnState";

const SRC = join(__dirname, "../../src");
const read = (p: string) => readFileSync(join(SRC, p), "utf8");
/** Docblocks quote the shapes they replaced; the property being pinned is about the code. */
const code = (p: string) => read(p).replace(/\/\*[\s\S]*?\*\//g, "").replace(/^\s*\/\/.*$/gm, "");

const SERVICE = code("conversation/ConversationService.ts");
const GRAPH = code("conversation/graph/turnGraph.ts");

describe("§A — one driver", () => {
  it("`turnNow` invokes the graph and does nothing else with the turn", () => {
    const body = SERVICE.slice(SERVICE.indexOf("private async turnNow("), SERVICE.indexOf("private async phaseHydrate("));
    expect(body).toContain("this.turnGraph.invoke");
    // The phases are reached THROUGH the graph. A driver that called them in order would be a second
    // orchestration wearing the first one's method names.
    for (const phase of ["phaseRoute(", "phaseDirect(", "phaseOperator(", "phaseCompose("]) {
      expect(body, `turnNow must not call ${phase} itself`).not.toContain(phase);
    }
  });

  it("every phase is called from exactly one place — the graph's node table", () => {
    const phases = ["phaseHydrate", "phaseRoute", "phaseClick", "phaseCaptureDecision", "phaseResume",
      "phaseDirect", "phaseOperator", "phaseProcedure", "phaseCompose", "phasePersist"];
    for (const phase of phases) {
      const calls = SERVICE.split(`this.${phase}(`).length - 1;
      expect(calls, `${phase} call sites`).toBe(1);
    }
  });
});

describe("§B — the graph is the turn", () => {
  it("has a node for each phase and the routing table names all five shapes", async () => {
    const noop = async () => ({});
    const graph = buildTurnGraph({
      hydrate: noop, route: async () => "OPERATOR" as const, click: noop, captureDecision: noop,
      resume: async () => ({ done: false, update: {} }), direct: async () => ({ handled: false, update: {} }),
      operator: noop, procedure: noop, compose: noop, persist: noop,
    });
    const nodes = Object.keys((await graph.getGraphAsync()).nodes);
    for (const name of ["hydrate", "chooseRoute", "click", "captureDecision", "resume", "direct",
      "operator", "procedure", "compose", "persist"]) {
      expect(nodes).toContain(name);
    }
  });

  it("routes a plain sentence through operator → procedure → compose → persist", async () => {
    const trail: string[] = [];
    const mark = (name: string) => async () => { trail.push(name); return {}; };
    const graph = buildTurnGraph({
      hydrate: mark("hydrate"), route: async () => "OPERATOR" as const,
      click: mark("click"), captureDecision: mark("captureDecision"),
      resume: async () => ({ done: false, update: {} }),
      direct: async () => ({ handled: false, update: {} }),
      operator: mark("operator"), procedure: mark("procedure"), compose: mark("compose"), persist: mark("persist"),
    });
    const out = await graph.invoke({} as never);
    expect(trail).toEqual(["hydrate", "operator", "procedure", "compose", "persist"]);
    expect(out.trail).toEqual(["hydrate", "chooseRoute", "operator", "procedure", "compose", "persist"]);
  });

  it("a closed intent ends the turn without reaching the planner", async () => {
    const trail: string[] = [];
    const mark = (name: string) => async () => { trail.push(name); return {}; };
    const graph = buildTurnGraph({
      hydrate: mark("hydrate"), route: async () => "DIRECT" as const,
      click: mark("click"), captureDecision: mark("captureDecision"),
      resume: async () => ({ done: false, update: {} }),
      direct: async () => { trail.push("direct"); return { handled: true, update: {} }; },
      operator: mark("operator"), procedure: mark("procedure"), compose: mark("compose"), persist: mark("persist"),
    });
    await graph.invoke({} as never);
    expect(trail).toEqual(["hydrate", "direct"]);
  });

  it("a resume that is still waiting is the whole turn", async () => {
    const trail: string[] = [];
    const mark = (name: string) => async () => { trail.push(name); return {}; };
    const graph = buildTurnGraph({
      hydrate: mark("hydrate"), route: async () => "RESUME" as const,
      click: mark("click"), captureDecision: mark("captureDecision"),
      resume: async () => { trail.push("resume"); return { done: true, update: {} }; },
      direct: async () => ({ handled: false, update: {} }),
      operator: mark("operator"), procedure: mark("procedure"), compose: mark("compose"), persist: mark("persist"),
    });
    const out = await graph.invoke({} as never);
    expect(trail).toEqual(["hydrate", "resume"]);
    expect(out.terminal).toBe("WAITING_HUMAN");
  });

  it("a resume whose steps are all done runs the original request", async () => {
    const trail: string[] = [];
    const mark = (name: string) => async () => { trail.push(name); return {}; };
    const graph = buildTurnGraph({
      hydrate: mark("hydrate"), route: async () => "RESUME" as const,
      click: mark("click"), captureDecision: mark("captureDecision"),
      resume: async () => { trail.push("resume"); return { done: false, update: {} }; },
      direct: async () => ({ handled: false, update: {} }),
      operator: mark("operator"), procedure: mark("procedure"), compose: mark("compose"), persist: mark("persist"),
    });
    await graph.invoke({} as never);
    expect(trail).toEqual(["hydrate", "resume", "operator", "procedure", "compose", "persist"]);
  });
});

describe("§C — the checkpoint is an execution cursor, not a second source of truth", () => {
  it("the state schema holds only ids, closed tokens and a trail", () => {
    expect(Object.keys(TurnStateAnnotation.spec).sort()).toEqual([
      "absence", "conversationId", "interrupt", "procedureId", "procedureVersion",
      "readiness", "route", "terminal", "trail", "turnId",
    ]);
  });

  it("the graph module never touches a token, a body or an artifact", () => {
    // Word boundaries, because `configurable` and `TurnContext` legitimately contain some of these.
    for (const forbidden of ["token", "artifact", "body", "draft", "approval", "text", "message"]) {
      expect(GRAPH, `turnGraph must not name ${forbidden}`).not.toMatch(new RegExp(`\\b${forbidden}\\b`, "i"));
    }
  });

  it("no checkpointer is attached in-process, and the reason is written down", () => {
    // The conversation IS the durable state, and `ConversationStore` has owned it since before this
    // migration. A second durable store for the same facts is the disagreement §5 prevents.
    expect(SERVICE).toContain("buildTurnGraph({");
    expect(SERVICE.slice(SERVICE.indexOf("buildTurnGraph({"), SERVICE.indexOf("async create(")))
      .not.toContain("checkpointer");
  });
});

describe("§D — procedure selection is the graph's, through the AOP router", () => {
  it("the router is called from the procedure node and nowhere else in the service", () => {
    expect(SERVICE.split("selectProcedure(").length - 1).toBe(1);
    const node = SERVICE.slice(SERVICE.indexOf("private async phaseProcedure("), SERVICE.indexOf("private async phaseCompose("));
    expect(node).toContain("selectProcedure(");
    expect(node).toContain("operationalPrecondition(");
    // The node settles a verdict; it does not write a sentence. Composition stays where it lives.
    expect(node).not.toContain("absenceSentence(");
  });
});
