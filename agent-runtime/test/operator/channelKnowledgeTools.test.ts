/**
 * Channel Knowledge as an Operator capability.
 *
 * Two things are being pinned. First, that adding a whole new knowledge axis did not open a write
 * surface — the axis is documentation about how a channel behaves, and reading documentation must
 * stay reading. Second, that the tools stay OUT of the seller-data planes: a channel fact is the same
 * for every seller on that channel, so these tools take no org, no product and no inquiry, and a
 * schema that accepted one would be the first step toward Channel Knowledge quietly becoming a place
 * seller-specific policy accumulates.
 */
import { describe, expect, it } from "vitest";
import { buildOperatorTools, OPERATOR_TOOL, toolCatalogueFor } from "../../src/operator/tools/OperatorTools";
import { OperatorToolRegistry } from "../../src/operator/tools/OperatorToolRegistry";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";

function catalogue() {
  const operator = new FakeOperatorSpringClient({});
  return buildOperatorTools({
    operator,
    inquiry: {} as never,
    issue: {} as never,
  });
}

const CHANNEL_TOOLS = [
  OPERATOR_TOOL.SEARCH_CHANNEL_KNOWLEDGE,
  OPERATOR_TOOL.GET_CHANNEL_CAPABILITY,
  OPERATOR_TOOL.GET_CONNECTION_GUIDANCE,
];

describe("Channel Knowledge tools", () => {
  it("are in the catalogue and are READ, like everything else in it", () => {
    const registry = new OperatorToolRegistry(catalogue());

    for (const name of CHANNEL_TOOLS) {
      expect(registry.has(name), `${name} is registered`).toBe(true);
      expect(registry.actionClassOf(name)).toBe("READ");
    }
    // The invariant the whole registry exists for, restated after the addition.
    expect(registry.actionClasses()).toEqual(["READ"]);
  });

  it("take no org, product, or inquiry — a platform fact is not seller data", () => {
    const tools = catalogue().filter((t) => CHANNEL_TOOLS.includes(t.tool.name as never));
    expect(tools).toHaveLength(3);

    for (const { tool } of tools) {
      const keys = Object.keys((tool.schema as { shape?: Record<string, unknown> }).shape ?? {});
      for (const forbidden of ["orgId", "productId", "inquiryId", "workItemId", "sellerAccountId"]) {
        expect(keys, `${tool.name} must not accept ${forbidden}`).not.toContain(forbidden);
      }
    }
  });

  it("describe themselves to the planner as channel knowledge, not as seller data", () => {
    const lines = toolCatalogueFor(catalogue())
      .filter((l) => CHANNEL_TOOLS.some((n) => l.startsWith(`${n}:`)));

    expect(lines).toHaveLength(3);
    for (const line of lines) {
      // The planner picks by what a tool ANSWERS. Every one of these must declare the same need, so a
      // goal about the channel routes here and a goal about the seller's own data does not.
      expect(line).toContain("CHANNEL_KNOWLEDGE");
    }
  });

  it("adding them did not make the privileged plane reachable", () => {
    const names = new OperatorToolRegistry(catalogue()).names();

    for (const forbidden of [
      "store_credential",
      "handoff_credentials",
      "start_action_window",
      "trigger_collection",
      "prepare_guided_reply_session",
    ]) {
      expect(names).not.toContain(forbidden);
    }
  });
});
