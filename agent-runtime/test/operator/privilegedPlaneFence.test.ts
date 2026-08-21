/**
 * The privileged plane is not reachable from the Operator — asserted on the catalogue itself.
 *
 * <b>Why by NAME rather than by behaviour.</b> There is no test that can prove "the agent will never
 * mint a guided-submission ref", because the agent chooses its own tools; what CAN be proved is that no
 * such tool exists for it to choose. That is the same argument
 * {@code OperatorToolRegistry.WriteToolRefusedError} makes structurally for WRITE, extended to the
 * capabilities that are technically READ-ish but are the ENTRANCE to a human's marketplace action.
 */
import { describe, expect, it } from "vitest";
import { buildOperatorTools, OPERATOR_TOOL } from "../../src/operator/tools/OperatorTools";
import { OperatorToolRegistry } from "../../src/operator/tools/OperatorToolRegistry";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { fourIssues } from "../support/issueFixtures";

function registry(): OperatorToolRegistry {
  return new OperatorToolRegistry(buildOperatorTools({
    operator: new FakeOperatorSpringClient(),
    inquiry: new FakeSpringClient(twoInquiries()),
    issue: new FakeIssueSpringClient(fourIssues()),
  }));
}

/**
 * Substrings that must not appear in any Operator tool name.
 *
 * Each one is a real capability that exists elsewhere in this repository and is deliberately out of
 * reach here: guided submission (mints the single-use ref that begins a human's marketplace post),
 * credentials (the vault and every handoff), the Action Window (the browser carrier), and collection
 * triggers (an unattended sync).
 */
const FORBIDDEN = [
  "submission", "guided", "credential", "vault", "handoff", "action_window", "actionwindow",
  "collect", "sync", "send", "publish", "approve", "reply_publish", "pairing",
];

describe("privileged plane fence", () => {
  it("no tool name touches the privileged plane", () => {
    const names = registry().names();
    for (const name of names) {
      for (const forbidden of FORBIDDEN) {
        expect(name.toLowerCase(), `tool "${name}" names a privileged capability`)
          .not.toContain(forbidden);
      }
    }
  });

  it("the catalogue is exactly the declared table", () => {
    // A tool added without a name in OPERATOR_TOOL would be a tool nobody can refuse by name in a plan.
    expect(registry().names().sort()).toEqual(Object.values(OPERATOR_TOOL).sort());
  });

  it("every action class in the catalogue is READ", () => {
    expect(registry().actionClasses()).toEqual(["READ"]);
  });
});
