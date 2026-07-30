/**
 * The review-issue-memory tool registry bound to a backend client. Reuses the shared
 * {@link ToolRegistry} so the issue subgraph resolves capabilities exactly like the inquiry
 * and review subgraphs do.
 */
import { ToolRegistry } from "./ToolRegistry";
import { buildIssueTools } from "./issueTools";
import type { IssueSpringClient } from "../spring/IssueSpringClient";

export function buildIssueToolRegistry(client: IssueSpringClient): ToolRegistry {
  return new ToolRegistry(buildIssueTools(client));
}
