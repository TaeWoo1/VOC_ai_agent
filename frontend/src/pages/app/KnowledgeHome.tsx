import { useCallback, useEffect, useRef, useState } from "react";
import { Link } from "react-router-dom";
import { isAxiosError } from "axios";
import type { KnowledgeCandidateView, KnowledgeDocumentView } from "../../lib/types";
import { api } from "../../lib/apiClient";
import { PageHead } from "../../components/ui/PageHead";
import { Section } from "../../components/ui/Section";
import { Btn } from "../../components/ui/Btn";
import { Status } from "../../components/ui/Status";

/**
 * <b>reviewnary가 알고 있는 정보</b> — one screen for what the company has told reviewnary, and what
 * reviewnary is still asking. (Knowledge Sources &amp; Acquisition v1)
 *
 * <p>Before this, knowledge was somewhere else every time: product notes lived on each product page,
 * operating rules on a settings screen, and nothing at all showed material the seller could hand over
 * or things reviewnary had noticed. A seller who wanted to answer 「무엇을 알고 있지?」 had to visit one
 * screen per product.
 *
 * <p><b>Two things, in the order a seller needs them.</b> 확인 필요 first — it is the only part with
 * anything to decide — and then 자료, the material they gave us. The per-product notes and the
 * operating rules keep their own screens and are linked, not duplicated: this page is an index, and an
 * index that also edits is two screens fighting over one truth.
 *
 * <p><b>Internal vocabulary stays out.</b> No chunk, no embedding, no source id, no score. What a
 * document says about itself here is what it is, where it applies, whether it is current, and — one
 * honest number — how many passages it produced, because a document that produced none cannot ground
 * anything and a list that hid that would be lying to the person who uploaded it.
 */
export function KnowledgeHome() {
  const [documents, setDocuments] = useState<KnowledgeDocumentView[] | null>(null);
  const [candidates, setCandidates] = useState<KnowledgeCandidateView[] | null>(null);
  const [busy, setBusy] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);

  const load = useCallback(async () => {
    const [docs, cands] = await Promise.all([
      api.getKnowledgeDocuments().catch(() => null),
      api.getKnowledgeCandidates().catch(() => null),
    ]);
    setDocuments(docs ?? []);
    setCandidates(cands ?? []);
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  async function propose() {
    setBusy("propose");
    setError(null);
    setNotice(null);
    try {
      const next = await api.proposeKnowledgeCandidates();
      setCandidates(next);
      setNotice(
        next.length === 0
          ? "과거 답변에서 반복되는 문장을 찾지 못했습니다."
          : `확인할 항목이 ${next.length}건입니다.`,
      );
    } catch {
      setError("과거 답변을 살펴보지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(null);
    }
  }

  async function decide(candidate: KnowledgeCandidateView, accept: boolean) {
    setBusy(candidate.id);
    setError(null);
    setNotice(null);
    try {
      if (accept) {
        await api.acceptKnowledgeCandidate(candidate.id, {});
        setNotice("답변 기준으로 등록했습니다.");
      } else {
        await api.dismissKnowledgeCandidate(candidate.id);
      }
      await load();
    } catch (e) {
      setError(
        isAxiosError(e) && e.response?.status === 409
          ? "이미 처리한 항목입니다."
          : "처리하지 못했습니다. 잠시 후 다시 시도해 주세요.",
      );
    } finally {
      setBusy(null);
    }
  }

  async function setActive(document: KnowledgeDocumentView, active: boolean) {
    setBusy(document.sourceId);
    setError(null);
    try {
      await api.setKnowledgeDocumentActive(document.sourceId, active);
      await load();
    } catch {
      setError("자료 상태를 바꾸지 못했습니다.");
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="flex flex-col gap-6">
      {/* The one screen that answers 「무엇을 알고 있지?」. The description survives the usual rule
          against them because an empty first-run cannot explain itself by its content. */}
      <PageHead
        title="reviewnary가 알고 있는 정보"
        description="고객에게 답할 때 근거로 쓰는 회사의 기준과 자료입니다."
      />

      {error ? <p className="break-keep text-sm text-bad" role="alert">{error}</p> : null}
      {notice ? <p className="break-keep text-sm text-muted" role="status">{notice}</p> : null}

      <Section
        title="확인 필요"
        action={
          <Btn size="sm" variant="outline" onClick={() => void propose()} disabled={busy === "propose"}>
            {busy === "propose" ? "살펴보는 중…" : "과거 답변에서 찾아보기"}
          </Btn>
        }
      >
        {candidates == null ? (
          <p className="text-sm text-muted">확인하는 중…</p>
        ) : candidates.length === 0 ? (
          <p className="break-keep text-sm text-muted">지금 확인하실 항목은 없습니다.</p>
        ) : (
          <ul className="flex flex-col" data-testid="knowledge-candidates">
            {candidates.map((candidate) => (
              <li key={candidate.id} className="flex flex-col gap-1 border-b border-line py-3 last:border-0">
                <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
                  <Status tone="info">
                    {candidate.origin === "REPEATED_ANSWER" ? "반복된 답변" : "초안이 답하지 못한 것"}
                  </Status>
                  {/* The count is the fact that makes it worth a glance — the seller's own answers. */}
                  {candidate.evidenceCount > 0 ? (
                    <span>과거 답변 {candidate.evidenceCount}건에서 반복</span>
                  ) : null}
                  <span>{candidate.productName ?? "회사 전체"}</span>
                </p>
                <p className="whitespace-pre-wrap break-keep text-base leading-relaxed text-ink">
                  {candidate.content}
                </p>
                <div className="flex flex-wrap gap-2 pt-1">
                  <Btn size="sm" onClick={() => void decide(candidate, true)} disabled={busy === candidate.id}>
                    답변 기준으로 등록
                  </Btn>
                  <Btn size="sm" variant="ghost" onClick={() => void decide(candidate, false)} disabled={busy === candidate.id}>
                    아니요
                  </Btn>
                </div>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="자료" action={<DocumentUpload onImported={load} />}>
        {documents == null ? (
          <p className="text-sm text-muted">확인하는 중…</p>
        ) : documents.length === 0 ? (
          <p className="break-keep text-sm text-muted">
            사용설명서·FAQ·배송/교환 정책 같은 자료를 올리면 답변 근거로 씁니다.
          </p>
        ) : (
          <ul className="flex flex-col" data-testid="knowledge-documents">
            {documents.map((document) => (
              <li key={document.sourceId} className="flex flex-wrap items-center justify-between gap-2 border-b border-line py-3 last:border-0">
                <div className="flex min-w-0 flex-col gap-0.5">
                  <span className="break-keep text-base text-ink">{document.fileName ?? document.title}</span>
                  <span className="flex flex-wrap items-center gap-2 text-sm text-muted">
                    <span>{document.productName ?? "회사 전체"}</span>
                    {/* The one number, and the reason it is here: a document with no passages cannot
                        ground anything, and saying so beats letting the seller assume it works. */}
                    <span>{document.passages > 0 ? `${document.passages}개 문단` : "읽을 내용 없음"}</span>
                    {document.active ? null : <Status tone="neutral">사용 안 함</Status>}
                  </span>
                </div>
                <Btn
                  size="sm"
                  variant="ghost"
                  onClick={() => void setActive(document, !document.active)}
                  disabled={busy === document.sourceId}
                >
                  {/* The label is the ACTION, and it has to read as one: three rows all captioned
                      「사용 안 함」 read as three retired documents rather than three buttons that
                      would retire them. */}
                  {document.active ? "사용 중지" : "다시 사용"}
                </Btn>
              </li>
            ))}
          </ul>
        )}
      </Section>

      <Section title="어디에 등록하나요">
        <ul className="flex flex-col gap-2 text-sm">
          <li>
            <Link to="/products" className="font-semibold text-brand-700 hover:underline">상품 지식</Link>
            <span className="text-muted"> · 상품마다 설치·부착·규격 같은 사실을 등록합니다.</span>
          </li>
          <li>
            <Link to="/settings/policies" className="font-semibold text-brand-700 hover:underline">운영 정책</Link>
            <span className="text-muted"> · 배송·교환·환불처럼 회사 전체에 적용되는 기준입니다.</span>
          </li>
        </ul>
      </Section>
    </div>
  );
}

/**
 * The one control that brings material in.
 *
 * <p>Scope first, because it is the only thing the seller must decide that the file cannot say — a
 * manual belongs to a product, a shipping policy to the company. Everything else is read from the file.
 */
function DocumentUpload({ onImported }: { onImported: () => void | Promise<void> }) {
  const input = useRef<HTMLInputElement>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  async function upload(file: File) {
    setBusy(true);
    setError(null);
    try {
      // v1 brings documents in company-wide. A per-product upload is the same call with a product,
      // and the product screen is where a seller has one in hand — see the residuals.
      await api.importKnowledgeDocument({ scope: "ORG", file });
      await onImported();
    } catch (e) {
      // The backend's own sentence: it says which of the four refusals happened, and the seller can
      // act on each one differently.
      const message = isAxiosError(e) ? (e.response?.data as { message?: string })?.message : null;
      setError(message ?? "자료를 가져오지 못했습니다.");
    } finally {
      setBusy(false);
      if (input.current) {
        input.current.value = "";
      }
    }
  }

  return (
    <div className="flex flex-col items-end gap-1">
      <input
        ref={input}
        type="file"
        accept=".pdf,.docx,.txt,.md,.csv"
        className="hidden"
        aria-label="자료 파일"
        onChange={(e) => {
          const file = e.target.files?.[0];
          if (file) void upload(file);
        }}
      />
      <Btn size="sm" variant="outline" onClick={() => input.current?.click()} disabled={busy}>
        {busy ? "가져오는 중…" : "자료 올리기"}
      </Btn>
      {error ? <p className="break-keep text-sm text-bad" role="alert">{error}</p> : null}
    </div>
  );
}
