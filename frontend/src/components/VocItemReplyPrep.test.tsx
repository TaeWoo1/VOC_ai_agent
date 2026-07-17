// @vitest-environment jsdom
import { render, screen, waitFor } from "@testing-library/react";
import userEvent from "@testing-library/user-event";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { VocItemReplyPrep } from "./VocItemReplyPrep";
import { api } from "../lib/apiClient";
import type { ReviewReplyDraft, ReviewReplyPrep } from "../lib/types";

vi.mock("../lib/apiClient", () => ({
  api: {
    getReviewReplyPrep: vi.fn(),
    saveReviewReplyDraft: vi.fn(),
    decideReviewReplyApproval: vi.fn(),
  },
}));

/**
 * The reply-preparation panel.
 *
 * Asserted through roles and aria, never styling: jsdom applies no Tailwind, so a class
 * name conveys nothing here. `aria-disabled` is what says a control is unavailable — the
 * buttons stay focusable on purpose (see VocItemTriageControl), so `toBeDisabled()` would
 * assert an implementation this deliberately does not have.
 */

const ACCOUNT = "mock-acct-1";
const REF = "review:mock-voc-0";

/** jsdom's own clipboard descriptor, restored after each test. */
const originalClipboard = Object.getOwnPropertyDescriptor(navigator, "clipboard")?.value;

function prepView(over: Partial<ReviewReplyPrep> = {}): ReviewReplyPrep {
  return {
    actionRef: REF,
    redactedBody: "합성-리뷰-본문: 배송이 너무 늦었습니다",
    bodyRedacted: false,
    triageDisposition: "RESPONSE_NEEDED",
    suggestion: {
      body: "합성-추천-초안",
      category: "delivery_reply",
      providerKind: "RULE_BASED",
      providerName: "review-reply-template",
      providerVersion: "templates-v1",
    },
    draft: null,
    approval: null,
    capabilities: { canSave: true, canApprove: false, canWithdraw: false, canCopy: false },
    ...over,
  };
}

const APPROVED = prepView({
  draft: {
    version: 1,
    body: "합성-승인된-답변",
    contentFingerprint: "mock-abc",
    fingerprintAlgorithm: "review-reply-v1",
    createdAt: "2026-07-17T00:00:00Z",
  },
  approval: {
    state: "APPROVED",
    approvedVersion: 1,
    approvedFingerprint: "mock-abc",
    approvedBody: "합성-승인된-답변",
    decidedAt: "2026-07-17T00:00:00Z",
  },
  capabilities: { canSave: false, canApprove: false, canWithdraw: true, canCopy: true },
});

/** aria-disabled, not the native attribute — see the class note. */
function inert(el: HTMLElement): boolean {
  return el.getAttribute("aria-disabled") === "true";
}

/**
 * Replace `navigator.clipboard` only — and always AFTER `userEvent.setup()`.
 *
 * Both halves are load-bearing, and each cost a real debugging round:
 *
 * 1. `userEvent.setup()` installs its OWN clipboard stub (it has to, for `user.copy()`), so
 *    any stub applied before it is silently clobbered and the panel sees a working
 *    clipboard that resolves — which is exactly the opposite of what these tests assert.
 * 2. `vi.stubGlobal("navigator", {...})` replaces the WHOLE navigator, taking `userAgent`
 *    and friends with it, which user-event needs. Redefining the one property leaves the
 *    rest of the environment alone.
 *
 * `configurable: true` so the next test can redefine it and afterEach can restore it.
 */
function stubClipboard(clipboard: unknown): void {
  Object.defineProperty(navigator, "clipboard", { value: clipboard, configurable: true });
}

/**
 * Renders with the panel's `disposition` prop matching the fixture's own
 * `triageDisposition` — i.e. a read that is NOT stale. That is the ordinary case; the stale
 * one is driven explicitly below, because it is where the forward gates have to close.
 */
async function renderPanel(view: ReviewReplyPrep = prepView()) {
  vi.mocked(api.getReviewReplyPrep).mockResolvedValue(view);
  render(
    <VocItemReplyPrep accountId={ACCOUNT} actionRef={REF} disposition={view.triageDisposition} />,
  );
  await screen.findByRole("heading", { name: "답변 준비" });
}

describe("VocItemReplyPrep", () => {
  beforeEach(() => {
    vi.clearAllMocks();
  });
  afterEach(() => {
    vi.unstubAllGlobals();
    Object.defineProperty(navigator, "clipboard", {
      value: originalClipboard,
      configurable: true,
    });
  });

  it("shows the whole redacted body and seeds the editor from the suggestion", async () => {
    await renderPanel();
    expect(screen.getByText("합성-리뷰-본문: 배송이 너무 늦었습니다")).toBeTruthy();
    expect(screen.getByLabelText("답변 초안")).toHaveValue("합성-추천-초안");
  });

  /** 규칙 기반, stated — never overstated as AI (Frontend Spec §10.3). */
  it("labels the suggestion rule-based and never says AI", async () => {
    await renderPanel();
    expect(screen.getByText(/규칙 기반/)).toBeTruthy();
    expect(document.body.textContent).not.toMatch(/\bAI\b/);
  });

  it("says so when something was hidden, so a token is not a mystery", async () => {
    await renderPanel(prepView({ bodyRedacted: true }));
    expect(screen.getByText(/가려서 표시했습니다/)).toBeTruthy();
  });

  it("seeds the editor from a saved draft in preference to the suggestion", async () => {
    await renderPanel(
      prepView({
        draft: {
          version: 2,
          body: "합성-저장된-초안",
          contentFingerprint: "mock-x",
          fingerprintAlgorithm: "review-reply-v1",
          createdAt: "2026-07-17T00:00:00Z",
        },
        capabilities: { canSave: true, canApprove: true, canWithdraw: false, canCopy: false },
      }),
    );
    expect(screen.getByLabelText("답변 초안")).toHaveValue("합성-저장된-초안");
  });

  it("saves the draft on the current base version", async () => {
    const user = userEvent.setup();
    await renderPanel(
      prepView({
        draft: {
          version: 3,
          body: "합성-저장된-초안",
          contentFingerprint: "mock-x",
          fingerprintAlgorithm: "review-reply-v1",
          createdAt: "2026-07-17T00:00:00Z",
        },
        capabilities: { canSave: true, canApprove: true, canWithdraw: false, canCopy: false },
      }),
    );
    await user.click(screen.getByRole("button", { name: "초안 저장" }));
    await waitFor(() =>
      expect(api.saveReviewReplyDraft).toHaveBeenCalledWith(ACCOUNT, REF, {
        body: "합성-저장된-초안",
        baseVersion: 3,
      }),
    );
  });

  // --- affordances come from the server's capabilities ------------------------------

  it("renders the editor read-only and explains why when the review is not 대응 필요", async () => {
    await renderPanel(
      prepView({
        triageDisposition: "MONITOR",
        capabilities: { canSave: false, canApprove: false, canWithdraw: false, canCopy: false },
      }),
    );
    expect(screen.getByLabelText("답변 초안")).toHaveAttribute("readonly");
    expect(inert(screen.getByRole("button", { name: "초안 저장" }))).toBe(true);
    // The reason is stated, not left as a dead control.
    expect(screen.getByText(/'대응 필요'로 기록된 리뷰만/)).toBeTruthy();
  });

  it("does not offer a save the server would refuse", async () => {
    const user = userEvent.setup();
    await renderPanel(
      prepView({
        capabilities: { canSave: false, canApprove: false, canWithdraw: false, canCopy: false },
      }),
    );
    await user.click(screen.getByRole("button", { name: "초안 저장" }));
    expect(api.saveReviewReplyDraft).not.toHaveBeenCalled();
  });

  it("approves the version it is showing", async () => {
    const user = userEvent.setup();
    await renderPanel(
      prepView({
        draft: {
          version: 2,
          body: "합성-저장된-초안",
          contentFingerprint: "mock-x",
          fingerprintAlgorithm: "review-reply-v1",
          createdAt: "2026-07-17T00:00:00Z",
        },
        capabilities: { canSave: true, canApprove: true, canWithdraw: false, canCopy: false },
      }),
    );
    await user.click(screen.getByRole("button", { name: "승인" }));
    await waitFor(() => expect(api.decideReviewReplyApproval).toHaveBeenCalled());
    const body = vi.mocked(api.decideReviewReplyApproval).mock.calls[0][2];
    expect(body.state).toBe("APPROVED");
    expect(body.baseVersion).toBe(2);
    expect(body.commandId).toBeTruthy();
  });

  it("freezes the editor once approved and explains the way out", async () => {
    await renderPanel(APPROVED);
    expect(screen.getByLabelText("답변 초안")).toHaveAttribute("readonly");
    expect(screen.getByText(/승인을 해제하세요/)).toBeTruthy();
    expect(screen.getByRole("button", { name: "승인 해제" })).toBeTruthy();
  });

  it("withdraws with a null baseVersion (a withdrawal binds nothing)", async () => {
    const user = userEvent.setup();
    await renderPanel(APPROVED);
    await user.click(screen.getByRole("button", { name: "승인 해제" }));
    await waitFor(() => expect(api.decideReviewReplyApproval).toHaveBeenCalled());
    const body = vi.mocked(api.decideReviewReplyApproval).mock.calls[0][2];
    expect(body.state).toBe("WITHDRAWN");
    expect(body.baseVersion).toBeNull();
  });

  /** The escape hatch: an approval must never be strandable. */
  it("still offers 승인 해제 when the review has left 대응 필요", async () => {
    await renderPanel(
      prepView({
        ...APPROVED,
        triageDisposition: "MONITOR",
        capabilities: { canSave: false, canApprove: false, canWithdraw: true, canCopy: false },
      }),
    );
    expect(inert(screen.getByRole("button", { name: "승인 해제" }))).toBe(false);
  });

  // --- the copy contract ------------------------------------------------------------

  it("offers no copy until something is approved", async () => {
    await renderPanel();
    expect(screen.queryByRole("button", { name: "복사" })).toBeNull();
  });

  /**
   * The rule most likely to be "simplified" into copying the textarea. The editor holds an
   * unsaved keystroke here; the clipboard must still receive the APPROVED text, because the
   * clipboard's next stop is a public marketplace reply.
   */
  /**
   * Copy takes `approvedBody`. If the editor and the approval ever disagree, the approval
   * wins — the clipboard's next stop is a public reply, and only the approved text has been
   * looked at by a human who meant to send it.
   *
   * The fixture is deliberately one the SERVER CANNOT PRODUCE: it freezes saves while an
   * approval stands, so `draft.body` and `approvedBody` always match in a served view. Two
   * earlier attempts at a "realistic" version proved nothing — assigning `editor.value`
   * does not update React state (so both sources still agreed, and a copy() reading the
   * buffer passed), and typing after approval is impossible because the editor is readOnly
   * by then. Between the freeze and the unsaved-edit guard below, the divergence is
   * genuinely unreachable through the UI.
   *
   * Which is exactly why this is worth pinning artificially rather than deleting: the test
   * says which source wins IF they ever disagree, so relaxing the freeze later cannot
   * quietly turn the editor into the copy source.
   */
  it("copies the approved body, not the editor, if the two ever disagree", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    await renderPanel(
      prepView({
        ...APPROVED,
        // Impossible through the server — see the note above.
        draft: { ...APPROVED.draft!, body: "합성-편집-버퍼" },
      }),
    );
    // The editor seeds from the draft, so the buffer genuinely holds the other string.
    expect(screen.getByLabelText("답변 초안")).toHaveValue("합성-편집-버퍼");

    await user.click(screen.getByRole("button", { name: "복사" }));
    await waitFor(() => expect(writeText).toHaveBeenCalledTimes(1));
    expect(writeText).toHaveBeenCalledWith("합성-승인된-답변");
    expect(writeText).not.toHaveBeenCalledWith("합성-편집-버퍼");
  });

  /**
   * Approving binds the last SAVED version, so an unsaved edit must block it — otherwise
   * the operator approves the text they just replaced and copies it without ever seeing
   * that their correction was dropped.
   */
  it("refuses to approve while the editor holds unsaved changes, and says why", async () => {
    const user = userEvent.setup();
    await renderPanel(
      prepView({
        draft: {
          version: 1,
          body: "합성-저장된-초안",
          contentFingerprint: "mock-x",
          fingerprintAlgorithm: "review-reply-v1",
          createdAt: "2026-07-17T00:00:00Z",
        },
        capabilities: { canSave: true, canApprove: true, canWithdraw: false, canCopy: false },
      }),
    );
    const approve = screen.getByRole("button", { name: "승인" });
    expect(inert(approve)).toBe(false);

    await user.type(screen.getByLabelText("답변 초안"), "-수정");

    expect(inert(approve)).toBe(true);
    expect(screen.getByText(/저장하지 않은 변경이 있습니다/)).toBeTruthy();
    await user.click(approve);
    expect(api.decideReviewReplyApproval).not.toHaveBeenCalled();
  });

  it("is honest about who sends after a copy", async () => {
    const user = userEvent.setup();
    stubClipboard({ writeText: vi.fn().mockResolvedValue(undefined) });
    await renderPanel(APPROVED);
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(await screen.findByText(/채널에 직접 붙여넣으세요/)).toBeTruthy();
  });

  /**
   * The SecureContext trap: on the LAN dev origin there is no clipboard API at all. The
   * panel must reveal the APPROVED text rather than claim a copy that never happened.
   */
  it("reveals the approved text when the origin has no clipboard API", async () => {
    const user = userEvent.setup();
    stubClipboard(undefined);
    await renderPanel(APPROVED);
    await user.click(screen.getByRole("button", { name: "복사" }));

    const manual = await screen.findByLabelText("승인된 답변 (직접 복사)");
    expect(manual).toHaveValue("합성-승인된-답변");
    expect(screen.getByText(/직접 선택해 복사하세요/)).toBeTruthy();
    // Crucially: no success claim.
    expect(screen.queryByText(/복사했습니다/)).toBeNull();
  });

  it("offers a retry when the clipboard refuses", async () => {
    const user = userEvent.setup();
    stubClipboard({ writeText: vi.fn().mockRejectedValue(new Error("NotAllowedError")) });
    await renderPanel(APPROVED);
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(await screen.findByRole("alert")).toHaveTextContent(/다시 시도해 주세요/);
    expect(screen.queryByText(/복사했습니다/)).toBeNull();
  });

  it("hides the copy affordance's text when the server withholds the body", async () => {
    await renderPanel(
      prepView({
        ...APPROVED,
        triageDisposition: "MONITOR",
        approval: { ...APPROVED.approval!, approvedBody: null },
        capabilities: { canSave: false, canApprove: false, canWithdraw: true, canCopy: false },
      }),
    );
    expect(inert(screen.getByRole("button", { name: "복사" }))).toBe(true);
    expect(screen.getByText(/'대응 필요'로 되돌리면 복사할 수 있습니다/)).toBeTruthy();
  });

  // --- the read goes stale when a sibling moves the decision -------------------------
  //
  // The panel reads once and after its own writes; it does NOT re-read because the row was
  // re-triaged. So `capabilities` can be stale-TRUE, and the live `disposition` prop is what
  // closes the forward gates. Every case here renders a fixture whose capabilities were
  // computed under RESPONSE_NEEDED, with the prop already moved on — exactly the state the
  // operator reaches by clicking 지켜보기 with the panel open.

  const STALE_SAVEABLE = prepView({
    draft: {
      version: 1,
      body: "합성-저장된-초안",
      contentFingerprint: "mock-x",
      fingerprintAlgorithm: "review-reply-v1",
      createdAt: "2026-07-17T00:00:00Z",
    },
    // As the server answered while the review WAS 대응 필요.
    capabilities: { canSave: true, canApprove: true, canWithdraw: false, canCopy: false },
  });

  async function renderStale(view: ReviewReplyPrep) {
    vi.mocked(api.getReviewReplyPrep).mockResolvedValue(view);
    render(<VocItemReplyPrep accountId={ACCOUNT} actionRef={REF} disposition="MONITOR" />);
    await screen.findByRole("heading", { name: "답변 준비" });
  }

  /**
   * Without the gate every retry is a byte-identical 409, and the UI actively says the
   * opposite — an editable box and a live 저장 button, both read off the stale flag.
   */
  it("refuses to save on a stale canSave, and says why instead of failing forever", async () => {
    const user = userEvent.setup();
    await renderStale(STALE_SAVEABLE);

    expect(inert(screen.getByRole("button", { name: "초안 저장" }))).toBe(true);
    expect(screen.getByLabelText("답변 초안")).toHaveAttribute("readonly");
    // The reason renders — it used to be gated on the very flag that was stale.
    expect(screen.getByText(/'대응 필요'로 기록된 리뷰만/)).toBeTruthy();

    await user.click(screen.getByRole("button", { name: "초안 저장" }));
    expect(api.saveReviewReplyDraft).not.toHaveBeenCalled();
  });

  it("refuses to approve on a stale canApprove", async () => {
    const user = userEvent.setup();
    await renderStale(STALE_SAVEABLE);
    await user.click(screen.getByRole("button", { name: "승인" }));
    expect(api.decideReviewReplyApproval).not.toHaveBeenCalled();
  });

  /**
   * The one stale capability with NO server backstop: the approved body is already in this
   * component's memory, so the client gate is the entire enforcement. The server withholds
   * `approvedBody` when it computes `canCopy=false` — but it computed this response when the
   * answer was still true.
   */
  it("refuses to copy on a stale canCopy — the only gate there is", async () => {
    const user = userEvent.setup();
    const writeText = vi.fn().mockResolvedValue(undefined);
    stubClipboard({ writeText });
    await renderStale(
      prepView({
        ...APPROVED,
        // The server sent the body while the review was still 대응 필요.
        capabilities: { canSave: false, canApprove: false, canWithdraw: true, canCopy: true },
      }),
    );

    expect(inert(screen.getByRole("button", { name: "복사" }))).toBe(true);
    await user.click(screen.getByRole("button", { name: "복사" }));
    expect(writeText).not.toHaveBeenCalled();
    expect(screen.queryByText(/복사했습니다/)).toBeNull();
  });

  /** The exit is never gated — withdrawal does not depend on the disposition. */
  it("still allows withdrawal on a stale read", async () => {
    const user = userEvent.setup();
    vi.mocked(api.decideReviewReplyApproval).mockResolvedValue({
      actionRef: REF,
      state: "WITHDRAWN",
      replayed: false,
    });
    await renderStale(APPROVED);

    expect(inert(screen.getByRole("button", { name: "승인 해제" }))).toBe(false);
    await user.click(screen.getByRole("button", { name: "승인 해제" }));
    await waitFor(() => expect(api.decideReviewReplyApproval).toHaveBeenCalled());
  });

  /**
   * A keystroke landing DURING a save used to survive `setDirty(false)`, leaving the buffer
   * ahead of the saved draft while `approvable` read clean — so 승인 would bind the text the
   * operator had just replaced. The editor is inert while the write is in flight.
   */
  it("accepts no keystroke while a save is in flight", async () => {
    const user = userEvent.setup();
    let resolveSave: (v: ReviewReplyDraft) => void = () => {};
    vi.mocked(api.saveReviewReplyDraft).mockReturnValue(
      new Promise<ReviewReplyDraft>((r) => {
        resolveSave = r;
      }),
    );
    await renderPanel();

    await user.click(screen.getByRole("button", { name: "초안 저장" }));
    const editor = await screen.findByLabelText("답변 초안");
    await waitFor(() => expect(editor).toHaveAttribute("readonly"));

    resolveSave({
      version: 1,
      body: "합성-추천-초안",
      contentFingerprint: "mock-x",
      fingerprintAlgorithm: "review-reply-v1",
      createdAt: "2026-07-17T00:00:00Z",
    });
  });

  // --- failures ---------------------------------------------------------------------

  it("announces a save failure without leaking detail", async () => {
    const user = userEvent.setup();
    vi.mocked(api.saveReviewReplyDraft).mockRejectedValue(new Error("409 stale base"));
    await renderPanel();
    await user.click(screen.getByRole("button", { name: "초안 저장" }));
    const alert = await screen.findByRole("alert");
    expect(alert).toHaveTextContent("초안을 저장하지 못했습니다. 다시 시도해 주세요.");
    expect(alert.textContent).not.toMatch(/409|stale/);
  });

  it("fails closed when the prep read fails", async () => {
    vi.mocked(api.getReviewReplyPrep).mockRejectedValue(new Error("boom"));
    render(<VocItemReplyPrep accountId={ACCOUNT} actionRef={REF} disposition="RESPONSE_NEEDED" />);
    expect(await screen.findByRole("alert")).toHaveTextContent(/불러오지 못했습니다/);
    // No editor, no suggestion, no copy — nothing invented to fill the gap.
    expect(screen.queryByLabelText("답변 초안")).toBeNull();
  });

  /** No control here may read as sending — the product does not post this anywhere. */
  it("offers nothing that reads as sending", async () => {
    await renderPanel(APPROVED);
    for (const el of screen.getAllByRole("button")) {
      expect(el.textContent ?? "").not.toMatch(/발송|전송|등록|게시/);
    }
    expect(document.body.textContent).not.toMatch(/발송|전송/);
  });
});
