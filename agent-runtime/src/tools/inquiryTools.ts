/**
 * Inquiry capabilities exposed as LangChain Tools.
 *
 * Each tool is a thin adapter onto one Spring endpoint via {@link SpringClient}. No
 * domain logic is re-implemented here — the backend owns the transition, idempotency,
 * and audit; the tool only validates its input (zod) and forwards the call. These are
 * real `@langchain/core` StructuredTools, so an LLM planner could later bind and route
 * them; this slice routes them deterministically from the graph edges instead.
 */
import { tool } from "@langchain/core/tools";
import type { StructuredToolInterface } from "@langchain/core/tools";
import { z } from "zod";
import type { SpringClient } from "../spring/SpringClient";

export const TOOL = {
  SEARCH_UNANSWERED: "search_unanswered_inquiries",
  GET_DETAIL: "get_inquiry_detail",
  PROPOSE_REPLY: "propose_inquiry_reply",
  SAVE_DRAFT: "save_inquiry_reply_draft",
  RECORD_APPROVAL: "record_inquiry_reply_approval",
} as const;

export type ToolName = (typeof TOOL)[keyof typeof TOOL];

/**
 * Build the five inquiry tools bound to a backend client. "Unanswered" is fixed to the
 * OPEN work-item phase inside the search tool — that IS the backend's definition of an
 * inquiry still needing work.
 */
export function buildInquiryTools(client: SpringClient): StructuredToolInterface[] {
  const search = tool(
    async ({ page, size }: { page?: number; size?: number }) =>
      client.listInquiries({ phase: "OPEN", page, size }),
    {
      name: TOOL.SEARCH_UNANSWERED,
      description: "List the seller's unanswered inquiries (OPEN work items), one sanitized page.",
      schema: z.object({
        page: z.number().int().min(0).optional(),
        size: z.number().int().min(1).max(100).optional(),
      }),
    },
  );

  const detail = tool(
    async ({ workItemId }: { workItemId: string }) => client.getInquiryDetail(workItemId),
    {
      name: TOOL.GET_DETAIL,
      description: "Fetch full seller-owned detail for one inquiry work item by id.",
      schema: z.object({ workItemId: z.string().min(1) }),
    },
  );

  const propose = tool(
    async ({ workItemId }: { workItemId: string }) => client.proposeInquiry(workItemId),
    {
      name: TOOL.PROPOSE_REPLY,
      description: "Generate the rule-based reply proposal and move the item OPEN -> PROPOSED (idempotent).",
      schema: z.object({ workItemId: z.string().min(1) }),
    },
  );

  const saveDraft = tool(
    async (args: { workItemId: string; title: string; comments: string; baseVersion: number }) =>
      client.saveDraft(args.workItemId, {
        title: args.title,
        comments: args.comments,
        baseVersion: args.baseVersion,
      }),
    {
      name: TOOL.SAVE_DRAFT,
      description: "Save an append-only reply-draft version on a PROPOSED item; returns the content fingerprint.",
      schema: z.object({
        workItemId: z.string().min(1),
        title: z.string(),
        comments: z.string(),
        baseVersion: z.number().int().min(0),
      }),
    },
  );

  const recordApproval = tool(
    async (args: { workItemId: string; commandId: string; expectedFingerprint: string }) =>
      client.confirmPublish(args.workItemId, {
        commandId: args.commandId,
        expectedFingerprint: args.expectedFingerprint,
      }),
    {
      name: TOOL.RECORD_APPROVAL,
      description:
        "Record the human approval against the exact draft fingerprint (idempotent by commandId). " +
        "The backend binds the approval and creates the ACTION_PENDING intent; with execution disabled " +
        "and no channel adapter it dispatches nothing — no external reply is sent.",
      schema: z.object({
        workItemId: z.string().min(1),
        commandId: z.string().min(1),
        expectedFingerprint: z.string().min(1),
      }),
    },
  );

  return [search, detail, propose, saveDraft, recordApproval];
}
