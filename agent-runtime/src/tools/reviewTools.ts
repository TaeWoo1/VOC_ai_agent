/**
 * Review-reply capabilities exposed as LangChain Tools.
 *
 * Each tool is a thin adapter onto ONE existing Spring review-reply endpoint via
 * {@link ReviewSpringClient}. No domain logic is re-implemented — the backend owns the
 * version binding, approval idempotency, the single-use submission ref, and audit; a tool
 * only validates its input (zod) and forwards the call. These are real `@langchain/core`
 * StructuredTools, so an LLM planner could later bind and route them; this slice routes
 * them deterministically from the graph edges.
 *
 * <b>There is no send tool, and there can be no send tool</b> — the review-reply surface
 * has no send endpoint. The most powerful tool here mints a single-use guided-submission
 * ref and stops; SellerOps guides and observes, the operator posts.
 */
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { ReviewSpringClient } from "../spring/ReviewSpringClient";

export const REVIEW_TOOL = {
  SEARCH_NEEDING_REPLY: "search_reviews_needing_reply",
  GET_PREP: "get_review_reply_prep",
  SAVE_DRAFT: "save_review_reply_draft",
  APPROVE: "approve_review_reply",
  PREPARE_GUIDED_SESSION: "prepare_guided_reply_session",
} as const;

export type ReviewToolName = (typeof REVIEW_TOOL)[keyof typeof REVIEW_TOOL];

export function buildReviewTools(client: ReviewSpringClient): StructuredToolInterface[] {
  const search = tool(
    async ({ accountId, todoLimit }: { accountId: string; todoLimit?: number }) =>
      client.listReplyWork(accountId, { todoLimit }),
    {
      name: REVIEW_TOOL.SEARCH_NEEDING_REPLY,
      description:
        "List the reviews the operator has triaged 대응 필요 (RESPONSE_NEEDED) for one account — the reply worklist. Metadata only; no review body.",
      schema: z.object({
        accountId: z.string().min(1),
        todoLimit: z.number().int().min(1).max(50).optional(),
      }),
    },
  );

  const prep = tool(
    async ({ accountId, actionRef }: { accountId: string; actionRef: string }) =>
      client.getReviewReplyPrep(accountId, actionRef),
    {
      name: REVIEW_TOOL.GET_PREP,
      description:
        "Fetch the full reply-preparation context for one review (redacted body, rule-based suggestion, current draft, current approval, capabilities).",
      schema: z.object({ accountId: z.string().min(1), actionRef: z.string().min(1) }),
    },
  );

  const saveDraft = tool(
    async (args: { accountId: string; actionRef: string; body: string; baseVersion: number }) =>
      client.saveReviewDraft(args.accountId, args.actionRef, {
        body: args.body,
        baseVersion: args.baseVersion,
      }),
    {
      name: REVIEW_TOOL.SAVE_DRAFT,
      description:
        "Save an append-only reply-draft version for a RESPONSE_NEEDED review; returns the version + content fingerprint.",
      schema: z.object({
        accountId: z.string().min(1),
        actionRef: z.string().min(1),
        body: z.string(),
        baseVersion: z.number().int().min(0),
      }),
    },
  );

  const approve = tool(
    async (args: { accountId: string; actionRef: string; commandId: string; baseVersion: number }) =>
      client.decideReviewApproval(args.accountId, args.actionRef, {
        commandId: args.commandId,
        state: "APPROVED",
        baseVersion: args.baseVersion,
      }),
    {
      name: REVIEW_TOOL.APPROVE,
      description:
        "Record the human approval of an exact draft version (idempotent by commandId). Freezes the text and binds the version+fingerprint; it authorizes NO send.",
      schema: z.object({
        accountId: z.string().min(1),
        actionRef: z.string().min(1),
        commandId: z.string().min(1),
        baseVersion: z.number().int().min(1),
      }),
    },
  );

  const prepareGuided = tool(
    async (args: { accountId: string; actionRef: string; requireTargetHint?: boolean }) =>
      client.startReviewSubmissionRun(args.accountId, args.actionRef, {
        requireTargetHint: args.requireTargetHint ?? true,
      }),
    {
      name: REVIEW_TOOL.PREPARE_GUIDED_SESSION,
      description:
        "Mint a single-use, privacy-safe guided reply-submission ref bound to the approved head (the prepared guided reply session). It does NOT send — the operator performs the guided post.",
      schema: z.object({
        accountId: z.string().min(1),
        actionRef: z.string().min(1),
        requireTargetHint: z.boolean().optional(),
      }),
    },
  );

  return [search, prep, saveDraft, approve, prepareGuided];
}
