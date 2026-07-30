/**
 * The runnable façade over the issue-memory graph — a sibling of {@link InquiryAgentRuntime} and
 * {@link ReviewAgentRuntime}, but simpler: this subgraph has no human checkpoint, so a run goes
 * straight from a request to a DONE operations brief. There is no `resume`.
 *
 * Because the run only reads and derives, it is deterministic for a fixed (backend state,
 * referenceDate): calling {@link run} again — in the same process or a fresh one — reproduces the
 * same brief. The optional durable {@link IssueRunStore} persists each brief so that
 * cross-process determinism can be observed (a restarted process re-runs and is checked against
 * the stored brief); the store is not needed to resume anything, because nothing pauses.
 */
import { buildIssueGraph } from "./graph/issueGraph";
import { buildIssueToolRegistry } from "./tools/IssueToolRegistry";
import type { ToolRegistry } from "./tools/ToolRegistry";
import { threadConfig } from "./checkpoint/CheckpointContract";
import { InMemoryIssueRunStore } from "./checkpoint/IssueRunStore";
import type { IssueRunStore } from "./checkpoint/IssueRunStore";
import { parseGoal, routeIntent } from "./goal/parseGoal";
import type { GoalRequest } from "./goal/parseGoal";
import type { IssueOperationsBrief } from "./state/IssueAgentState";
import type { IssueSpringClient } from "./spring/IssueSpringClient";
import { log } from "./log";

export interface IssueRuntimeDeps {
  readonly client: IssueSpringClient;
  /** Defaults to an in-memory store; inject FileIssueRunStore to observe restart determinism. */
  readonly runStore?: IssueRunStore;
}

export interface IssueRunResult {
  readonly status: "DONE";
  readonly brief: IssueOperationsBrief;
  readonly trail: string[];
}

export class IssueAgentRuntime {
  private readonly graph: ReturnType<ReturnType<typeof buildIssueGraph>["compile"]>;
  private readonly registry: ToolRegistry;
  readonly runStore: IssueRunStore;

  constructor(deps: IssueRuntimeDeps) {
    this.registry = buildIssueToolRegistry(deps.client);
    // No checkpointer: there is no interrupt on this path, so nothing to persist mid-run.
    this.graph = buildIssueGraph({ registry: this.registry }).compile();
    this.runStore = deps.runStore ?? new InMemoryIssueRunStore();
  }

  /** Whether this runtime has a recorded brief for the thread (a completed run). */
  async owns(threadId: string): Promise<boolean> {
    return (await this.runStore.load(threadId)) != null;
  }

  /**
   * Run the issue-memory journey to a structured operations brief. Read-only: no interrupt, no
   * backend mutation. Persists the brief to the run store so a re-run can be checked for equality.
   */
  async run(threadId: string, request: GoalRequest): Promise<IssueRunResult> {
    const goal = parseGoal(request);
    if (routeIntent(goal.intent) !== "ISSUE") {
      throw new Error(`IssueAgentRuntime cannot handle intent ${goal.intent}`);
    }
    const final = (await this.graph.invoke({ goal }, threadConfig(threadId))) as {
      brief?: IssueOperationsBrief | null;
      trail?: string[];
    };
    const brief = final.brief ?? emptyBrief(goal.referenceDate ?? null);
    const trail = final.trail ?? [];
    await this.runStore.save({
      threadId,
      status: "DONE",
      referenceDate: brief.referenceDate,
      brief,
      trail,
    });
    log("issue_run_done", {
      totalActive: brief.totalActiveIssues,
      selected: brief.selectedCount,
    });
    return { status: "DONE", brief, trail };
  }
}

function emptyBrief(referenceDate: string | null): IssueOperationsBrief {
  return { referenceDate, totalActiveIssues: 0, selectedCount: 0, entries: [], note: "no brief produced" };
}
