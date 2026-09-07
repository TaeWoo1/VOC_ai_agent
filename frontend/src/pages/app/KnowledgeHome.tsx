import { useCallback, useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type {
  KnowledgeCandidateView,
  KnowledgeDocumentView,
  KnowledgeSummaryView,
} from "../../lib/types";
import { api } from "../../lib/apiClient";
import { PageHead } from "../../components/ui/PageHead";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { useAgentSurface } from "../../lib/agentPanel";
import { Section } from "../../components/ui/Section";
import { Btn } from "../../components/ui/Btn";
import { KnowledgeInbox } from "../../components/knowledge/KnowledgeInbox";
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
  useAgentSurface({ surface: "knowledge", label: "reviewnary가 알고 있는 정보" });

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
          ? "과거 답변에서 반복되는 문장을 찾지 못했습니다."
          : `확인하실 항목이 ${next.length}건입니다.`,
      );
      setSummary(await api.getKnowledgeSummary().catch(() => summary));
    } catch {
      setError("과거 답변을 살펴보지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  const loading = documents === null || candidates === null;
  // Nothing written, nothing uploaded, nothing waiting — the state a seller is in on their first day.
  const nothingWritten =
    summary !== null
    && summary.productKnowledge === 0
    && summary.operatingRules === 0
    && summary.documents === 0;

  return (
    <div className="flex flex-col gap-6">
      <PageHead
        title="reviewnary가 알고 있는 정보"
        description="고객에게 답할 때 근거로 쓰는 회사의 기준과 자료입니다."
        action={<AgentLaunch context={{ surface: "knowledge" }} label="이 내용으로 물어보기" />}
      />

      {error ? <p className="break-keep text-sm text-bad" role="alert">{error}</p> : null}
      {notice ? <p className="break-keep text-sm text-muted" role="status">{notice}</p> : null}

      <Section
        title="확인 필요"
        count={summary && summary.needsConfirmation > 0 ? summary.needsConfirmation : null}
        action={
          // Offered only when there is something to look through. A company with no past answers
          // pressing this can only be told that nothing was found — a control whose one outcome is
          // 「없습니다」 is not an action, and on a first day it is the loudest thing on the screen.
          summary && summary.pastAnswers > 0 ? (
            <Btn size="sm" variant="outline" onClick={() => void propose()} disabled={busy}>
              {busy ? "살펴보는 중…" : "과거 답변에서 찾아보기"}
            </Btn>
          ) : null
        }
      >
        {loading ? (
          <p className="text-sm text-muted">확인하는 중…</p>
        ) : (
          <KnowledgeInbox candidates={candidates} documents={documents} onChanged={load} />
        )}
      </Section>

      <Section title="알고 있는 정보">
        {summary === null ? (
          <p className="text-sm text-muted">확인하는 중…</p>
        ) : (
          <>
            <dl className="flex flex-wrap gap-x-8 gap-y-3" data-testid="knowledge-summary">
              <Count label="상품 지식" value={summary.productKnowledge} to="/products" />
              <Count label="운영 기준" value={summary.operatingRules} to="/settings/policies" />
              <Count label="연결된 자료" value={summary.documents} />
              <Count label="과거 고객 응답" value={summary.pastAnswers} />
            </dl>
            {/*
              What reviewnary read WITHOUT being taught, and the one line that says past answers are
              not official. Both exist so a seller does not read this screen as an empty form.
            */}
            <p className="break-keep text-sm text-muted">
              {summary.products > 0
                ? `채널에서 가져온 상품 정보 ${summary.products}개를 이미 읽고 있습니다. `
                : ""}
              {summary.pastAnswers > 0
                ? "과거 고객 응답은 참고만 하고, 공식 기준으로는 쓰지 않습니다."
                : ""}
              {/*
                Nothing has been read at all — the state a seller is in before a first collection.
                It says the fact and the next step, and it does NOT claim to know whether a channel
                is connected: this screen holds no channel read, and inventing one to phrase a
                sentence would put a second, drifting answer beside the home screen's.
              */}
              {summary.products === 0 && summary.pastAnswers === 0 ? (
                <>
                  채널에서 가져온 정보가 아직 없습니다.{" "}
                  <Link to="/connect" className="font-semibold text-brand-700 hover:underline">
                    채널 연결
                  </Link>
                </>
              ) : null}
            </p>
            {nothingWritten ? (
              <p className="break-keep text-sm text-muted">
                자료를 연결하면 답변이 더 정확해집니다. 매뉴얼·FAQ·배송/교환 정책처럼 이미 쓰고 계신
                것부터 올려 주세요.
              </p>
            ) : null}
          </>
        )}
      </Section>

      <Section title="자료" action={<KnowledgeDocumentAdd scope="ORG" onImported={load} />}>
        {loading ? (
          <p className="text-sm text-muted">확인하는 중…</p>
        ) : (
          <KnowledgeDocumentList documents={documents} onChanged={load} />
        )}
      </Section>

      {/*
        The two places a person writes. Links rather than a form: each of these is a screen that owns
        its own list, and an index that also edits is two screens fighting over one truth.
      */}
      <Section title="직접 등록">
        <ul className="flex flex-col gap-2 text-sm">
          <li>
            <Link to="/products" className="font-semibold text-brand-700 hover:underline">상품 지식</Link>
            <span className="text-muted"> · 상품마다 설치·부착·규격 같은 사실을 등록합니다.</span>
          </li>
          <li>
            <Link to="/settings/policies" className="font-semibold text-brand-700 hover:underline">운영 기준</Link>
            <span className="text-muted"> · 배송·교환·환불처럼 회사 전체에 적용되는 기준입니다.</span>
          </li>
        </ul>
      </Section>
    </div>
  );
}

/** One number, and the screen that owns it when there is one. */
function Count({ label, value, to }: { label: string; value: number; to?: string }) {
  return (
    <div className="flex flex-col gap-0.5">
      <dt className="break-keep text-sm text-muted">{label}</dt>
      <dd className="text-xl font-semibold tabular-nums text-ink">
        {to ? (
          <Link to={to} className="hover:underline">
            {value}
          </Link>
        ) : (
          value
        )}
      </dd>
    </div>
  );
}
