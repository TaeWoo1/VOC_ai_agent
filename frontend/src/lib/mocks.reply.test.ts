import { beforeEach, describe, expect, it } from "vitest";
import {
  mockAttentionItems,
  mockDecideReviewReplyApproval,
  mockRecordReviewReplyOutcome,
  mockReviewReplyPrep,
  mockSaveReviewReplyDraft,
  mockStartReviewReplySubmissionRun,
  mockVocItemTriage,
  resetMockReviewReplyState,
  resetMockTriageDecisions,
} from "./mocks";

/**
 * The demo's reply state.
 *
 * What is under test is CONSISTENCY, not the fixture's contents: a demo whose subject is a
 * record must not lose the record, and a demo that let an operator copy an unapproved
 * draft would be teaching the product's rules wrong to whoever is evaluating it.
 */

// The seeded 대응 필요 row (fixture id 0) — the only one that opens ready to prepare.
const SEEDED_REF = "review:mock-voc-0";
// A row that is NOT seeded as 대응 필요.
const UNTRIAGED_REF = "review:mock-voc-2";
const ACCOUNT = "mock-acct-mock-channel-1";
const RANGE = { type: "LOW_RATING_REVIEW", from: "2026-05-01", to: "2026-05-31" };

describe("mock review reply prep", () => {
  beforeEach(() => {
    resetMockTriageDecisions();
    resetMockReviewReplyState();
  });

  it("opens the seeded row ready to prepare, with nothing yet written", () => {
    const prep = mockReviewReplyPrep(SEEDED_REF);
    expect(prep.triageDisposition).toBe("RESPONSE_NEEDED");
    expect(prep.draft).toBeNull();
    expect(prep.approval).toBeNull();
    expect(prep.capabilities).toEqual({
      canSave: true,
      canApprove: false, // nothing to approve yet
      canWithdraw: false,
      canCopy: false,
      canStartSubmissionRun: false, // nothing approved to guide-post yet
    });
    expect(prep.outcome).toBeNull();
  });

  it("serves the whole redacted body, not the list's preview", () => {
    const prep = mockReviewReplyPrep(SEEDED_REF);
    const row = mockAttentionItems(ACCOUNT, RANGE, 0, 20).items.find(
      (i) => i.actionRef === SEEDED_REF,
    );
    expect(prep.redactedBody).not.toBeNull();
    expect(prep.redactedBody!.length).toBeGreaterThan((row?.safePreview ?? "").length);
    // Already tokenized by "the server" — the client never redacts.
    expect(prep.bodyRedacted).toBe(true);
    expect(prep.redactedBody).toContain("[전화번호]");
  });

  /** The two nulls are different facts: a suppressed preview is not an absent body. */
  it("has a body for a row whose preview was suppressed", () => {
    const prep = mockReviewReplyPrep("review:mock-voc-7");
    expect(prep.redactedBody).not.toBeNull();
  });

  it("suggests rule-based provenance and never claims AI", () => {
    const { suggestion } = mockReviewReplyPrep(SEEDED_REF);
    expect(suggestion.providerKind).toBe("RULE_BASED");
    expect(suggestion.body).not.toBe("");
  });

  /** Mirrors the provider: a praising review must never be answered with an apology. */
  it("suggests the positive template for a high-rated review regardless of keywords", () => {
    // Fixture id 6 is 4★ and its body mentions 포장 — a keyword-first rule would apologise.
    const { suggestion } = mockReviewReplyPrep("review:mock-voc-6");
    expect(suggestion.category).toBe("positive_reply");
    expect(suggestion.body).not.toContain("죄송");
  });

  it("suggests a complaint template for a low-rated review by keyword", () => {
    // Fixture id 0 is 1★ and its body is a quality complaint.
    expect(mockReviewReplyPrep(SEEDED_REF).suggestion.category).toBe("general_reply");
  });

  it("refuses to prepare a review that is not 대응 필요", () => {
    const prep = mockReviewReplyPrep(UNTRIAGED_REF);
    expect(prep.capabilities.canSave).toBe(false);
    expect(() => mockSaveReviewReplyDraft(UNTRIAGED_REF, "합성-답변", 0)).toThrow();
  });

  it("records a draft that survives re-reading (the record must stick)", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    const prep = mockReviewReplyPrep(SEEDED_REF);
    expect(prep.draft?.version).toBe(1);
    expect(prep.draft?.body).toBe("합성-답변 초안");
    expect(prep.capabilities.canApprove).toBe(true);
  });

  it("appends versions and refuses a stale base", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 v1", 0);
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 v2", 1);
    expect(mockReviewReplyPrep(SEEDED_REF).draft?.version).toBe(2);
    expect(() => mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 v3", 0)).toThrow();
  });

  it("treats an identical re-save as the same version", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    expect(mockReviewReplyPrep(SEEDED_REF).draft?.version).toBe(1);
  });

  it("freezes the draft once approved and re-opens it on withdrawal", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    mockDecideReviewReplyApproval(SEEDED_REF, "APPROVED", 1);

    expect(mockReviewReplyPrep(SEEDED_REF).capabilities.canSave).toBe(false);
    expect(() => mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 수정본", 1)).toThrow();

    mockDecideReviewReplyApproval(SEEDED_REF, "WITHDRAWN", null);
    expect(mockReviewReplyPrep(SEEDED_REF).capabilities.canSave).toBe(true);
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 수정본", 1);
    expect(mockReviewReplyPrep(SEEDED_REF).draft?.version).toBe(2);
  });

  it("withdrawing does not delete the draft", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    mockDecideReviewReplyApproval(SEEDED_REF, "APPROVED", 1);
    mockDecideReviewReplyApproval(SEEDED_REF, "WITHDRAWN", null);
    expect(mockReviewReplyPrep(SEEDED_REF).draft?.body).toBe("합성-답변 초안");
  });

  it("serves the approved body bound to its exact version", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    mockDecideReviewReplyApproval(SEEDED_REF, "APPROVED", 1);

    const prep = mockReviewReplyPrep(SEEDED_REF);
    expect(prep.capabilities.canCopy).toBe(true);
    expect(prep.approval?.approvedVersion).toBe(1);
    expect(prep.approval?.approvedBody).toBe("합성-답변 초안");
    expect(prep.approval?.approvedFingerprint).toBe(prep.draft?.contentFingerprint);
  });

  it("has nothing to copy until something is approved", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    const prep = mockReviewReplyPrep(SEEDED_REF);
    expect(prep.capabilities.canCopy).toBe(false);
    expect(prep.approval).toBeNull();
  });

  /**
   * The demo keeps the server's contract: the copyable body is withheld the moment copying
   * is not allowed, so a client written against the demo cannot learn to copy something the
   * real backend would never hand it.
   */
  it("withholds the copyable body when the review leaves 대응 필요", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    mockDecideReviewReplyApproval(SEEDED_REF, "APPROVED", 1);
    mockVocItemTriage(SEEDED_REF, "MONITOR");

    const prep = mockReviewReplyPrep(SEEDED_REF);
    expect(prep.capabilities.canCopy).toBe(false);
    expect(prep.approval?.state).toBe("APPROVED");
    expect(prep.approval?.approvedBody).toBeNull();
    // Still readable, so the operator can see what they approved before withdrawing it.
    expect(prep.draft?.body).toBe("합성-답변 초안");
  });

  /** The asymmetry: leaving 대응 필요 must never strand an approval. */
  it("still allows withdrawal after the review leaves 대응 필요", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    mockDecideReviewReplyApproval(SEEDED_REF, "APPROVED", 1);
    mockVocItemTriage(SEEDED_REF, "MONITOR");

    expect(mockReviewReplyPrep(SEEDED_REF).capabilities.canWithdraw).toBe(true);
    expect(() => mockDecideReviewReplyApproval(SEEDED_REF, "WITHDRAWN", null)).not.toThrow();
  });

  it("refuses to approve a stale version", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 v1", 0);
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 v2", 1);
    expect(() => mockDecideReviewReplyApproval(SEEDED_REF, "APPROVED", 1)).toThrow();
  });

  it("refuses to withdraw when nothing is approved", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    expect(() => mockDecideReviewReplyApproval(SEEDED_REF, "WITHDRAWN", null)).toThrow();
  });

  /** A decision made under one lens is the same review's decision under every other. */
  it("keys state on the review, not the lens it was found through", () => {
    mockVocItemTriage("review:mock-voc-1", "RESPONSE_NEEDED");
    mockSaveReviewReplyDraft("review:mock-voc-1", "합성-답변", 0);
    const viaOtherLens = mockAttentionItems(
      ACCOUNT,
      { ...RANGE, type: "NEW_REVIEW" },
      0,
      20,
    ).items.find((i) => i.actionRef === "review:mock-voc-1");
    expect(viaOtherLens?.triageDisposition).toBe("RESPONSE_NEEDED");
    expect(mockReviewReplyPrep("review:mock-voc-1").draft?.body).toBe("합성-답변");
  });

  it("throws for a ref it cannot address", () => {
    expect(() => mockReviewReplyPrep("review:does-not-exist")).toThrow();
  });

  // --- hasReplyPreparation on the drill-down row ------------------------------------
  //
  // Half the panel's mount rule, so the demo has to answer it the way the server does —
  // otherwise the demo shows the panel on rows the product hides, or hides it on rows the
  // product shows, and whoever is evaluating learns the wrong rule.

  function rowFor(ref: string) {
    return mockAttentionItems(ACCOUNT, { ...RANGE, type: "NEW_REVIEW" }, 0, 20).items.find(
      (i) => i.actionRef === ref,
    );
  }

  it("reports no reply work on a row nobody has prepared", () => {
    expect(rowFor(SEEDED_REF)?.hasReplyPreparation).toBe(false);
  });

  it("reports reply work as soon as a draft is saved", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    expect(rowFor(SEEDED_REF)?.hasReplyPreparation).toBe(true);
  });

  /** The stranding case the flag exists for: work outlives the decision. */
  it("still reports reply work after the review is re-triaged away", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    mockVocItemTriage(SEEDED_REF, "MONITOR");

    const row = rowFor(SEEDED_REF);
    expect(row?.triageDisposition).toBe("MONITOR");
    expect(row?.hasReplyPreparation).toBe(true);
  });

  it("still reports reply work while an approval is withdrawn but the draft remains", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    mockDecideReviewReplyApproval(SEEDED_REF, "APPROVED", 1);
    mockDecideReviewReplyApproval(SEEDED_REF, "WITHDRAWN", null);
    expect(rowFor(SEEDED_REF)?.hasReplyPreparation).toBe(true);
  });

  it("does not bleed one review's work onto its neighbours", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    expect(rowFor(SEEDED_REF)?.hasReplyPreparation).toBe(true);
    expect(rowFor("review:mock-voc-1")?.hasReplyPreparation).toBe(false);
  });
});

describe("mock guided reply submission (v1.6)", () => {
  beforeEach(() => {
    resetMockTriageDecisions();
    resetMockReviewReplyState();
  });

  /** Drive the seeded row to an APPROVED reply, the precondition for a guided run. */
  function approve() {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-승인된-답변", 0);
    mockDecideReviewReplyApproval(SEEDED_REF, "APPROVED", 1);
  }

  it("canStartSubmissionRun follows canCopy — only once approved under 대응 필요", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    expect(mockReviewReplyPrep(SEEDED_REF).capabilities.canStartSubmissionRun).toBe(false);
    mockDecideReviewReplyApproval(SEEDED_REF, "APPROVED", 1);
    const caps = mockReviewReplyPrep(SEEDED_REF).capabilities;
    expect(caps.canStartSubmissionRun).toBe(true);
    expect(caps.canStartSubmissionRun).toBe(caps.canCopy);
  });

  it("starting a run needs an approval", () => {
    mockSaveReviewReplyDraft(SEEDED_REF, "합성-답변 초안", 0);
    expect(() => mockStartReviewReplySubmissionRun(SEEDED_REF)).toThrow();
  });

  it("mints an opaque 16-hex submissionRef bound to the approved head", () => {
    approve();
    const run = mockStartReviewReplySubmissionRun(SEEDED_REF);
    expect(run.submissionRef).toMatch(/^[0-9a-f]{16}$/);
    expect(run.approvedVersion).toBe(1);
  });

  it("records an outcome that separates report from verification, never claiming completion", () => {
    approve();
    const run = mockStartReviewReplySubmissionRun(SEEDED_REF);
    const res = mockRecordReviewReplyOutcome(SEEDED_REF, run.submissionRef, "OPERATOR_REPORTED_SUBMITTED", "run_aaaa11112222");
    expect(res.recorded).toBe(true);

    const outcome = mockReviewReplyPrep(SEEDED_REF).outcome;
    expect(outcome?.operatorOutcome).toBe("OPERATOR_REPORTED_SUBMITTED");
    expect(outcome?.verification).toBe("UNVERIFIED");
    // The recorded runId is the terminal-sourced value passed in, not fabricated from the ref.
    expect(outcome?.awRunRef).toBe("run_aaaa11112222");
    // No "COMPLETED" anywhere in the outcome vocabulary.
    expect(JSON.stringify(outcome)).not.toContain("COMPLETED");
  });

  it("records an abort as an outcome, not a fault", () => {
    approve();
    const run = mockStartReviewReplySubmissionRun(SEEDED_REF);
    mockRecordReviewReplyOutcome(SEEDED_REF, run.submissionRef, "SUBMISSION_ABORTED", "run_bbbb33334444");
    expect(mockReviewReplyPrep(SEEDED_REF).outcome?.operatorOutcome).toBe("SUBMISSION_ABORTED");
  });

  it("a submissionRef is single-use; a retry needs a fresh mint", () => {
    approve();
    const first = mockStartReviewReplySubmissionRun(SEEDED_REF);
    mockRecordReviewReplyOutcome(SEEDED_REF, first.submissionRef, "OPERATOR_REPORTED_SUBMITTED", "run_cccc55556666");
    expect(() =>
      mockRecordReviewReplyOutcome(SEEDED_REF, first.submissionRef, "OPERATOR_REPORTED_SUBMITTED", "run_cccc55556666"),
    ).toThrow();
    // A fresh mint records fine.
    const second = mockStartReviewReplySubmissionRun(SEEDED_REF);
    expect(second.submissionRef).not.toBe(first.submissionRef);
    expect(
      mockRecordReviewReplyOutcome(SEEDED_REF, second.submissionRef, "OPERATOR_REPORTED_SUBMITTED", "run_dddd77778888").recorded,
    ).toBe(true);
  });

  it("an unknown submissionRef is refused", () => {
    approve();
    expect(() =>
      mockRecordReviewReplyOutcome(SEEDED_REF, "0123456789abcdef", "OPERATOR_REPORTED_SUBMITTED", "run_eeee99990000"),
    ).toThrow();
  });
});
