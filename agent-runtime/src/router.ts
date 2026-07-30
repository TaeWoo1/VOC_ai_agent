/**
 * The goal router — how the inquiry and review subgraphs coexist.
 *
 * A single entry point parses an operator request into a goal, maps the goal's intent onto
 * a subgraph domain ({@link routeIntent}), and dispatches to the matching runtime. The two
 * runtimes are otherwise independent — separate graphs, tools, checkpoint contracts, and
 * durable stores — so neither can perturb the other; the router only decides which one runs.
 *
 * `start` routes a fresh goal. `resume` routes by the domain the router recorded for that
 * thread when it started (the in-process case). A cross-process restart resumes against the
 * domain-specific runtime directly (the CLI knows its domain), which is why both runtimes
 * are exposed.
 */
import { InquiryAgentRuntime } from "./runtime";
import type { RunResult } from "./runtime";
import { ReviewAgentRuntime } from "./reviewRuntime";
import type { ReviewRunResult } from "./reviewRuntime";
import { parseGoal, routeIntent } from "./goal/parseGoal";
import type { AgentDomain, GoalRequest } from "./goal/parseGoal";
import type { ReviewCheckpointDecision } from "./checkpoint/ReviewCheckpointContract";
import { log } from "./log";

export type RouterRunResult =
  | { readonly domain: "INQUIRY"; readonly result: RunResult }
  | { readonly domain: "REVIEW"; readonly result: ReviewRunResult };

export interface AgentRouterDeps {
  readonly inquiry: InquiryAgentRuntime;
  readonly review: ReviewAgentRuntime;
}

export class UnknownThreadError extends Error {
  constructor(threadId: string) {
    super(`no domain recorded for thread: ${threadId}`);
    this.name = "UnknownThreadError";
  }
}

export class AgentRouter {
  readonly inquiry: InquiryAgentRuntime;
  readonly review: ReviewAgentRuntime;
  private readonly threadDomain = new Map<string, AgentDomain>();

  constructor(deps: AgentRouterDeps) {
    this.inquiry = deps.inquiry;
    this.review = deps.review;
  }

  /** The domain a request routes to, without running anything (pure aside from parsing). */
  route(request: GoalRequest): AgentDomain {
    return routeIntent(parseGoal(request).intent);
  }

  /** Parse + route + start on the matching runtime. */
  async start(threadId: string, request: GoalRequest): Promise<RouterRunResult> {
    const domain = this.route(request);
    this.threadDomain.set(threadId, domain);
    log("router_start", { domain });
    if (domain === "REVIEW") {
      return { domain, result: await this.review.start(threadId, request) };
    }
    return { domain, result: await this.inquiry.start(threadId, request) };
  }

  /**
   * Resume by the domain the router recorded for this thread on `start`. The decision shape
   * ({approved, approvedBy}) is accepted by both runtimes. For a cross-process restart (no
   * recorded domain) resume against the domain-specific runtime directly.
   */
  async resume(threadId: string, decision: ReviewCheckpointDecision): Promise<RouterRunResult> {
    const domain = this.threadDomain.get(threadId);
    if (!domain) throw new UnknownThreadError(threadId);
    if (domain === "REVIEW") {
      return { domain, result: await this.review.resume(threadId, decision) };
    }
    return { domain, result: await this.inquiry.resume(threadId, decision) };
  }
}
