import { describe, it, expect } from "vitest";
import { readdirSync, readFileSync, statSync } from "node:fs";
import { join, relative, resolve } from "node:path";

/**
 * The conversation is READ + one seller-pressed collection + one approval module (Agentic Operating
 * Workspace v2 §3-B). Everything under `components/conversation/**` and `lib/conversation/**` must
 * hold no path to a marketplace write — checked by name, the way `agentPanelWriteFence.test.ts` does —
 * with exactly two exceptions: `artifacts/ApprovalArtifact.tsx` (the confirm step, which is the
 * existing Human Approval path) and `artifacts/HumanActionArtifact.tsx` (the seller-pressed
 * collection, `manualSync` only).
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
 * Exactly three modules may name a write or a run start, each its own set (channel-capability completion):
 * the approval (inquiry publish · Cafe24 review execute), the guided execution (submission-run mint · the
 * reply runtime) and the human action (seller-pressed collection · guided acquisition start).
 */
const ALLOWED: Record<string, readonly string[]> = {
  "artifacts/ApprovalArtifact.tsx": ["confirmInquiryPublish", "executeReviewReply"],
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
