import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isAxiosError } from "axios";
import type { ApprovalRequiredArtifact } from "../../../lib/conversation/types";
import type { ReviewReplyPrep } from "../../../lib/types";
import { api } from "../../../lib/apiClient";
import { newCommandId } from "../../../lib/commandId";
import { analytics } from "../../../lib/analytics";
import { Btn } from "../../ui/Btn";
import { Status } from "../../ui/Status";
import { ArtifactCard } from "./ArtifactCard";
import { GuidedReplyAction } from "./GuidedExecutionArtifact";

/**
 * <b>The seller approves the exact reply, in the conversation they are already in.</b>
 * (Guided Reply UX Smoothing v1 §1–§2)
 *
 * Until this card, the guided lane offered 「네이버에서 답변하기」 for a review whose draft nobody had
 * approved — and the backend refuses to mint a run without a standing approval. The only way through
 * was to leave for the reply-work screen, approve there, and find the way back to the thread that knew
 * which review it was. That is the defect this closes; it is not a new capability.
 *
 * <b>Four rules hold the safety story, and each one is a shape rather than a promise.</b>
 *
 * <ol>
 *   <li><b>The card cannot approve what it did not just read.</b> No draft text rides on the artifact:
 *       mount re-reads the review's own reply-prep view, renders THAT head, and approves THAT version.
 *       A draft that moved between the runtime composing this card and the seller reading it is shown
 *       with its new text and a line saying so — the approval binds to what is on screen, always.</li>
 *   <li><b>A stale approval cannot be reused.</b> Approving freezes the text; to edit, the seller
 *       withdraws on the reply-work screen, and the withdrawn (or re-versioned) state brings this card
 *       back to 「승인 필요」 — the guided primary is not rendered at all. The backend enforces the same
 *       rule independently when the run is minted.</li>
 *   <li><b>Only a press approves.</b> No sentence, model output or artifact field can reach the
 *       approval seam: the runtime that writes this card has no path to it (asserted on the runtime's
 *       source), and in this app the call lives in this one module (`conversationWriteFence`).</li>
 *   <li><b>Approval is not a send.</b> It records a human decision against a version. What follows is
 *       the guided lane, which fills a composer and stops; 등록 is still the seller's own click in the
 *       seller center.</li>
 * </ol>
 */
export function ReplyApprovalArtifact({ artifact }: { artifact: ApprovalRequiredArtifact }) {
  const { accountId, actionRef } = artifact;
  const [prep, setPrep] = useState<ReviewReplyPrep | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const channel = artifact.channelNameKo ?? "네이버";

  const read = useCallback(async () => {
    const p = await api.getReviewReplyPrep(accountId, actionRef).catch(() => null);
    setPrep(p);
    setLoaded(true);
  }, [accountId, actionRef]);

  useEffect(() => {
    analytics.track("approval_opened");
    let live = true;
    void api
      .getReviewReplyPrep(accountId, actionRef)
      .catch(() => null)
      .then((p) => {
        if (!live) return;
        setPrep(p);
        setLoaded(true);
      });
    return () => {
      live = false;
    };
  }, [accountId, actionRef]);

  const draft = prep?.draft ?? null;
  const approval = prep?.approval ?? null;
  // The same binding question the runtime and the backend both ask: version AND fingerprint, against
  // the head that is on this screen. A version number equal by coincidence is not the same sentence.
  const approved =
    approval?.state === "APPROVED" &&
    draft != null &&
    approval.approvedVersion === draft.version &&
    approval.approvedFingerprint === draft.contentFingerprint;
  // The runtime named a head when it composed the card; if the stored head is a different one, the card
  // says so and offers the CURRENT text. It never silently approves a version the seller did not read.
  const moved = draft != null && draft.contentFingerprint !== artifact.contentFingerprint;
  const canApprove = !!draft && !approved && (prep?.capabilities.canApprove ?? false);

  async function approve() {
    if (!draft || busy) return;
    setBusy(true);
    setError(null);
    try {
      await api.decideReviewReplyApproval(accountId, actionRef, {
        commandId: newCommandId(),
        state: "APPROVED",
        // The version ON SCREEN — not the one the runtime saw. This is what makes the read above the
        // binding rather than a display detail.
        baseVersion: draft.version,
      });
      await read();
    } catch (e) {
      const status = isAxiosError(e) ? e.response?.status : undefined;
      setError(
        status === 409
          ? "이 답변이 그 사이 바뀌었습니다. 현재 내용을 다시 확인한 뒤 승인해 주세요."
          : "승인을 기록하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
      await read();
    } finally {
      setBusy(false);
    }
  }

  const meta =
    [artifact.productName, prep?.rating != null ? `별점 ${prep.rating}점` : null, prep?.reviewDate, draft ? `초안 버전 ${draft.version}` : null]
      .filter(Boolean)
      .join(" · ") || artifact.channelNameKo || null;

  return (
    <ArtifactCard title={approved ? "답변을 승인했습니다" : artifact.title} note={meta} testId="reply-approval-artifact" framed>
      <div className="space-y-3 px-4 pb-3">
        {!loaded ? <p className="text-sm text-muted">확인하는 중…</p> : null}
        {loaded && !prep ? (
          <p className="break-keep text-sm text-muted">이 리뷰의 답변을 다시 읽지 못했습니다. 아래에서 확인해 주세요.</p>
        ) : null}
        {loaded && prep && !draft ? (
          <p className="break-keep text-sm text-muted">아직 승인할 초안이 없습니다.</p>
        ) : null}

        {/* The customer's own sentence, small and quiet: it is what the reply answers, not what the
            seller is deciding about. The decision is the draft, so the draft is the large type. */}
        {prep?.redactedBody ? (
          <p className="whitespace-pre-wrap break-keep text-sm text-muted" data-testid="reply-approval-review">
            고객: {prep.redactedBody}
          </p>
        ) : null}

        {draft ? (
          <p
            className="whitespace-pre-wrap break-keep border-l-2 border-brand-700/30 pl-3 text-lg leading-relaxed text-ink"
            data-testid="reply-approval-draft"
          >
            {draft.body}
          </p>
        ) : null}

        {draft && moved && !approved ? (
          <p className="break-keep text-sm text-warn" role="status">
            이 답변은 그 사이 수정되었습니다. 위 내용이 현재 저장된 초안입니다.
          </p>
        ) : null}
        {error ? <p className="break-keep text-sm text-bad" role="alert">{error}</p> : null}

        {loaded && canApprove ? (
          <div className="space-y-1">
            <Btn onClick={() => void approve()} disabled={busy} data-testid="reply-approval-approve">
              {busy ? "승인하는 중…" : "이 답변으로 승인"}
            </Btn>
            <p className="break-keep text-sm text-muted">승인해도 아직 등록되지 않습니다. 등록은 판매자님이 {channel}에서 누릅니다.</p>
          </div>
        ) : null}

        {loaded && draft && !approved && !canApprove ? (
          <p className="break-keep text-sm text-muted">이 리뷰는 지금 승인할 수 없습니다. 아래에서 상태를 확인해 주세요.</p>
        ) : null}

        {approved ? (
          <div className="space-y-3" data-testid="reply-approval-approved">
            {/* ONE rendering per fact: the card's own title is 「답변을 승인했습니다」, so the sentence is
                not printed again underneath it. The chip stays — it is the scannable state marker beside
                the text, and it carries its own word. */}
            <p role="status"><Status tone="good">승인함</Status></p>
            {/* The guided lane is REACHED BY RENDERING the module that owns it — this card never calls
                into the helper, mints a run, or holds a runtime. That is why the write fence can keep
                「approve」 and 「mint a run」 in two different files. */}
            <GuidedReplyAction target={{ accountId, actionRef, channelNameKo: artifact.channelNameKo, to: artifact.to }} />
          </div>
        ) : (
          <p className="text-sm">
            <Link to={artifact.to} className="text-muted hover:text-ink hover:underline">이 리뷰의 답변 작업 열기</Link>
          </p>
        )}
      </div>
    </ArtifactCard>
  );
}
