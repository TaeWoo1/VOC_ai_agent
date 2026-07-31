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
import { InquiryDraftAgentRuntime } from "./inquiryDraftRuntime";
import type { InquiryDraftRunResult } from "./inquiryDraftRuntime";
import { ReviewAgentRuntime } from "./reviewRuntime";
import type { ReviewRunResult } from "./reviewRuntime";
import { IssueAgentRuntime } from "./issueRuntime";
import type { IssueRunResult } from "./issueRuntime";
import { parseGoal, routeIntent } from "./goal/parseGoal";
import type { AgentDomain, GoalRequest } from "./goal/parseGoal";
import type { CheckpointDecision } from "./checkpoint/CheckpointContract";
import { log } from "./log";

export type RouterRunResult =
  | { readonly domain: "INQUIRY"; readonly result: RunResult }
  | { readonly domain: "INQUIRY_DRAFT"; readonly result: InquiryDraftRunResult }
  | { readonly domain: "REVIEW"; readonly result: ReviewRunResult }
  | { readonly domain: "ISSUE"; readonly result: IssueRunResult };

export interface AgentRouterDeps {
  readonly inquiry: InquiryAgentRuntime;
  readonly inquiryDraft: InquiryDraftAgentRuntime;
  readonly review: ReviewAgentRuntime;
  readonly issue: IssueAgentRuntime;
}

export class UnknownThreadError extends Error {
  constructor(threadId: string) {
    super(`no domain recorded for thread: ${threadId}`);
    this.name = "UnknownThreadError";
  }
}

export class AgentRouter {
  readonly inquiry: InquiryAgentRuntime;
  readonly inquiryDraft: InquiryDraftAgentRuntime;
  readonly review: ReviewAgentRuntime;
  readonly issue: IssueAgentRuntime;
  private readonly threadDomain = new Map<string, AgentDomain>();

  constructor(deps: AgentRouterDeps) {
    this.inquiry = deps.inquiry;
    this.inquiryDraft = deps.inquiryDraft;
    this.review = deps.review;
    this.issue = deps.issue;
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
    if (domain === "ISSUE") {
      // The issue-memory subgraph has no checkpoint: it runs straight to a DONE brief here.
      return { domain, result: await this.issue.run(threadId, request) };
    }
    if (domain === "INQUIRY_DRAFT") {
      // Draft preparation has no checkpoint either: it runs straight to a DONE draft.
      return { domain, result: await this.inquiryDraft.run(threadId, request) };
    }
    return { domain, result: await this.inquiry.start(threadId, request) };
  }

  /**
   * Resume by the domain the router recorded for this thread on `start`. The decision type is
   * the inquiry superset ({approved, approvedBy, editedTitle?, editedComments?}); the review
   * runtime uses only {approved, approvedBy} and ignores the rest, so one signature serves
   * both without narrowing the inquiry runtime's edit capability. For a cross-process restart
   * (no recorded domain) resume against the domain-specific runtime directly.
   *
   * The ISSUE domain never pauses (no checkpoint), so there is nothing to resume — resuming an
   * issue thread is a caller error, not a silent no-op.
   */
  async resume(threadId: string, decision: CheckpointDecision): Promise<RouterRunResult> {
    const domain = this.threadDomain.get(threadId);
    if (!domain) throw new UnknownThreadError(threadId);
    if (domain === "ISSUE") {
      throw new Error(
        `thread ${threadId} is an issue-memory run: it has no checkpoint to resume. Start again to refresh the brief.`,
      );
    }
    if (domain === "INQUIRY_DRAFT") {
      throw new Error(
        `thread ${threadId} is a draft-preparation run: it has no checkpoint to resume. Start again to prepare a fresh draft.`,
      );
    }
    if (domain === "REVIEW") {
      return { domain, result: await this.review.resume(threadId, decision) };
    }
    return { domain, result: await this.inquiry.resume(threadId, decision) };
  }
}
