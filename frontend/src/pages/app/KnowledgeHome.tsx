import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  KnowledgeCandidateView,
  KnowledgeDocumentView,
  KnowledgeSummaryView,
} from "../../lib/types";
import { api } from "../../lib/apiClient";
import { useAgentSurface } from "../../lib/agentPanel";
import { Btn } from "../../components/ui/Btn";
import { WorkFlowCard } from "../../components/ui/WorkFlowCard";
import { COPY } from "../../lib/copy/customerOps";
import { KnowledgeInbox } from "../../components/knowledge/KnowledgeInbox";
import { LearnedKnowledge } from "../../components/knowledge/LearnedKnowledge";
import {
  KnowledgeDocumentAdd,
  KnowledgeDocumentList,
} from "../../components/knowledge/KnowledgeDocuments";

/**
 * <b>reviewnary가 알고 있는 정보</b> — what the company has told reviewnary, what reviewnary already
 * read by itself, and what it is still asking. (Knowledge Setup &amp; Inbox UX v1 §2, §7, §10)
 *
 * <p><b>The screen used not to keep its own title.</b> It listed the files the seller had handed
 * over and linked away for everything else, so a company holding 38 written product facts, 6
 * operating rules, 23 past answers and 308 collected products read as a company holding three
 * files — and a company holding none was told 「지금 확인하실 항목은 없습니다」 two minutes after
 * signing up, which is arithmetically true and reads as 「you have nothing; start typing」.
 *
 * <p><b>Order is the argument.</b> 확인 필요 first, because it is the only part with anything to
 * decide. Then 알고 있는 정보 — the numbers, including the one reviewnary was never told
 * (상품 정보), which is what makes 「이미 사용 중인 자료를 연결해 주세요」 a true sentence rather
 * than a slogan. Then 자료, then the two places a person writes.
 *
 * <p><b>v3.1 layout</b> (Customer Operations v3.1): 「보유 정보 → 입력 필요」, then the 입력 필요 list, then one
 * 「출처」 surface whose two tabs are the files handed over and what was collected from the channels. The four-count
 * section and the 「직접 등록」 links are gone from the page — the counts are in the first card and the two writing
 * screens are under 「+ 추가」.
 *
 * <p><b>Internal vocabulary stays out.</b> No chunk, no embedding, no source id, no score, no enum —
 * `lib/knowledgeWords.ts` owns every word, and a token it has no name for renders as nothing.
 */
export function KnowledgeHome() {
  const [documents, setDocuments] = useState<KnowledgeDocumentView[] | null>(null);
  const [candidates, setCandidates] = useState<KnowledgeCandidateView[] | null>(null);
  const [summary, setSummary] = useState<KnowledgeSummaryView | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  // The same conversation every other screen opens — the panel, not a second chat (Reports v1 §3).
  // WHAT TRAVELS IS THE SCREEN, and only the screen: there is no knowledge READ tool in the runtime's
  // catalogue, so a document id would be a hint no tool could turn into a fact. Registered
  // unconditionally so the header names this page while it is still loading.
  useAgentSurface({ surface: "knowledge", label: COPY.knowledgeTitle });

  const load = useCallback(async () => {
    const [docs, cands, sum] = await Promise.all([
      api.getKnowledgeDocuments().catch(() => null),
      api.getKnowledgeCandidates().catch(() => null),
      api.getKnowledgeSummary().catch(() => null),
    ]);
    setDocuments(docs ?? []);
    setCandidates(cands ?? []);
    setSummary(sum);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function propose() {
    setBusy(true);
    setError(null);
    setNotice(null);
    try {
      const next = await api.proposeKnowledgeCandidates();
      setCandidates(next);
      setNotice(
        next.length === 0
          ? "반복 문장 없음"
          : `기준 후보 ${next.length}건`,
      );
      setSummary(await api.getKnowledgeSummary().catch(() => summary));
    } catch {
      setError("과거 답변 확인 실패 · 다시 시도");
    } finally {
      setBusy(false);
    }
  }

  const loading = documents === null || candidates === null;
  const pending = summary?.needsConfirmation ?? 0;
  // What the 입력 필요 count is made of, from the rows this page actually drew — 「답변 근거 없음」 is only true of
  // the drafting gaps, so the line names each kind instead of one sentence for all of them.
  const pendingKinds: string[] = loading
    ? []
    : ([
        ["정보 부족", candidates.filter((c) => c.origin === "DRAFT_GAP").length],
        ["기준 후보", candidates.filter((c) => c.origin !== "DRAFT_GAP").length],
        ["자료 문제", documents.filter((d) => d.active && d.passages === 0).length],
      ] as const)
        .filter(([, n]) => n > 0)
        .map(([label, n]) => `${label} ${n}`);

  return (
    <div className="mx-auto flex w-full max-w-[900px] flex-col gap-5">
      <header className="flex flex-wrap items-center justify-between gap-3">
        <h1 className="text-[25px] font-extrabold leading-tight tracking-tight text-ink">{COPY.knowledgeTitle}</h1>
        <AddMenu />
      </header>

      {error ? <p className="break-keep text-sm text-bad" role="alert">{error}</p> : null}
      {notice ? <p className="break-keep text-sm text-muted" role="status">{notice}</p> : null}

      {summary ? (
        <WorkFlowCard
          ariaLabel={`${COPY.held}, ${COPY.toEnter}`}
          done={
            summary.products > 0
              ? {
                  label: COPY.held,
                  value: summary.products.toLocaleString("ko-KR"),
                  unit: "개 상품 정보",
                  line: <HeldLine summary={summary} />,
                }
              : {
                  label: COPY.held,
                  value: COPY.nothingCollected,
                  phrase: true,
                  line: <HeldLine summary={summary} />,
                  action:
                    summary.pastAnswers === 0 ? (
                      <Link to="/connect" className="text-sm font-semibold text-brand-700 hover:underline">
                        {COPY.connectChannel}
                      </Link>
                    ) : undefined,
                }
          }
          mine={
            pending > 0
              ? {
                  label: COPY.toEnter,
                  value: pending.toLocaleString("ko-KR"),
                  unit: "건",
                  line: pendingKinds.length > 0 ? <span>{pendingKinds.join(" · ")}</span> : undefined,
                }
              : { label: COPY.toEnter, value: COPY.none }
          }
        />
      ) : null}

      <section aria-label={COPY.toEnter} className="flex flex-col gap-3">
        <div className="mt-3 flex items-center gap-2">
          <h2 className="text-[17px] font-bold tracking-tight text-ink">{COPY.toEnter}</h2>
          {summary && summary.pastAnswers > 0 ? (
            // Offered only when there is something to look through: a control whose one outcome is 「없음」 is not
            // an action, and on a first day it would be the loudest thing on the screen.
            <Btn size="sm" variant="ghost" className="ml-auto" onClick={() => void propose()} disabled={busy}>
              {busy ? "확인 중…" : COPY.findInPastAnswers}
            </Btn>
          ) : null}
        </div>
        {loading ? (
          <p className="text-sm text-muted">확인 중…</p>
        ) : (
          <KnowledgeInbox candidates={candidates} documents={documents} onChanged={load} />
        )}
      </section>

      <Sources documents={documents} loading={loading} onChanged={load} />
    </div>
  );
}

/** 「상품 지식 12 · 운영 기준 5 · 자료 4 · 과거 응답 23 (참고용)」 — separate counts, never a sum. */
function HeldLine({ summary }: { summary: KnowledgeSummaryView }) {
  const parts: [string, number][] = [
    ["상품 지식", summary.productKnowledge],
    ["운영 기준", summary.operatingRules],
    ["자료", summary.documents],
  ];
  return (
    <>
      {parts.map(([label, n], i) => (
        <span key={label} className="flex items-center gap-1.5">
          {i > 0 ? <span aria-hidden="true">·</span> : null}
          {label} {n.toLocaleString("ko-KR")}
        </span>
      ))}
      {summary.pastAnswers > 0 ? (
        <span className="flex items-center gap-1.5 text-muted">
          <span aria-hidden="true">·</span>
          과거 응답 {summary.pastAnswers.toLocaleString("ko-KR")} (참고용)
        </span>
      ) : null}
    </>
  );
}

/** The two places a person writes knowledge, under one control. Links, not forms: each screen owns its list. */
function AddMenu() {
  return (
    <details className="group relative">
      <summary className="inline-flex min-h-[36px] cursor-pointer list-none items-center rounded-lg border border-line bg-surface px-3 text-sm font-semibold text-ink hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700">
        {COPY.add}
      </summary>
      <div className="absolute right-0 z-10 mt-1.5 w-48 overflow-hidden rounded-xl bg-surface py-1 shadow-[0_0_0_1px_#E4E7EC,0_12px_28px_-12px_rgba(15,25,45,0.35)]">
        <Link to="/products" className="block px-3.5 py-2.5 text-sm text-ink hover:bg-canvas focus:bg-canvas focus:outline-none">
          상품 지식
        </Link>
        <Link to="/settings/policies" className="block px-3.5 py-2.5 text-sm text-ink hover:bg-canvas focus:bg-canvas focus:outline-none">
          운영 기준
        </Link>
      </div>
    </details>
  );
}

/** 「출처」: the files handed over, and what was collected from the channels — the same question asked by source. */
function Sources({
  documents,
  loading,
  onChanged,
}: {
  documents: KnowledgeDocumentView[] | null;
  loading: boolean;
  onChanged: () => Promise<void>;
}) {
  const [tab, setTab] = useState<"DOCUMENTS" | "LEARNED">("DOCUMENTS");
  const tabs: { key: "DOCUMENTS" | "LEARNED"; label: string }[] = [
    { key: "DOCUMENTS", label: `${COPY.documentsTab}${documents ? ` ${documents.length}` : ""}` },
    { key: "LEARNED", label: COPY.learnedTab },
  ];
  return (
    <section aria-label={COPY.sources} className="flex flex-col gap-3">
      <h2 className="mt-3 text-[17px] font-bold tracking-tight text-ink">{COPY.sources}</h2>
      <div className="rounded-[14px] bg-surface shadow-[0_0_0_1px_#E4E7EC]">
        <div className="flex flex-wrap items-center gap-1 border-b border-[#EEF0F3] p-1.5">
          <div role="tablist" aria-label={COPY.sources} className="flex flex-wrap items-center gap-1">
            {tabs.map((t) => (
              <button
                key={t.key}
                type="button"
                role="tab"
                id={`knowledge-tab-${t.key}`}
                aria-selected={tab === t.key}
                aria-controls={`knowledge-panel-${t.key}`}
                onClick={() => setTab(t.key)}
                className={`rounded-[9px] px-3 py-1.5 text-sm font-semibold focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 ${
                  tab === t.key ? "bg-[#F1F3F5] text-ink" : "text-muted hover:text-ink"
                }`}
              >
                {t.label}
              </button>
            ))}
          </div>
          {tab === "DOCUMENTS" ? (
            <span className="ml-auto pr-1">
              <KnowledgeDocumentAdd scope="ORG" onImported={onChanged} label={COPY.addDocument} />
            </span>
          ) : null}
        </div>
        <div
          role="tabpanel"
          id={`knowledge-panel-${tab}`}
          aria-labelledby={`knowledge-tab-${tab}`}
          className="px-5 py-2"
        >
          {tab === "DOCUMENTS" ? (
            loading || !documents ? (
              <p className="py-2 text-sm text-muted">확인 중…</p>
            ) : (
              <KnowledgeDocumentList documents={documents} onChanged={onChanged} />
            )
          ) : (
            <div className="py-3">
              <LearnedKnowledge />
            </div>
          )}
        </div>
      </div>
    </section>
  );
}
