/**
 * The structural half of "the Operator cannot write".
 *
 * v1's decision is that WRITE capability is not implemented — not disabled, not flagged off, not
 * present. That is only meaningful if something checks it, and a comment is not something. These tests
 * assert three things a future edit would have to defeat on purpose:
 *
 * 1. the catalogue contains no WRITE tool;
 * 2. the registry REFUSES to be built with one, so adding a write tool fails at boot rather than in a run;
 * 3. the privileged plane is absent from the catalogue entirely — no credential handoff, no Action
 *    Window command, no guided-submission mint, no collection trigger.
 */
import { describe, expect, it } from "vitest";
import {
  OperatorToolRegistry,
  ToolNotInPlanError,
  WriteToolRefusedError,
} from "../../src/operator/tools/OperatorToolRegistry";
import { buildOperatorTools, OPERATOR_TOOL } from "../../src/operator/tools/OperatorTools";
import { UnknownToolError } from "../../src/tools/ToolRegistry";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { fourIssues } from "../support/issueFixtures";
import { tool } from "@langchain/core/tools";
import { z } from "zod";

function catalogue() {
  return buildOperatorTools({
    operator: new FakeOperatorSpringClient(),
    inquiry: new FakeSpringClient(twoInquiries()),
    issue: new FakeIssueSpringClient(fourIssues()),
  });
}

describe("Operator tool registry — the WRITE fence", () => {
  it("the whole catalogue is READ; there is no WRITE tool", () => {
    const registry = new OperatorToolRegistry(catalogue());

    expect(registry.actionClasses()).toEqual(["READ"]);
    for (const name of registry.names()) {
      expect(registry.actionClassOf(name), `${name} must be READ`).toBe("READ");
    }
  });

  it("refuses to register a WRITE tool at construction, not at call time", () => {
    const sendReply = {
      actionClass: "WRITE" as const,
      tool: tool(async () => "sent", {
        name: "send_inquiry_reply",
        description: "the tool v1 does not have",
        schema: z.object({}),
      }),
    };

    expect(() => new OperatorToolRegistry([...catalogue(), sendReply]))
      .toThrow(WriteToolRefusedError);
  });

  it("the privileged plane is not in the catalogue at all", () => {
    const names = new OperatorToolRegistry(catalogue()).names();

    // Each of these exists somewhere in the product and is deliberately unreachable from here: the
    // Operator selects its own tools, so anything listed is something it could decide to do unattended.
    for (const forbidden of [
      "prepare_guided_reply_session", // mints a single-use submission ref — a human's marketplace entrance
      "send_inquiry_reply",
      "submit_review_reply",
      "store_credential",
      "handoff_credentials",
      "start_action_window",
      "trigger_collection",
      "delete_api_key",
    ]) {
      expect(names, `${forbidden} must not be reachable by the Operator`).not.toContain(forbidden);
    }
  });

  it("an unknown tool name fails loudly instead of silently doing nothing", async () => {
    const registry = new OperatorToolRegistry(catalogue());

    await expect(registry.invoke("summon_a_tool_that_does_not_exist", {}))
      .rejects.toBeInstanceOf(UnknownToolError);
  });

  it("a tool outside the run's plan is refused — the plan IS the authorization", async () => {
    const registry = new OperatorToolRegistry(catalogue());

    await expect(
      registry.invoke(OPERATOR_TOOL.GET_INQUIRY_DETAIL, { workItemId: "w-1" }, [OPERATOR_TOOL.GET_TODAY_INBOX]),
    ).rejects.toBeInstanceOf(ToolNotInPlanError);
  });
});
