import { useCallback, useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { api } from "../../lib/apiClient";
import {
  canGenerateProposal,
  classifyProposeError,
  detailErrorMessage,
  phaseLabel,
  proposalCategoryLabel,
  provenanceText,
} from "../../lib/inquiryWorkflow";
import {
  canEditDraft,
  canPublishReply,
  canResumePublish,
  canVerifyPublish,
  classifyPublishError,
  publishCategoryLabel,
  publishUnavailableReason,
} from "../../lib/inquiryPublish";
import type { InquiryDetail, PublishCapabilityView, PublishStatusView } from "../../lib/types";
import { Btn } from "../ui/Btn";

/**
 * The inquiry response workflow, in the inbox detail panel. The engine (`inquiryWorkflow`) is reused
 * unchanged; the publish decisions live in `inquiryPublish`, and this component renders what they say.
 *
 * WHAT THE PROPOSAL PRODUCES, STATED ACCURATELY. The generator returns a `ProposalView` with a
 * `summaryCategory` and its provenance — a suggested RESPONSE TYPE. It carries no reply body, and its
 * `providerKind` is `RULE_BASED`. Calling it an "AI 답변 초안" would describe something the product
 * does not produce, so the panel says what it is: a suggestion for how to respond.
 *
 * ## The send, and why it exists here now
 *
 * The backend has carried a complete, fail-closed inquiry reply-publish chain for some time — approval
 * bound immutably to an exact draft version and fingerprint, a `commandId` idempotency key, a
 * dispatch-recovery runner that reclassifies an abandoned DISPATCHING to DELIVERY_UNKNOWN and NEVER
 * resends, two independent flags, and a per-channel adapter registry that resolves empty by default.
 * It had **no caller in the product at all**: `confirm-publish` was reachable only by hand. A WRITE
 * path that exists and cannot be reached is not a safety property, it is an untested one.
 *
 * So the send is here, and every guard the backend enforces is mirrored in what the seller sees:
 *
 *  - **it is not offered unless the backend says it can be done** — `canPublishReply` reads the
 *    capability endpoint (execution flag + this channel's adapter) BEFORE any control is rendered, and
 *    fails closed when that read did not land. A channel without an adapter gets the manual hand-off
 *    it always had, with the reason said out loud;
 *  - **the approval binds to what was on screen** — the confirm sends the exact `contentFingerprint`
 *    of the draft version the seller read, so a draft that moved underneath them is a 409 and not a
 *    reply nobody reviewed;
 *  - **the press is deliberate** — a single click cannot send. The seller opens the confirm block,
 *    reads back what will be posted and where, and presses again. The second press is the ONLY thing
 *    in this product that writes to a marketplace;
 *  - **nothing is retried blindly** — "다시 시도" appears only for a retryable/publishing outcome, and
 *    DELIVERY_UNKNOWN offers verify-only, because an unobserved delivery must never be resent.
 */
export function InquiryResponsePanel({ workItemId }: { workItemId: string }) {
  const [detail, setDetail] = useState<InquiryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);
  /** `null` until the capability read lands — and `null` means "do not offer the send". */
  const [capability, setCapability] = useState<PublishCapabilityView | null>(null);
  const [publishStatus, setPublishStatus] = useState<PublishStatusView | null>(null);
  const [replyTitle, setReplyTitle] = useState("");
  const [replyComments, setReplyComments] = useState("");
  /** The second-press gate. Opening the confirm block is not sending; the button inside it is. */
  const [confirming, setConfirming] = useState(false);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      const next = await api.getInquiryDetailStrict(workItemId);
      setDetail(next);
      // Seed the editor from the saved draft when there is one. A seller who saved a draft yesterday
      // must come back to it, not to an empty box that would overwrite it on the next save.
      setReplyTitle(next.draft?.title ?? (next.title ? `[답변] ${next.title}` : ""));
      setReplyComments(next.draft?.comments ?? "");
    } catch (e) {
      setDetail(null);
      setError(detailErrorMessage(isAxiosError(e) ? e.response?.status : undefined));
    } finally {
      setLoading(false);
    }
  }, [workItemId]);

  useEffect(() => {
    void load();
  }, [load]);

  useEffect(() => {
    // Read once per panel. A failure leaves `capability` null, which `canPublishReply` treats as "no"
    // — offering a marketplace write on a guess is the one thing this surface must never do.
    let live = true;
    void api
      .getInquiryPublishCapability()
      .then((c) => {
        if (live) setCapability(c);
      })
      .catch(() => {
        if (live) setCapability(null);
      });
    return () => {
      live = false;
    };
  }, [workItemId]);

  const draft = detail?.draft ?? null;
  const publishable = detail ? canPublishReply(detail, capability) : false;
  const unavailableReason = detail ? publishUnavailableReason(detail, capability) : null;
  const draftDirty = !!draft && (draft.title !== replyTitle || draft.comments !== replyComments);
  const draftEditable = canEditDraft(publishStatus);

  async function onSaveDraft() {
    if (!detail) return;
    setBusy(true);
    setActionError(null);
    try {
      const saved = await api.saveInquiryReplyDraft(workItemId, {
        title: replyTitle,
        comments: replyComments,
        // The version being edited FROM — `0` for the first save. A stale base is the seller's own
        // draft having moved (another tab, another device), which is a 409 rather than a silent
        // overwrite of whichever version they did not see.
        baseVersion: draft?.version ?? 0,
      });
      setDetail((current) => (current ? { ...current, draft: saved } : current));
      setReplyTitle(saved.title);
      setReplyComments(saved.comments);
      // A saved draft is a NEW version with a new fingerprint, so any confirm block that was open is
      // now about content that no longer exists. Close it rather than let a stale approval be pressed.
      setConfirming(false);
    } catch (e) {
      const info = classifyPublishError(isAxiosError(e) ? e.response?.status : undefined);
      setActionError(info.message);
      if (info.shouldRefresh) await load();
    } finally {
      setBusy(false);
    }
  }

  /**
   * **The one marketplace WRITE in this product.**
   *
   * `commandId` is minted HERE, once per press, so a network timeout followed by a retry cannot
   * become a second reply — the backend treats a repeat of the same id as the same confirm.
   * `expectedFingerprint` is the exact draft version shown above the button; a mismatch is a 409, and
   * the seller is sent back to re-read rather than having an approval applied to content they never saw.
   */
  async function onConfirmPublish() {
    if (!detail || !draft) return;
    setBusy(true);
    setActionError(null);
    try {
      const status = await api.confirmInquiryPublish(workItemId, {
        commandId: crypto.randomUUID(),
        expectedFingerprint: draft.contentFingerprint,
      });
      setPublishStatus(status);
      setConfirming(false);
      setDetail((current) => (current ? { ...current, phase: status.phase } : current));
    } catch (e) {
      const info = classifyPublishError(isAxiosError(e) ? e.response?.status : undefined);
      setActionError(info.message);
      if (info.shouldRefresh) await load();
    } finally {
      setBusy(false);
    }
  }

  /** Verify-only. It re-queries the channel's own status and NEVER resends — that is the whole point. */
  async function onVerifyPublish() {
    setBusy(true);
    setActionError(null);
    try {
      setPublishStatus(await api.verifyInquiryPublish(workItemId));
    } catch (e) {
      setActionError(classifyPublishError(isAxiosError(e) ? e.response?.status : undefined).message);
    } finally {
      setBusy(false);
    }
  }

  /** Resume a bound-but-undelivered publish. Dispatches only from ACTION_PENDING; never resends. */
  async function onResumePublish() {
    setBusy(true);
    setActionError(null);
    try {
      setPublishStatus(await api.resumeInquiryPublish(workItemId));
    } catch (e) {
      setActionError(classifyPublishError(isAxiosError(e) ? e.response?.status : undefined).message);
    } finally {
      setBusy(false);
    }
  }

  async function onGenerate() {
    setBusy(true);
    setActionError(null);
    try {
      const result = await api.generateInquiryProposal(workItemId);
      setDetail((current) =>
        current ? { ...current, phase: result.phase, proposal: result.proposal } : current,
      );
    } catch (e) {
      const info = classifyProposeError(isAxiosError(e) ? e.response?.status : undefined);
      setActionError(info.message);
      if (info.shouldRefresh) {
        await load();
      }
    } finally {
      setBusy(false);
    }
  }

  if (loading) {
    return <p className="text-base text-muted">문의 내용을 불러오는 중…</p>;
  }

  // Fail closed. Without the detail there is nothing honest to offer, so the panel says so and
  // offers no controls rather than presenting an empty workflow.
  if (error || !detail) {
    return <p className="text-base text-muted">{error ?? "문의 내용을 불러오지 못했습니다."}</p>;
  }

  return (
    <div className="space-y-5">
      <div>
        <h3 className="text-base font-bold text-ink">문의 내용</h3>
        {detail.title ? (
          <p className="mt-2 break-keep font-semibold text-ink">{detail.title}</p>
        ) : null}
        <p className="mt-1.5 whitespace-pre-wrap break-keep leading-relaxed text-ink">
          {detail.details ?? "본문이 없습니다."}
        </p>
        <p className="mt-2 text-sm text-muted">{phaseLabel(detail.phase)}</p>
      </div>

      <div className="rounded-xl border border-line bg-canvas p-5">
        <h3 className="text-base font-bold text-ink">응답 제안</h3>
        <p className="mt-1.5 break-keep text-sm leading-relaxed text-muted">
          어떤 유형으로 답하면 좋을지 제안합니다. 답변 문구는 판매자가 직접 작성하고, 고객에게
          보내는 것도 판매자가 채널에서 직접 합니다.
        </p>

        {detail.proposal ? (
          <div className="mt-4">
            <p className="break-keep text-lg font-semibold text-ink">
              {proposalCategoryLabel(detail.proposal.summaryCategory)}
            </p>
            <p className="mt-1 text-sm text-muted">{provenanceText(detail.proposal)}</p>
          </div>
        ) : canGenerateProposal(detail.phase) ? (
          <div className="mt-4">
            <Btn size="sm" onClick={onGenerate} disabled={busy}>
              {busy ? "만드는 중…" : "응답 제안 만들기"}
            </Btn>
          </div>
        ) : (
          <p className="mt-4 text-sm text-muted">
            지금 상태에서는 제안을 만들 수 없습니다. 목록에서 상태를 확인해 주세요.
          </p>
        )}

        {actionError ? <p className="mt-3 text-sm text-bad">{actionError}</p> : null}
      </div>

      <div className="rounded-xl border border-line bg-canvas p-5">
        <h3 className="text-base font-bold text-ink">답변 초안</h3>
        <p className="mt-1.5 break-keep text-sm leading-relaxed text-muted">
          답변 문구를 작성해 저장하면, 저장한 그 내용 그대로만 등록됩니다.
        </p>

        <label className="mt-4 block text-sm font-medium text-ink" htmlFor="reply-title">
          제목
        </label>
        <input
          id="reply-title"
          className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-ink"
          value={replyTitle}
          onChange={(e) => setReplyTitle(e.target.value)}
          disabled={!draftEditable || busy}
        />

        <label className="mt-3 block text-sm font-medium text-ink" htmlFor="reply-comments">
          내용
        </label>
        <textarea
          id="reply-comments"
          className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-ink"
          rows={5}
          value={replyComments}
          onChange={(e) => setReplyComments(e.target.value)}
          disabled={!draftEditable || busy}
        />

        <div className="mt-3 flex flex-wrap items-center gap-3">
          <Btn size="sm" onClick={onSaveDraft} disabled={busy || !draftEditable || !replyComments.trim()}>
            {busy ? "저장 중…" : draft ? "초안 저장 (새 버전)" : "초안 저장"}
          </Btn>
          {draft ? (
            <span className="text-sm text-muted">
              저장된 버전 {draft.version}
              {draftDirty ? " · 편집한 내용은 아직 저장되지 않았습니다" : ""}
            </span>
          ) : null}
        </div>

        {/*
          The send, or the honest reason there is none. `publishUnavailableReason` names WHICH of the
          three conditions failed, because "이 채널은 판매자센터에서 직접" and "이 환경에서는 대신
          등록하지 않습니다" are different things for the seller to do about it.
        */}
        {!publishable ? (
          <p className="mt-4 break-keep text-sm leading-relaxed text-muted">{unavailableReason}</p>
        ) : !draft ? (
          <p className="mt-4 text-sm text-muted">먼저 초안을 저장해 주세요. 저장한 내용만 등록할 수 있습니다.</p>
        ) : draftDirty ? (
          // A dirty editor means the fingerprint on screen is not the fingerprint that would be sent.
          // Blocking here is kinder than letting the backend answer 409 after the seller has confirmed.
          <p className="mt-4 text-sm text-muted">
            편집한 내용을 먼저 저장해 주세요. 저장된 버전만 등록할 수 있습니다.
          </p>
        ) : publishStatus ? null : !confirming ? (
          <div className="mt-4">
            <Btn size="sm" onClick={() => setConfirming(true)} disabled={busy}>
              {detail.channelNameKo ?? "채널"}에 답변 등록하기
            </Btn>
          </div>
        ) : (
          /*
            The second press. Everything that is about to happen is restated here — where it goes, which
            saved version, and that it cannot be taken back — because this is the only control in
            SellerOps that writes to a marketplace, and a seller should never discover afterwards which
            text was sent.
          */
          <div className="mt-4 rounded-xl border border-line bg-surface p-4" role="group" aria-label="답변 등록 확인">
            <p className="break-keep text-sm font-semibold text-ink">
              {detail.channelNameKo ?? "채널"}에 아래 내용을 등록합니다. 등록 후에는 취소할 수 없습니다.
            </p>
            <p className="mt-2 text-sm text-muted">저장된 버전 {draft.version}</p>
            <p className="mt-2 whitespace-pre-wrap break-keep rounded-lg bg-canvas p-3 text-sm leading-relaxed text-ink">
              {draft.comments}
            </p>
            <div className="mt-3 flex gap-2">
              <Btn size="sm" onClick={onConfirmPublish} disabled={busy}>
                {busy ? "등록 중…" : "확인, 등록합니다"}
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setConfirming(false)} disabled={busy}>
                취소
              </Btn>
            </div>
          </div>
        )}

        {publishStatus ? (
          <div className="mt-4 rounded-xl border border-line bg-surface p-4">
            <p className="break-keep text-sm text-ink">{publishCategoryLabel(publishStatus.category)}</p>
            {publishStatus.approvedDraftVersion !== null ? (
              <p className="mt-1 text-sm text-muted">등록한 버전 {publishStatus.approvedDraftVersion}</p>
            ) : null}
            <div className="mt-3 flex flex-wrap gap-2">
              {canVerifyPublish(publishStatus) ? (
                <Btn size="sm" variant="ghost" onClick={onVerifyPublish} disabled={busy}>
                  상태 다시 확인
                </Btn>
              ) : null}
              {canResumePublish(publishStatus) ? (
                <Btn size="sm" variant="ghost" onClick={onResumePublish} disabled={busy}>
                  이어서 등록
                </Btn>
              ) : null}
            </div>
          </div>
        ) : null}
      </div>
    </div>
  );
}
