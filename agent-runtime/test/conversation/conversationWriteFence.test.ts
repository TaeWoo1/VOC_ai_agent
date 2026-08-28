/**
 * The conversation lane cannot send, approve, verify, collect or touch a credential — asserted on the
 * SOURCE, the same way `plannerFence` and `privilegedPlaneFence` assert their invariants.
 *
 * Two halves. (1) No file under `src/conversation/` references a backend method that writes toward a
 * channel or the privileged plane; the only PREPARE it may reach is `generateDraftFor`, and only from
 * `DraftPreparer.ts`. (2) The Operator tool catalogue is byte-for-byte the declared table and still
 * 100% READ — the lane added three READ tools and no other class.
 */
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { describe, expect, it } from "vitest";
import { buildOperatorTools, OPERATOR_TOOL } from "../../src/operator/tools/OperatorTools";
import { OperatorToolRegistry } from "../../src/operator/tools/OperatorToolRegistry";
import { FakeOperatorSpringClient } from "../support/FakeOperatorSpringClient";
import { FakeSpringClient } from "../support/FakeSpringClient";
import { FakeIssueSpringClient } from "../support/FakeIssueSpringClient";
import { twoInquiries } from "../support/fixtures";
import { fourIssues } from "../support/issueFixtures";

const DIR = join(__dirname, "../../src/conversation");
const FILES = readdirSync(DIR).filter((f) => f.endsWith(".ts")).map((f) => ({ name: f, text: readFileSync(join(DIR, f), "utf8") }));

/** Backend methods / capabilities the lane must never name. Method-call shapes, so a doc word cannot trip it. */
const FORBIDDEN = [
  /\bconfirmPublish\b/, /\bconfirmInquiryPublish\b/, /\.resume\s*\(/, /\bresumeInquiryPublish\b/,
  /\bverify\w*\s*\(/, /\bapprove\w*\s*\(/, /\bdecideReviewApproval\b/, /\bstartReviewSubmissionRun\b/,
  /\bmanualSync\b/, /\bbackfill\w*/i, /\bcredential\w*/i, /\bproposeInquiry\b/, /\bsaveDraft\b/, /\bsaveReviewDraft\b/, /\brecordReviewTriage\b/,
];

describe("conversation write fence", () => {
  it("has source files to check", () => {
    expect(FILES.map((f) => f.name)).toEqual(expect.arrayContaining(["ConversationService.ts", "DraftPreparer.ts", "ConversationStore.ts"]));
  });

  // Two named exceptions, each a PREPARE/REFRESH step the plan authorises and nothing else may reach:
  // the review draft seam from the draft preparer, and the product's own one-press collection from the refresher.
  const ALLOWED: Record<string, RegExp[]> = {
    "DraftPreparer.ts": [/\bsaveReviewDraft\b/, /\brecordReviewTriage\b/, /\bproposeInquiry\b/],
    "Refresher.ts": [/\bmanualSync\b/],
  };

  it("no conversation file references a write, approval, verification, collection or credential method", () => {
    for (const file of FILES) {
      for (const pattern of FORBIDDEN) {
        if ((ALLOWED[file.name] ?? []).some((a) => a.source === pattern.source)) continue;
        expect(pattern.test(file.text), `${file.name} matches ${pattern}`).toBe(false);
      }
    }
  });

  it("the two exceptions stay in their one file each", () => {
    expect(FILES.filter((f) => /\bsaveReviewDraft\b/.test(f.text)).map((f) => f.name)).toEqual(["DraftPreparer.ts"]);
    expect(FILES.filter((f) => /\bmanualSync\b/.test(f.text)).map((f) => f.name)).toEqual(["Refresher.ts"]);
    expect(FILES.filter((f) => /\bproposeInquiry\b/.test(f.text)).map((f) => f.name)).toEqual(["DraftPreparer.ts"]);
  });

  it("generateDraftFor is reached from DraftPreparer.ts and nowhere else in the lane", () => {
    const callers = FILES.filter((f) => /\.generateDraftFor\s*\(/.test(f.text)).map((f) => f.name);
    expect(callers).toEqual(["DraftPreparer.ts"]);
  });

  it("the Operator catalogue is unchanged in kind: exactly the declared table, every class READ", () => {
    const registry = new OperatorToolRegistry(buildOperatorTools({
      operator: new FakeOperatorSpringClient(), inquiry: new FakeSpringClient(twoInquiries()), issue: new FakeIssueSpringClient(fourIssues()),
    }));
    expect(registry.names().sort()).toEqual(Object.values(OPERATOR_TOOL).sort());
    expect(registry.actionClasses()).toEqual(["READ"]);
    expect(registry.names()).toEqual(expect.arrayContaining(["list_recent_reviews", "get_sales_trend", "list_inquiry_workload"]));
    for (const name of registry.names()) {
      expect(name).not.toMatch(/draft|send|publish|sync|approve/);
    }
  });
});
