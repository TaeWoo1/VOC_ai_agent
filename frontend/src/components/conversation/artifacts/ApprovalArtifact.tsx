import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import { isAxiosError } from "axios";
import type { ApprovalArtifact as Approval } from "../../../lib/conversation/types";
import type { InquiryDetail, PublishCapabilityView, ReviewExecutionView, ReviewReplyPrep } from "../../../lib/types";
import { api } from "../../../lib/apiClient";
import { canPublishReply, classifyPublishError, publishUnavailableReason } from "../../../lib/inquiryPublish";
import { newCommandId } from "../../../lib/commandId";
import { copyText } from "../../../lib/clipboard";
import { analytics } from "../../../lib/analytics";
import { Btn } from "../../ui/Btn";
import { ArtifactCard } from "./ArtifactCard";
import { ExecutionResultView } from "./ExecutionResultArtifact";

/**
 * <b>The only conversation module allowed to reach a publish/execute path.</b>
 *
 * Two object kinds, one discipline. INQUIRY does exactly what the inquiry screen does and nothing
 * shorter: the capability read decides whether a send control exists at all (fail closed on a read that
 * did not land), the stored draft is re-read so the fingerprint on screen is the one the approval binds
 * to, a first press reveals the confirm step, and only the second press calls the ONE marketplace WRITE —
 * with a command id minted per press and the exact fingerprint. REVIEW (Cafe24, `API_EXECUTION`) does the
 * same over the review reply seam: the APPROVED head is re-read, the fingerprint must match, and the second
 * press calls `/reply/execute` once; the result carries its own verification word and is never retried.
 *
 * <b>Identity gates everything.</b> `executableIdentity = NONE` means the row came from a file, not from
 * the marketplace — there is no provider object to answer, so no send control exists and the artifact says
 * so in one sentence. A draft that moved is a 409 and the seller re-reads.
 */
export function ApprovalArtifact({ artifact }: { artifact: Approval }) {
  return artifact.objectKind === "REVIEW" ? <ReviewApproval artifact={artifact} /> : <InquiryApproval artifact={artifact} />;
}

const NOT_MARKETPLACE: Record<Approval["objectKind"], string> = {
  INQUIRY: "이 문의는 파일로 가져온 기록이라 채널로 보낼 수 없습니다. 초안을 복사해 직접 등록해 주세요.",
  REVIEW: "이 리뷰는 파일로 가져온 기록이라 채널로 보낼 수 없습니다. 초안을 복사해 직접 등록해 주세요.",
};

function CopyPath({ body, reason }: { body: string | null; reason: string | null }) {
  const [copied, setCopied] = useState<"idle" | "done" | "failed">("idle");
  async function copy() {
    if (!body) return;
    const result = await copyText(body);
    setCopied(result.ok ? "done" : "failed");
  }
  return (
    <div className="space-y-2">
      {reason ? <p className="break-keep text-sm text-muted">{reason}</p> : null}
      {body ? (
        <Btn variant="outline" size="sm" onClick={copy}>{copied === "done" ? "복사했습니다" : "초안 복사"}</Btn>
      ) : null}
      {copied === "failed" ? <p className="text-sm text-muted">이 브라우저에서는 복사할 수 없습니다.</p> : null}
    </div>
  );
}

function ConfirmStep({
  channel,
  busy,
  onConfirm,
  onCancel,
}: {
  channel: string;
  busy: boolean;
  onConfirm: () => void;
  onCancel: () => void;
}) {
  return (
    <div className="rounded-xl border border-line bg-canvas p-3" role="group" aria-label="전송 확인">
      <p className="break-keep text-base font-semibold text-ink">정말 보내시겠습니까?</p>
      <p className="mt-1 break-keep text-sm text-muted">위 초안이 {channel}의 고객에게 그대로 등록됩니다. 보낸 뒤에는 되돌릴 수 없습니다.</p>
      <div className="mt-3 flex flex-wrap gap-2">
        <Btn onClick={onConfirm} disabled={busy}>{busy ? "보내는 중…" : "승인하고 전송"}</Btn>
        <Btn variant="ghost" size="sm" onClick={onCancel} disabled={busy}>취소</Btn>
      </div>
    </div>
  );
}

function InquiryApproval({ artifact }: { artifact: Approval }) {
  const workItemId = artifact.workItemId ?? artifact.targetId;
  const [detail, setDetail] = useState<InquiryDetail | null>(null);
  const [capability, setCapability] = useState<PublishCapabilityView | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [status, setStatus] = useState<{ phase: string; category: string } | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    analytics.track("approval_opened");
    void (async () => {
      const [d, c] = await Promise.all([
        api.getInquiryDetailStrict(workItemId).catch(() => null),
        api.getInquiryPublishCapability().catch(() => null),
      ]);
      if (!live) return;
      setDetail(d);
      setCapability(c);
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [workItemId]);

  const draft = detail?.draft ?? null;
  const fingerprint = artifact.contentFingerprint;
  const marketplace = artifact.executableIdentity === "MARKETPLACE";
  const publishable = marketplace && detail ? canPublishReply(detail, capability) : false;
  const unavailable = !marketplace ? NOT_MARKETPLACE.INQUIRY : detail ? publishUnavailableReason(detail, capability) : null;
  const moved = draft != null && fingerprint != null && draft.contentFingerprint !== fingerprint;

  async function confirm() {
    if (!fingerprint || busy) return;
    setBusy(true);
    setError(null);
    try {
      const view = await api.confirmInquiryPublish(workItemId, {
        commandId: newCommandId(),
        expectedFingerprint: fingerprint,
      });
      setStatus({ phase: view.phase, category: view.category });
      setConfirming(false);
    } catch (e) {
      setError(classifyPublishError(isAxiosError(e) ? e.response?.status : undefined).message);
    } finally {
      setBusy(false);
    }
  }

  const meta = [artifact.channelNameKo, artifact.draftVersion != null ? `초안 버전 ${artifact.draftVersion}` : null].filter(Boolean).join(" · ") || null;

  if (status) {
    return (
      <ArtifactCard title="전송 결과" note={meta} testId="approval-artifact">
        <div className="px-4 pb-3">
          <ExecutionResultView phase={status.phase} category={status.category} objectKind="INQUIRY" to={artifact.to} />
        </div>
      </ArtifactCard>
    );
  }

  return (
    <ArtifactCard title={artifact.title} note={meta} testId="approval-artifact">
      <div className="space-y-3 px-4 pb-3">
        {!loaded ? <p className="text-sm text-muted">확인하는 중…</p> : null}
        {loaded && !detail ? <p className="text-sm text-muted">이 문의를 다시 읽지 못했습니다. 문의 화면에서 확인해 주세요.</p> : null}
        {draft ? (
          <p className="whitespace-pre-wrap break-keep rounded-xl bg-canvas px-3 py-2 text-base leading-relaxed text-ink">{draft.comments}</p>
        ) : null}
        {moved ? (
          <p className="break-keep text-sm text-warn" role="status">초안이 그 사이 변경되었습니다. 문의 화면에서 현재 내용을 확인한 뒤 보내 주세요.</p>
        ) : null}
        {error ? <p className="text-sm text-bad" role="alert">{error}</p> : null}

        {loaded && detail && publishable && !moved && fingerprint ? (
          !confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <Btn onClick={() => setConfirming(true)} disabled={busy}>답변 보내기</Btn>
              <span className="text-sm text-muted">승인 전에는 아무것도 나가지 않습니다.</span>
            </div>
          ) : (
            <ConfirmStep channel={artifact.channelNameKo ?? "채널"} busy={busy} onConfirm={confirm} onCancel={() => setConfirming(false)} />
          )
        ) : null}

        {loaded && detail && !publishable ? <CopyPath body={draft?.comments ?? null} reason={unavailable} /> : null}

        <p className="text-sm">
          <Link to={artifact.to} className="font-semibold text-brand-700 hover:underline">문의 화면에서 확인</Link>
        </p>
      </div>
    </ArtifactCard>
  );
}

/** Why a review cannot be sent from here, by the runtime's execution verdict. Closed words, no API talk. */
const REVIEW_UNAVAILABLE: Record<Approval["execution"], string | null> = {
  API_EXECUTION: null,
  GUIDED_BROWSER_EXECUTION: "이 채널은 판매자센터 화면에서 직접 등록합니다. 초안을 복사해 사용해 주세요.",
  NOT_SUPPORTED: "이 채널은 판매자가 리뷰에 답글을 남기는 기능을 지원하지 않습니다.",
};

function ReviewApproval({ artifact }: { artifact: Approval }) {
  const accountId = artifact.accountId ?? null;
  const actionRef = artifact.actionRef ?? null;
  const [prep, setPrep] = useState<ReviewReplyPrep | null>(null);
  const [loaded, setLoaded] = useState(false);
  const [confirming, setConfirming] = useState(false);
  const [busy, setBusy] = useState(false);
  const [result, setResult] = useState<ReviewExecutionView | null>(null);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let live = true;
    analytics.track("approval_opened");
    void (async () => {
      const p = accountId && actionRef ? await api.getReviewReplyPrep(accountId, actionRef).catch(() => null) : null;
      if (!live) return;
      setPrep(p);
      setLoaded(true);
    })();
    return () => {
      live = false;
    };
  }, [accountId, actionRef]);

  const approval = prep?.approval ?? null;
  const approved = approval?.state === "APPROVED";
  const body = approved ? approval?.approvedBody ?? null : prep?.draft?.body ?? null;
  const fingerprint = artifact.contentFingerprint;
  const marketplace = artifact.executableIdentity === "MARKETPLACE";
  const moved = approved && fingerprint != null && approval?.approvedFingerprint !== fingerprint;
  const executable = marketplace && artifact.execution === "API_EXECUTION" && approved && !moved && fingerprint != null && !!accountId && !!actionRef;
  const unavailable = !marketplace
    ? NOT_MARKETPLACE.REVIEW
    : REVIEW_UNAVAILABLE[artifact.execution] ?? (!approved ? "승인된 답변이 없습니다. 리뷰 화면에서 답변을 승인한 뒤 보낼 수 있습니다." : null);

  async function confirm() {
    if (!executable || busy || !accountId || !actionRef || !fingerprint) return;
    setBusy(true);
    setError(null);
    try {
      const view = await api.executeReviewReply(accountId, actionRef, {
        commandId: newCommandId(),
        expectedFingerprint: fingerprint,
      });
      setResult(view);
      setConfirming(false);
    } catch (e) {
      setError(classifyPublishError(isAxiosError(e) ? e.response?.status : undefined).message);
    } finally {
      setBusy(false);
    }
  }

  const meta = [artifact.channelNameKo, artifact.draftVersion != null ? `답변 버전 ${artifact.draftVersion}` : null].filter(Boolean).join(" · ") || null;

  if (result) {
    return (
      <ArtifactCard title="전송 결과" note={meta} testId="approval-artifact">
        <div className="px-4 pb-3">
          <ExecutionResultView phase={result.status} category={result.category} verification={result.verification} objectKind="REVIEW" to={artifact.to} />
        </div>
      </ArtifactCard>
    );
  }

  return (
    <ArtifactCard title={artifact.title} note={meta} testId="approval-artifact">
      <div className="space-y-3 px-4 pb-3">
        {!loaded ? <p className="text-sm text-muted">확인하는 중…</p> : null}
        {loaded && !prep ? <p className="text-sm text-muted">이 리뷰의 답변을 다시 읽지 못했습니다. 리뷰 화면에서 확인해 주세요.</p> : null}
        {body ? (
          <p className="whitespace-pre-wrap break-keep rounded-xl bg-canvas px-3 py-2 text-base leading-relaxed text-ink">{body}</p>
        ) : null}
        {moved ? (
          <p className="break-keep text-sm text-warn" role="status">승인된 답변이 그 사이 변경되었습니다. 리뷰 화면에서 현재 내용을 확인한 뒤 보내 주세요.</p>
        ) : null}
        {error ? <p className="text-sm text-bad" role="alert">{error}</p> : null}

        {loaded && prep && executable ? (
          !confirming ? (
            <div className="flex flex-wrap items-center gap-2">
              <Btn onClick={() => setConfirming(true)} disabled={busy}>답변 보내기</Btn>
              <span className="text-sm text-muted">승인 전에는 아무것도 나가지 않습니다.</span>
            </div>
          ) : (
            <ConfirmStep channel={artifact.channelNameKo ?? "채널"} busy={busy} onConfirm={confirm} onCancel={() => setConfirming(false)} />
          )
        ) : null}

        {loaded && prep && !executable && !moved ? <CopyPath body={body} reason={unavailable} /> : null}

        <p className="text-sm">
          <Link to={artifact.to} className="font-semibold text-brand-700 hover:underline">리뷰 화면에서 확인</Link>
        </p>
      </div>
    </ArtifactCard>
  );
}
