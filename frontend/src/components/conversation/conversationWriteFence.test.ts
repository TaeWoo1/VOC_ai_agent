import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * The conversation is READ + one seller-pressed collection + the approval modules (Agentic Operating
 * Workspace v2 §3-B). Everything under `components/conversation/**` and `lib/conversation/**` must
 * hold no path to a marketplace write — checked by name, the way `agentPanelWriteFence.test.ts` does.
 *
 * Guided Reply UX Smoothing v1 §1 widened the exception list by ONE module and one word:
 * `artifacts/ReplyApprovalArtifact.tsx` may name `decideReviewReplyApproval`, the review-reply approval
 * seam. That is deliberate, and it does not weaken what this fence protects:
 *
 * - **Approval is not a marketplace write.** It records a human decision against an exact draft
 *   version, in reviewnary's own store. Nothing leaves for a channel; the send/execute/mint words stay
 *   where they were, each in exactly one module.
 * - **Only a press can reach it.** The runtime that composes the card has no path to the approval seam
 *   at all (`agent-runtime` asserts that on its own source), so no sentence, plan or model output can
 *   approve anything. The call is made by the seller's click, in the browser.
 * - **Each module still names only its own write.** The approval module may not mint a run; the guided
 *   module may not approve. The per-file allow-list below is what enforces that.
 */
const FORBIDDEN = [
  "confirmInquiryPublish",
  "resumeInquiryPublish",
  "verifyInquiryPublish",
  "decideReviewReplyApproval",
  "executeReviewReply",
  "startReviewReplySubmissionRun",
  "startReplySubmission",
  "replyRuntime",
  "useReplyRuntime",
  "startReviewAcquisitionRun",
  "useGuidedAcquisition",
  "acquireRuntime",
  "manualSync",
];

/**
 * Exactly four modules may name a write or a run start, each its own set: the send approval (inquiry
 * publish · Cafe24 review execute), the in-chat reply approval (the review-reply approval seam, and
 * nothing else), the guided execution (submission-run mint · the reply runtime) and the human action
 * (seller-pressed collection · guided acquisition start).
 */
const ALLOWED: Record<string, readonly string[]> = {
  "artifacts/ApprovalArtifact.tsx": ["confirmInquiryPublish", "executeReviewReply"],
  "artifacts/ReplyApprovalArtifact.tsx": ["decideReviewReplyApproval"],
  "artifacts/GuidedExecutionArtifact.tsx": ["startReviewReplySubmissionRun", "startReplySubmission", "replyRuntime", "useReplyRuntime"],
  "artifacts/HumanActionArtifact.tsx": ["manualSync", "startReviewAcquisitionRun", "useGuidedAcquisition", "acquireRuntime"],
};

function walk(dir: string): string[] {
  return readdirSync(dir).flatMap((name) => {
    const full = join(dir, name);
    if (statSync(full).isDirectory()) return walk(full);
    return /\.(ts|tsx)$/.test(name) && !/\.test\.tsx?$/.test(name) ? [full] : [];
  });
}

const ROOTS = [resolve(__dirname), resolve(__dirname, "../../lib/conversation")];

describe("conversation write fence", () => {
  it("no conversation file reaches a write except the three named modules", () => {
    const files = ROOTS.flatMap(walk);
    expect(files.length).toBeGreaterThan(10);
    for (const file of files) {
      const rel = relative(resolve(__dirname), file);
      const src = readFileSync(file, "utf8");
      const allowed = Object.entries(ALLOWED).find(([suffix]) => rel.endsWith(suffix))?.[1] ?? [];
      for (const word of FORBIDDEN) {
        if (allowed.includes(word)) continue;
        expect(src, `${rel} mentions ${word}`).not.toContain(word);
      }
    }
  });

  it("the in-chat reply approval module names the approval seam and NOTHING that sends", () => {
    const approval = readFileSync(resolve(__dirname, "artifacts/ReplyApprovalArtifact.tsx"), "utf8");
    expect(approval).toContain("decideReviewReplyApproval");
    // It may approve. It may not send, execute, mint a run, or drive the helper — those live in the
    // two modules beside it, and the guided lane is reached by RENDERING that module, not by calling in.
    for (const word of ["confirmInquiryPublish", "executeReviewReply", "startReviewReplySubmissionRun", "startReplySubmission", "useReplyRuntime", "recordReviewReplyOutcome"]) {
      expect(approval, `the reply approval module must not name ${word}`).not.toContain(word);
    }
    // Approving is never described as sending — the card exists because 승인 is not 등록.
    expect(approval).not.toMatch(/>\s*(보내기|전송하기|등록하기|발송)\s*</);
  });

  it("the reply approval module writes only against the review it was given", () => {
    const approval = readFileSync(resolve(__dirname, "artifacts/ReplyApprovalArtifact.tsx"), "utf8");
    // Both calls are (accountId, actionRef) destructured from THIS artifact — never an id from a list,
    // a URL or another card. Object continuity is a shape here, not a convention.
    expect(approval).toContain("const { accountId, actionRef } = artifact;");
    expect(approval).toContain("api.decideReviewReplyApproval(accountId, actionRef,");
  });

  it("the approval module is the only one that names the publish call", () => {
    const approval = readFileSync(resolve(__dirname, "artifacts/ApprovalArtifact.tsx"), "utf8");
    expect(approval).toContain("confirmInquiryPublish");
    expect(approval).toContain("executeReviewReply");
    expect(approval).not.toContain("resumeInquiryPublish");
    expect(approval).not.toContain("verifyInquiryPublish");
  });

  it("the guided execution module never renders a submit control and never clicks one", () => {
    const guided = readFileSync(resolve(__dirname, "artifacts/GuidedExecutionArtifact.tsx"), "utf8");
    expect(guided).toContain("startReviewReplySubmissionRun");
    // The seller's own report is intent (REQUEST_STEP_RECHECK / SWITCH_TO_MANUAL through the runtime); no
    // control may read as 등록/전송/발송 of the reply itself, and nothing here fills or clicks a page.
    expect(guided).not.toMatch(/>\s*(등록하기|전송|발송|답변 보내기)\s*</);
    expect(guided).not.toMatch(/\.(click|fill|type)\(/);
  });

  it("the product contract wording holds — no one-click promise anywhere in the conversation", () => {
    for (const file of ROOTS.flatMap(walk)) {
      const src = readFileSync(file, "utf8");
      expect(src, relative(resolve(__dirname), file)).not.toMatch(/한 ?번 ?클릭|원클릭|one[- ]?click/i);
    }
  });
});
