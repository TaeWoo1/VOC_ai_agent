import { useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { Section } from "../components/Section";
import { api } from "../lib/apiClient";
import { useApiData } from "../lib/useApiData";
import type { InquiryDetail, InquiryQueueItem, ProposalView } from "../lib/types";
import {
  canGenerateProposal,
  classifyProposeError,
  detailErrorMessage,
  INQUIRY_TABS,
  PROPOSAL_SUCCESS_GUIDANCE,
  phaseLabel,
  proposalCategoryLabel,
  provenanceText,
  queueRowView,
  receivedDateLabel,
  resetForTab,
  statusLabel,
  tabFor,
  type InquiryTabKey,
} from "../lib/inquiryWorkflow";

const PAGE_SIZE = 20;

// Seller inquiry workflow: OPEN / PROPOSED tabs over the paged work queue →
// select → seller-only detail → generate a response-type proposal (OPEN only).
// Strict reads only (no mock fallback); the queue never exposes body/details/
// author, and the proposal is shown as a response-category suggestion, never a
// reply draft. There are no approval or send controls here.
export function Inquiries() {
  const [tab, setTab] = useState<InquiryTabKey>("OPEN");
  const [page, setPage] = useState(0);
  const [queueKey, setQueueKey] = useState(0);
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [successMessage, setSuccessMessage] = useState<string | null>(null);

  const activeTab = tabFor(tab);
  // Phase-specific queue: re-runs (and clears its own loading/error) whenever the
  // tab, page, or refresh key changes.
  const { data, loading, error } = useApiData(
    () => api.getInquiryQueueStrict({ phase: activeTab.phase, page, size: PAGE_SIZE }),
    [tab, page, queueKey],
  );

  const refreshQueue = () => setQueueKey((k) => k + 1);

  function changeTab(next: InquiryTabKey) {
    if (next === tab) {
      return;
    }
    // Reset page, selection/detail, and any transient success message on tab change.
    const reset = resetForTab(next);
    setTab(reset.tab);
    setPage(reset.page);
    setSelectedId(reset.selectedId);
    setSuccessMessage(reset.successMessage);
  }

  function selectItem(id: string) {
    setSelectedId(id);
    setSuccessMessage(null); // clear guidance once the seller drills into an item
  }

  // Successful generate: stay on the 응답 대기 tab, let the queue refresh drop the
  // item, and guide the seller to 제안 생성됨. The tab is NOT auto-switched.
  function onProposeSuccess() {
    refreshQueue();
    setSuccessMessage(PROPOSAL_SUCCESS_GUIDANCE);
  }

  return (
    <div className="space-y-6">
      <header>
        <h1 className="text-2xl font-bold">문의 응답</h1>
        <p className="text-lg text-muted">
          응답이 필요한 문의를 확인하고 응답 유형 제안을 생성합니다.
        </p>
      </header>

      <div className="flex gap-2">
        {INQUIRY_TABS.map((t) => (
          <button
            key={t.key}
            type="button"
            onClick={() => changeTab(t.key)}
            className={`rounded-xl px-4 py-2 text-base font-semibold transition ${
              t.key === tab ? "bg-brand/10 text-brand-700" : "text-ink hover:bg-canvas"
            }`}
          >
            {t.label}
          </button>
        ))}
      </div>

      {successMessage ? (
        <div className="rounded-xl bg-good/10 px-4 py-3 text-good">{successMessage}</div>
      ) : null}

      <Section
        title={activeTab.label}
        action={
          <button type="button" onClick={refreshQueue} className="btn-ghost px-3 py-1.5 text-sm">
            새로고침
          </button>
        }
      >
        {loading ? (
          <p className="text-muted">불러오는 중…</p>
        ) : error || !data ? (
          <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
            문의 목록을 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
            <button
              type="button"
              onClick={refreshQueue}
              className="btn-ghost ml-3 px-3 py-1.5 text-sm"
            >
              다시 시도
            </button>
          </div>
        ) : data.content.length === 0 ? (
          <div className="rounded-xl border border-dashed border-line py-12 text-center">
            <p className="text-lg font-medium text-ink">{activeTab.emptyCopy}</p>
            <p className="mt-1 text-base text-muted">{activeTab.emptySubCopy}</p>
          </div>
        ) : (
          <>
            <ul className="space-y-2">
              {data.content.map((item) => (
                <li key={item.workItemId}>
                  <QueueRow
                    item={item}
                    selected={item.workItemId === selectedId}
                    onSelect={() => selectItem(item.workItemId)}
                  />
                </li>
              ))}
            </ul>
            {data.totalPages > 1 ? (
              <div className="mt-4 flex items-center justify-between">
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40"
                  onClick={() => setPage((p) => Math.max(0, p - 1))}
                  disabled={data.page <= 0}
                >
                  이전
                </button>
                <span className="text-sm text-muted">
                  {data.page + 1} / {data.totalPages}
                </span>
                <button
                  type="button"
                  className="btn-ghost px-3 py-1.5 text-sm disabled:opacity-40"
                  onClick={() => setPage((p) => p + 1)}
                  disabled={data.page + 1 >= data.totalPages}
                >
                  다음
                </button>
              </div>
            ) : null}
          </>
        )}
      </Section>

      {selectedId ? (
        <InquiryDetailPanel
          workItemId={selectedId}
          onClose={() => setSelectedId(null)}
          onProposed={refreshQueue}
          onProposeSuccess={onProposeSuccess}
        />
      ) : null}
    </div>
  );
}

function QueueRow({
  item,
  selected,
  onSelect,
}: {
  item: InquiryQueueItem;
  selected: boolean;
  onSelect: () => void;
}) {
  const row = queueRowView(item);
  return (
    <button
      type="button"
      onClick={onSelect}
      className={`flex w-full items-center justify-between gap-3 rounded-xl border px-4 py-3 text-left transition ${
        selected ? "border-brand bg-brand/5" : "border-line hover:bg-canvas"
      }`}
    >
      <div className="min-w-0">
        {/* Queue row is sanitized: title only, never the inquiry body/details. */}
        <p className="truncate text-base font-semibold text-ink">{row.title}</p>
        <p className="text-sm text-muted">{row.receivedDate}</p>
      </div>
      <div className="flex shrink-0 items-center gap-2">
        <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-xs font-semibold text-ink">
          {row.statusLabel}
        </span>
        <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-xs text-muted">
          {row.phaseLabel}
        </span>
      </div>
    </button>
  );
}

function InquiryDetailPanel({
  workItemId,
  onClose,
  onProposed,
  onProposeSuccess,
}: {
  workItemId: string;
  onClose: () => void;
  onProposed: () => void;
  onProposeSuccess: () => void;
}) {
  const [detail, setDetail] = useState<InquiryDetail | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState<string | null>(null);
  const [detailKey, setDetailKey] = useState(0);
  const [generating, setGenerating] = useState(false);
  const [proposeError, setProposeError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setLoadError(null);
    setProposeError(null);
    api
      .getInquiryDetailStrict(workItemId)
      .then((d) => {
        if (active) {
          setDetail(d);
        }
      })
      .catch((e) => {
        if (!active) {
          return;
        }
        setDetail(null);
        setLoadError(detailErrorMessage(isAxiosError(e) ? e.response?.status : undefined));
      })
      .finally(() => {
        if (active) {
          setLoading(false);
        }
      });
    return () => {
      active = false;
    };
  }, [workItemId, detailKey]);

  const reloadDetail = () => setDetailKey((k) => k + 1);

  async function onGenerate() {
    setGenerating(true);
    setProposeError(null);
    try {
      await api.generateInquiryProposal(workItemId);
      reloadDetail(); // detail refetch → PROPOSED + proposal
      onProposed(); // queue refresh → the item leaves the OPEN list
      onProposeSuccess(); // page shows the "find it under 제안 생성됨" guidance
    } catch (e) {
      const info = classifyProposeError(isAxiosError(e) ? e.response?.status : undefined);
      setProposeError(info.message);
      if (info.shouldRefresh) {
        reloadDetail();
        onProposed();
      }
    } finally {
      setGenerating(false);
    }
  }

  return (
    <div className="mt-2 rounded-2xl border border-line bg-surface p-6 shadow-card">
      <div className="mb-4 flex items-center justify-between">
        <h2 className="text-xl font-bold text-ink">문의 상세</h2>
        <button type="button" onClick={onClose} className="btn-ghost px-3 py-1.5 text-sm">
          닫기
        </button>
      </div>
      {loading ? (
        <p className="text-muted">불러오는 중…</p>
      ) : loadError || !detail ? (
        <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
          {loadError ?? "문의를 불러오지 못했습니다."}
          <button
            type="button"
            onClick={reloadDetail}
            className="btn-ghost ml-3 px-3 py-1.5 text-sm"
          >
            다시 시도
          </button>
        </div>
      ) : (
        <DetailBody
          detail={detail}
          generating={generating}
          proposeError={proposeError}
          onGenerate={onGenerate}
        />
      )}
    </div>
  );
}

function DetailBody({
  detail,
  generating,
  proposeError,
  onGenerate,
}: {
  detail: InquiryDetail;
  generating: boolean;
  proposeError: string | null;
  onGenerate: () => void;
}) {
  return (
    <div className="space-y-5">
      <div>
        <div className="mb-2 flex flex-wrap items-center gap-2">
          <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-sm font-semibold text-ink">
            {phaseLabel(detail.phase)}
          </span>
          <span className="rounded-full bg-ink/5 px-2.5 py-0.5 text-sm text-muted">
            {statusLabel(detail.status)}
          </span>
          <span className="text-sm text-muted">{receivedDateLabel(detail.receivedAt)}</span>
        </div>
        {/* Seller-only: the seller owns their inquiry title/details (never the author). */}
        <h3 className="text-lg font-bold text-ink">{detail.title ?? "(제목 없음)"}</h3>
        <p className="mt-2 whitespace-pre-wrap text-base text-ink">
          {detail.details ?? "문의 본문이 없습니다."}
        </p>
      </div>

      {detail.proposal ? (
        <ProposalCard proposal={detail.proposal} />
      ) : canGenerateProposal(detail.phase) ? (
        <div className="rounded-xl border border-line bg-canvas/40 p-4">
          <p className="mb-3 text-sm text-muted">
            응답 유형 제안을 생성합니다. 실제 답변 문구는 포함되지 않습니다.
          </p>
          <button type="button" className="btn-primary" onClick={onGenerate} disabled={generating}>
            {generating ? "생성 중…" : "응답 제안 생성"}
          </button>
          {proposeError ? (
            <p className="mt-3 rounded-xl bg-bad/10 px-4 py-2 text-sm text-bad">{proposeError}</p>
          ) : null}
        </div>
      ) : (
        <p className="text-sm text-muted">이 문의는 제안을 생성할 수 없는 상태입니다.</p>
      )}
    </div>
  );
}

function ProposalCard({ proposal }: { proposal: ProposalView }) {
  return (
    <div className="rounded-xl border border-brand/30 bg-brand/5 p-4">
      <p className="text-sm font-semibold text-brand-700">추천 응답 유형</p>
      <p className="mt-1 text-lg font-bold text-ink">
        {proposalCategoryLabel(proposal.summaryCategory)}
      </p>
      <p className="mt-1 text-sm text-muted">
        이 제안은 응답 유형 추천이며, 실제 답변 문구(초안)가 아닙니다.
      </p>
      {proposal.requiresApproval ? (
        <p className="mt-2 text-sm text-muted">발송 전 셀러 승인이 필요합니다.</p>
      ) : null}
      {/* Provenance only — humanized kind + name/version, no raw provider data. */}
      <p className="mt-3 text-xs text-muted">{provenanceText(proposal)}</p>
    </div>
  );
}
