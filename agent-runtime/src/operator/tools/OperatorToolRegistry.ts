/**
 * The Operator's registry — a catalogue that ENFORCES the action classes rather than documenting them.
 *
 * Three refusals, all at the earliest moment they can happen:
 *
 * 1. <b>A WRITE tool cannot be registered.</b> Construction throws. So "the Operator has no write
 *    capability" is a property of the object graph, not of a runtime branch that could be taken the
 *    other way, and it fails at boot rather than mid-run.
 * 2. <b>An unknown tool name cannot be invoked.</b> A planner that hallucinates a name gets a loud
 *    error before any call, which is what makes it safe to let a model choose names at all.
 * 3. <b>A tool outside the current plan cannot be invoked.</b> The plan is the authorization; a
 *    specialist reaching past it would make the plan advisory.
 *
 * It wraps {@link ToolRegistry} rather than replacing it — the inquiry, review and issue registries
 * stay exactly as they were, which is why adding the Operator changed none of their tests.
 */
import { ToolRegistry } from "../../tools/ToolRegistry";
import type { ActionClass } from "../state/OperatorState";
import type { ClassifiedTool } from "./OperatorTools";
import { log } from "../../log";

export class WriteToolRefusedError extends Error {
  constructor(name: string) {
    super(
      `refused to register WRITE tool "${name}": the Operator has no external write capability in v1 `
        + `(docs/sellerops_operator_graph_v1.md §3)`,
    );
    this.name = "WriteToolRefusedError";
  }
}

export class ToolNotInPlanError extends Error {
  constructor(name: string) {
    super(`tool "${name}" is not in this run's plan`);
    this.name = "ToolNotInPlanError";
  }
}

export class OperatorToolRegistry {
  private readonly registry: ToolRegistry;
  private readonly classes = new Map<string, ActionClass>();

  constructor(tools: readonly ClassifiedTool[]) {
    for (const entry of tools) {
      if (entry.actionClass === "WRITE") {
        throw new WriteToolRefusedError(entry.tool.name);
      }
      this.classes.set(entry.tool.name, entry.actionClass);
    }
    this.registry = new ToolRegistry(tools.map((t) => t.tool));
  }

  names(): string[] {
    return this.registry.names();
  }

  has(name: string): boolean {
    return this.registry.has(name);
  }

  actionClassOf(name: string): ActionClass | undefined {
    return this.classes.get(name);
  }

  /** Every action class present in the catalogue — the shape the structural test asserts on. */
  actionClasses(): ActionClass[] {
    return [...new Set(this.classes.values())].sort();
  }

  /**
   * Invoke by name.
   *
   * `allowed` is the plan's tool list. Passing it is not optional in practice — the graph always has a
   * plan — but it is nullable so that a specialist running a fixed, hard-coded sequence (which is its
   * own authorization) does not have to synthesize one.
   */
  async invoke<T = unknown>(
    name: string,
    args: Record<string, unknown>,
    allowed?: readonly string[],
  ): Promise<T> {
    if (allowed && !allowed.includes(name)) {
      throw new ToolNotInPlanError(name);
    }
    // Unknown names raise UnknownToolError from the inner registry — fail closed, never a silent no-op.
    // Timed here because this is the one choke point every specialist's read passes through: the
    // latency breakdown (`operator_stage` + this line) is assembled from the existing log, not a tracer.
    const started = Date.now();
    try {
      const value = await this.registry.invoke<T>(name, args);
      log("operator_tool_call", { tool: name, ms: Date.now() - started, ok: true });
      return value;
    } catch (err) {
      log("operator_tool_call", { tool: name, ms: Date.now() - started, ok: false });
      throw err;
    }
  }
}
