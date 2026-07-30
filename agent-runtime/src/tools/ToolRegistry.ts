/**
 * Tool registry — the runtime's catalog of callable capabilities.
 *
 * A minimal, explicit registry over LangChain StructuredTools: look a tool up by name,
 * enumerate the catalog, and invoke by name with validated args. It is the single place
 * the graph resolves a capability, and the seam an LLM planner would enumerate to route.
 * Unknown names fail loudly (fail closed) rather than silently no-op.
 */
import type { StructuredToolInterface } from "@langchain/core/tools";
import { buildInquiryTools } from "./inquiryTools";
import type { SpringClient } from "../spring/SpringClient";

export class UnknownToolError extends Error {
  constructor(name: string) {
    super(`unknown tool: ${name}`);
    this.name = "UnknownToolError";
  }
}

export class ToolRegistry {
  private readonly byName: Map<string, StructuredToolInterface>;

  constructor(tools: readonly StructuredToolInterface[]) {
    this.byName = new Map();
    for (const t of tools) {
      if (this.byName.has(t.name)) {
        throw new Error(`duplicate tool name: ${t.name}`);
      }
      this.byName.set(t.name, t);
    }
  }

  names(): string[] {
    return [...this.byName.keys()].sort();
  }

  has(name: string): boolean {
    return this.byName.has(name);
  }

  get(name: string): StructuredToolInterface {
    const t = this.byName.get(name);
    if (!t) throw new UnknownToolError(name);
    return t;
  }

  /** Invoke a tool by name with plain args; returns the tool's structured result. */
  async invoke<T = unknown>(name: string, args: Record<string, unknown>): Promise<T> {
    return (await this.get(name).invoke(args)) as T;
  }
}

/** The inquiry tool registry bound to a backend client. */
export function buildInquiryToolRegistry(client: SpringClient): ToolRegistry {
  return new ToolRegistry(buildInquiryTools(client));
}
