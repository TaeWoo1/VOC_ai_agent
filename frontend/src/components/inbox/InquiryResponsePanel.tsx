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
import type { InquiryDetail } from "../../lib/types";
import { Btn } from "../ui/Btn";

/**
 * The inquiry response workflow, transplanted from the standalone 문의 응답 page into the inbox
 * detail panel. The engine (`inquiryWorkflow`) is reused unchanged; only the surface is new.
 *
 * WHAT THIS PRODUCES, STATED ACCURATELY. The existing generator returns a `ProposalView` with a
 * `summaryCategory` and its provenance — a suggested RESPONSE TYPE. It carries no reply body, and
 * its `providerKind` is `RULE_BASED`. Calling it an "AI 답변 초안" would describe something the
 * product does not produce, so the panel says what it is: a suggestion for how to respond, which
 * the seller then writes and sends themselves.
 *
 * There is no send. Not a disabled one, not a "곧" one — SellerOps does not post replies for the
 * seller, and this panel does not hint that it might.
 */
export function InquiryResponsePanel({ workItemId }: { workItemId: string }) {
  const [detail, setDetail] = useState<InquiryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [error, setError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [actionError, setActionError] = useState<string | null>(null);

  const load = useCallback(async () => {
    setLoading(true);
    setError(null);
    try {
      setDetail(await api.getInquiryDetailStrict(workItemId));
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
    </div>
  );
}
