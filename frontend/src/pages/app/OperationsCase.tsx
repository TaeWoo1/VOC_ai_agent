import { useCallback, useEffect, useState } from "react";
import { Link, useLocation, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { Disclosure } from "../../components/ui/Disclosure";
import { WorkFlowCard } from "../../components/ui/WorkFlowCard";
import { api } from "../../lib/apiClient";
import { actionKo, subjectFallback } from "../../lib/customerOperations";
import { COPY, DRAFT_UNSENT, decisionOf, photoWord, shortDate, sourceLabel, waitLabel } from "../../lib/copy/customerOps";
import type { OperationsCaseDetail } from "../../lib/customerOperationsTypes";

/** The queue the case was opened from, carried in router state by the Home list — never re-read here. */
export interface CaseQueueState {
  caseIds: string[];
}

type Receipt = { scope: string; content: string };

/**
 * <b>One case</b> (Customer Operations v3.1): 「자동 확인 → 내 확인 필요」 first, then what the customer wrote and
 * what was checked, the evidence folded, and — in the right column — the one thing the seller does here.
 *
 * <b>Nothing here sends anything.</b> Teaching writes company knowledge and re-drafts; editing the draft saves a
 * version; correcting records the seller's judgement. Sending stays on the inquiry/review screen that owns it.
 */
export function OperationsCase() {
  const { caseId = "" } = useParams();
  const location = useLocation();
  const queue = (location.state as CaseQueueState | null)?.caseIds ?? null;
  const [detail, setDetail] = useState<OperationsCaseDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);
  const [receipt, setReceipt] = useState<Receipt | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.getOperationsCase(caseId));
    } catch {
      setDetail(null);
    }
  }, [caseId]);

  useEffect(() => {
    setDetail(undefined);
    setReceipt(null);
    setError(null);
    void load();
  }, [load]);

  if (detail === undefined) {
    return <p className="text-muted">불러오는 중…</p>;
  }
  if (detail === null) {
    return <p className="text-muted">해당 건을 찾을 수 없습니다.</p>;
  }

  const applied = (next: OperationsCaseDetail) => {
    setDetail(next);
    setError(null);
  };
  const failed = (e: unknown) => {
    const message = isAxiosError(e) ? (e.response?.data as { message?: string } | undefined)?.message : undefined;
    setError(message ?? COPY.saveFailed);
  };

  const title = detail.title?.trim() || firstLine(detail.body) || subjectFallback(detail.subjectKind);
  const wait = waitLabel(detail.receivedOn);
  const index = queue ? queue.indexOf(caseId) : -1;
  const showTeach = Boolean(detail.gap) && !receipt;
  const why = detail.whyDecisionNeeded ?? detail.recommendedAction;

  return (
    <div className="mx-auto w-full max-w-[1080px] space-y-5">
      <nav aria-label="위치" className="flex items-center gap-2 text-sm text-muted">
        <Link to="/" className="rounded hover:text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700">
          {COPY.homeTitle}
        </Link>
        <span aria-hidden="true">›</span>
        <span className="font-semibold text-ink">{COPY.listTitle}</span>
        {queue && index >= 0 ? <Pager queue={queue} index={index} /> : null}
      </nav>

      <header className="flex flex-wrap items-start gap-x-4 gap-y-2">
        <div className="min-w-0 flex-1">
          <h1 className="break-keep text-[24px] font-extrabold leading-tight tracking-tight text-ink [overflow-wrap:anywhere]">
            {title}
          </h1>
          <p className="mt-1.5 flex flex-wrap items-center gap-x-2 gap-y-0.5 text-sm text-muted">
            <span>{sourceLabel(detail.channelNameKo, detail.subjectKind, detail.rating)}</span>
            {detail.productName ? (
              <>
                <Sep />
                <span className="break-keep">{detail.productName}</span>
              </>
            ) : null}
            {wait ? (
              <>
                <Sep />
                <span className="tabular-nums">{wait}</span>
              </>
            ) : null}
          </p>
        </div>
        <Link
          to={detail.to}
          className="shrink-0 rounded pt-1 text-sm font-semibold text-brand-700 hover:text-brand-800 hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        >
          {COPY.original} ↗
        </Link>
      </header>

      <WorkFlowCard
        ariaLabel="자동 확인과 내 확인 필요"
        done={{
          label: COPY.caseChecked,
          value: doneHeadline(detail, receipt !== null),
          phrase: true,
          line: detail.summary ? <span>{detail.summary}</span> : undefined,
        }}
        mine={{
          label: COPY.mineLabel,
          value: detail.open
            ? decisionOf(detail.recommendedActionType) ?? actionKo(detail.recommendedActionType) ?? "판단 필요"
            : COPY.closed,
          phrase: true,
          line: detail.open && why ? <span>{why}</span> : undefined,
        }}
      />

      {error ? (
        <p className="break-keep text-sm text-bad" role="alert">
          {error}
        </p>
      ) : null}

      {/*
        One grid, two readings. From 1280 up the seller's column sits beside the story and follows the scroll; below
        it everything stacks, and the column comes right after what the customer wrote — the thing to do is not left
        under the evidence, below the fold. Extra height goes to the last row so nothing opens a gap under the body.
      */}
      <div className="grid gap-3.5 xl:grid-cols-[minmax(0,1fr)_360px] xl:grid-rows-[auto_auto_1fr] xl:gap-x-6">
        <div className="min-w-0 xl:col-start-1 xl:row-start-1">
          <Block title={detail.subjectKind === "INQUIRY" ? COPY.inquiryBody : COPY.reviewBody}>
            <p className="whitespace-pre-wrap break-keep text-[17px] font-medium leading-[1.8] text-ink [overflow-wrap:anywhere]">
              {detail.body ?? "내용 없음"}
            </p>
            {detail.media && detail.media.length > 0 ? (
              <ul className="mt-4 flex flex-wrap gap-3" aria-label="고객이 올린 사진">
                {detail.media.map((m) => (
                  <MediaItem key={m.ordinal} caseId={caseId} media={m} />
                ))}
              </ul>
            ) : null}
          </Block>
        </div>

        <aside
          aria-label={COPY.mineLabel}
          className="flex flex-col gap-3.5 self-start xl:sticky xl:top-4 xl:col-start-2 xl:row-span-3 xl:row-start-1"
        >
          {receipt ? <TaughtReceipt receipt={receipt} redrafted={Boolean(detail.draft)} /> : null}
          {showTeach ? (
            <TeachCard
              caseId={caseId}
              detail={detail}
              onTaught={(next, r) => {
                applied(next);
                setReceipt(r);
              }}
              onFailed={failed}
            />
          ) : null}
          {detail.draft ? (
            <DraftCard caseId={caseId} detail={detail} primary={!showTeach} onApplied={applied} onFailed={failed} />
          ) : null}
          <CorrectionCard caseId={caseId} detail={detail} onApplied={applied} onFailed={failed} />
        </aside>

        <div className="min-w-0 xl:col-start-1 xl:row-start-2">
          <Block title={COPY.checks}>
            <Checks detail={detail} gapOpen={showTeach} />
            {!detail.summary && detail.reasonNote ? (
              <p className="mt-3 break-keep text-sm text-muted">{detail.reasonNote}</p>
            ) : null}
          </Block>
        </div>

        <div className="min-w-0 self-start xl:col-start-1 xl:row-start-3">
          <Evidence detail={detail} />
        </div>
      </div>
    </div>
  );
}

/** The left cell's headline, from the state the case is in — never a sentence Reviewnary writes about itself. */
function doneHeadline(detail: OperationsCaseDetail, taught: boolean): string {
  if (detail.draft) return taught ? COPY.redrafted : "답변 초안 작성";
  if (detail.gap?.missingSubject) return `${detail.gap.missingSubject} 정보 없음`;
  if (detail.gap) return "답변 정보 없음";
  const found = detail.investigated.filter((i) => i.results > 0).length;
  return found > 0 ? `${detail.investigated.length}개 항목 확인` : "확인할 근거 없음";
}

function firstLine(body: string | null): string | null {
  const line = body?.split(/\r?\n/).find((l) => l.trim().length > 0)?.trim();
  if (!line) return null;
  return line.length > 60 ? `${line.slice(0, 60)}…` : line;
}

function Checks({ detail, gapOpen }: { detail: OperationsCaseDetail; gapOpen: boolean }) {
  const missing = gapOpen && detail.gap?.missingSubject ? detail.gap.missingSubject : null;
  if (detail.investigated.length === 0 && !missing) {
    return <p className="text-sm text-muted">{COPY.noInvestigation}</p>;
  }
  return (
    <ul className="flex flex-wrap gap-1.5 text-sm">
      {detail.investigated.map((item) => (
        <li key={item.label}>{item.results > 0 ? <Found>{`${item.label} ${item.results}`}</Found> : <Missing>{`${item.label} 없음`}</Missing>}</li>
      ))}
      {missing ? (
        <li>
          <Missing>{`${missing} 기준 없음`}</Missing>
        </li>
      ) : null}
    </ul>
  );
}

function Found({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#F4F5F7] px-2.5 py-1 text-muted">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full bg-[#1F9D55]" />
      {children}
    </span>
  );
}

function Missing({ children }: { children: string }) {
  return (
    <span className="inline-flex items-center gap-1.5 whitespace-nowrap rounded-lg bg-[#FFF3E4] px-2.5 py-1 font-semibold text-warn">
      <span aria-hidden="true" className="h-1.5 w-1.5 rounded-full border-[1.5px] border-[#D97706]" />
      {children}
    </span>
  );
}

function Evidence({ detail }: { detail: OperationsCaseDetail }) {
  if (detail.knowledgeUsed.length === 0) {
    return (
      <p className="rounded-[14px] bg-surface px-5 py-3.5 text-sm text-muted shadow-[0_0_0_1px_#E4E7EC]">{COPY.noEvidence}</p>
    );
  }
  return (
    <div className="rounded-[14px] bg-surface shadow-[0_0_0_1px_#E4E7EC]">
      <Disclosure
        label={COPY.evidence}
        note={<span className="rounded-md bg-[#F1F3F5] px-1.5 text-xs tabular-nums">{detail.knowledgeUsed.length}</span>}
        className="px-3 py-1.5"
      >
        <ul className="divide-y divide-[#EEF0F3] px-2 pb-2">
          {detail.knowledgeUsed.map((used) => (
            <li key={`${used.title}-${used.provenance}`} className="py-3">
              <p className="break-keep text-[15px] font-semibold text-ink">{used.title}</p>
              <p className="mt-0.5 break-keep text-sm leading-relaxed text-muted">{used.excerpt}</p>
              <p className="mt-1.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
                {used.cited ? <Tag tone="blue">{COPY.used}</Tag> : null}
                {used.pastAnswer ? <Tag>{COPY.pastAnswer}</Tag> : null}
                <span>{used.authority}</span>
                <Sep />
                <span>{used.provenance}</span>
                {used.capturedOn ? (
                  <>
                    <Sep />
                    <span>{shortDate(used.capturedOn)}</span>
                  </>
                ) : null}
              </p>
            </li>
          ))}
        </ul>
      </Disclosure>
    </div>
  );
}

function Pager({ queue, index }: { queue: string[]; index: number }) {
  const prev = index > 0 ? queue[index - 1] : null;
  const next = index < queue.length - 1 ? queue[index + 1] : null;
  return (
    <span className="ml-auto flex items-center gap-1.5">
      <span className="mr-1 text-xs tabular-nums text-muted">
        {index + 1} / {queue.length}
      </span>
      <PagerLink to={prev} queue={queue} label="이전 건" dir="left" />
      <PagerLink to={next} queue={queue} label="다음 건" dir="right" />
    </span>
  );
}

function PagerLink({ to, queue, label, dir }: { to: string | null; queue: string[]; label: string; dir: "left" | "right" }) {
  const icon = (
    <svg viewBox="0 0 24 24" aria-hidden="true" className="h-[15px] w-[15px] fill-none stroke-current stroke-2">
      <path d={dir === "left" ? "M15 6l-6 6 6 6" : "M9 6l6 6-6 6"} strokeLinecap="round" strokeLinejoin="round" />
    </svg>
  );
  if (!to) {
    return (
      <span aria-hidden="true" className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-[#C4CAD3]">
        {icon}
      </span>
    );
  }
  return (
    <Link
      to={`/customer-operations/cases/${to}`}
      state={{ caseIds: queue } satisfies CaseQueueState}
      aria-label={label}
      className="flex h-8 w-8 items-center justify-center rounded-lg border border-line bg-surface text-muted hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
    >
      {icon}
    </Link>
  );
}

function Block({ title, children }: { title: string; children: React.ReactNode }) {
  return (
    <section aria-label={title} className="rounded-[14px] bg-surface px-5 py-5 shadow-[0_0_0_1px_#E4E7EC] sm:px-6">
      <h2 className="mb-3 text-xs font-bold text-muted">{title}</h2>
      {children}
    </section>
  );
}

function Sep() {
  return <span aria-hidden="true" className="h-[3px] w-[3px] shrink-0 rounded-full bg-[#B0B8C1]" />;
}

function Tag({ tone = "gray", children }: { tone?: "gray" | "blue" | "line"; children: React.ReactNode }) {
  const cls =
    tone === "blue"
      ? "bg-brand-50 text-brand-700"
      : tone === "line"
        ? "bg-surface text-muted shadow-[inset_0_0_0_1px_#DCE0E6]"
        : "bg-[#F1F3F5] text-muted";
  return <span className={`whitespace-nowrap rounded-md px-1.5 py-px text-xs font-semibold ${cls}`}>{children}</span>;
}

type MediaProps = { caseId: string; media: NonNullable<OperationsCaseDetail["media"]>[number] };

/**
 * One photo as a thumbnail with what Reviewnary saw under it. A photo that was not inspected never gets a
 * description — only its status sentence.
 */
function MediaItem({ caseId, media }: MediaProps) {
  const [src, setSrc] = useState<string | null>(null);
  const [failed, setFailed] = useState(false);
  useEffect(() => {
    if (!media.imagePath) return;
    let alive = true;
    api
      .getOperationsCaseMedia(caseId, media.ordinal)
      .then((url) => alive && setSrc(url))
      .catch(() => alive && setFailed(true));
    return () => {
      alive = false;
    };
  }, [caseId, media.imagePath, media.ordinal]);
  const word = media.inspected ? photoWord(media.problemVisible) : null;
  const hit = media.inspected && media.problemVisible === "YES";
  return (
    <li className="w-[168px]">
      <span
        className={`relative block h-[112px] w-[168px] overflow-hidden rounded-[10px] bg-gradient-to-br from-[#E3E8EF] to-[#C9D2DD] ${
          hit ? "ring-2 ring-[#D97706] ring-offset-2" : ""
        }`}
      >
        {src ? (
          <a href={src} target="_blank" rel="noreferrer" className="block h-full w-full focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700">
            <img src={src} alt={`고객이 올린 사진 ${media.ordinal}`} className="h-full w-full object-cover" />
          </a>
        ) : (
          <span className="flex h-full items-center justify-center px-2 text-center text-xs text-muted">
            {media.imagePath ? (failed ? "불러오기 실패" : "불러오는 중") : "영상"}
          </span>
        )}
        {word ? (
          <span className={`absolute bottom-1.5 left-1.5 rounded bg-surface px-1.5 text-[11px] font-bold ${hit ? "text-warn" : "text-muted"}`}>
            {word}
          </span>
        ) : null}
      </span>
      {media.inspected && media.depicts ? <p className="mt-1.5 break-keep text-xs leading-snug text-muted">분석: {media.depicts}</p> : null}
      {media.inspected && media.problemDescription ? (
        <p className="mt-0.5 break-keep text-xs leading-snug text-ink">{media.problemDescription}</p>
      ) : null}
      {!media.inspected ? <p className="mt-1.5 break-keep text-xs leading-snug text-muted">{media.statusKo}</p> : null}
    </li>
  );
}

function ActionCard({ primary, ariaLabel, children }: { primary: boolean; ariaLabel: string; children: React.ReactNode }) {
  return (
    <section
      aria-label={ariaLabel}
      className={`rounded-[16px] bg-surface p-5 ${
        primary ? "shadow-[0_0_0_1.5px_#1B64DA,0_18px_36px_-22px_rgba(27,100,218,0.55)]" : "shadow-[0_0_0_1px_#E4E7EC]"
      }`}
    >
      {children}
    </section>
  );
}

type CardProps = {
  caseId: string;
  detail: OperationsCaseDetail;
  onApplied: (next: OperationsCaseDetail) => void;
  onFailed: (e: unknown) => void;
};

/** The Teach loop: the one fact the seller can give so this case — and the next like it — can be answered. */
function TeachCard({
  caseId,
  detail,
  onTaught,
  onFailed,
}: {
  caseId: string;
  detail: OperationsCaseDetail;
  onTaught: (next: OperationsCaseDetail, receipt: Receipt) => void;
  onFailed: (e: unknown) => void;
}) {
  const gap = detail.gap;
  const [content, setContent] = useState("");
  const [scope, setScope] = useState(detail.productScopeAvailable ? gap?.suggestedScope ?? "ORG" : "ORG");
  const [busy, setBusy] = useState(false);
  if (!gap) return null;
  // A past answer on a similar question is precedent, not today's basis; loading it here is how the seller makes it
  // one — they read it, may edit it, and save it as their own knowledge.
  const precedent = detail.knowledgeUsed.find((used) => used.pastAnswer && used.reusableText);

  const submit = async () => {
    setBusy(true);
    const saved = content;
    try {
      onTaught(await api.teachOperationsCase(caseId, { content: saved, scope }), { scope, content: saved });
      setContent("");
    } catch (e) {
      onFailed(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <ActionCard primary ariaLabel={COPY.needInfo}>
      <h2 className="text-base font-extrabold text-ink">{COPY.needInfo}</h2>
      <p className="mt-2 break-keep text-[17px] font-bold leading-snug tracking-tight text-ink">{gap.sentence}</p>
      <label className="mt-4 block text-xs font-semibold text-muted" htmlFor="teach-content">
        {COPY.guidance}
      </label>
      <textarea
        id="teach-content"
        className="mt-1 min-h-28 w-full rounded-[10px] border border-[#D5DAE1] p-3 text-[15px] leading-relaxed text-ink focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
        value={content}
        onChange={(e) => setContent(e.target.value)}
      />
      <fieldset className="mt-3">
        <legend className="text-xs font-semibold text-muted">{COPY.applyScope}</legend>
        <div className="mt-1 flex rounded-[10px] bg-[#F1F3F5] p-[3px] text-sm">
          {detail.productScopeAvailable ? (
            <ScopeOption checked={scope === "PRODUCT"} onChange={() => setScope("PRODUCT")} label={COPY.thisProduct} />
          ) : null}
          <ScopeOption checked={scope === "ORG"} onChange={() => setScope("ORG")} label={COPY.wholeCompany} />
        </div>
      </fieldset>
      <Btn className="mt-4 min-h-[46px] w-full" onClick={submit} disabled={busy || content.trim().length === 0}>
        {busy ? "저장 중…" : COPY.saveAndRedraft}
      </Btn>
      {precedent ? (
        <Btn variant="ghost" size="sm" className="mt-2 w-full" onClick={() => setContent(precedent.reusableText ?? "")}>
          {COPY.loadPastAnswer}
        </Btn>
      ) : null}
    </ActionCard>
  );
}

function ScopeOption({ checked, onChange, label }: { checked: boolean; onChange: () => void; label: string }) {
  return (
    <label
      className={`flex-1 cursor-pointer rounded-lg px-2 py-1.5 text-center has-[:focus-visible]:ring-2 has-[:focus-visible]:ring-brand-700 ${
        checked ? "bg-surface font-bold text-ink shadow-[0_1px_2px_rgba(15,25,45,0.1)]" : "font-medium text-muted"
      }`}
    >
      <input type="radio" name="teach-scope" className="sr-only" checked={checked} onChange={onChange} />
      {label}
    </label>
  );
}

function TaughtReceipt({ receipt, redrafted }: { receipt: Receipt; redrafted: boolean }) {
  return (
    <section aria-label={COPY.saved} role="status" className="rounded-[16px] bg-[#F5FAF6] p-5 shadow-[0_0_0_1px_#CFE3D6]">
      <p className="flex items-center gap-2 text-base font-extrabold text-good">
        <span aria-hidden="true" className="flex h-[22px] w-[22px] items-center justify-center rounded-full bg-[#1F9D55]">
          <svg viewBox="0 0 24 24" className="h-[13px] w-[13px] fill-none stroke-white stroke-[3]">
            <path d="M5 12l4 4 10-10" strokeLinecap="round" strokeLinejoin="round" />
          </svg>
        </span>
        {COPY.saved} · {receipt.scope === "PRODUCT" ? COPY.thisProduct : COPY.wholeCompany}
      </p>
      <p className="mt-3 whitespace-pre-wrap break-keep rounded-xl bg-surface px-4 py-3 text-[15px] leading-relaxed text-ink">
        {receipt.content}
      </p>
      <p className="mt-3 break-keep text-sm text-muted">
        {redrafted ? `${COPY.redrafted} · ` : ""}
        {COPY.sameQuestionUses}
      </p>
    </section>
  );
}

/** The draft, read first; editing is one press away and is where 「유사 건에 재사용」 is offered. */
function DraftCard({ caseId, detail, primary, onApplied, onFailed }: CardProps & { primary: boolean }) {
  const draft = detail.draft;
  const [editing, setEditing] = useState(false);
  const [body, setBody] = useState(draft?.body ?? "");
  const [remember, setRemember] = useState(false);
  const [busy, setBusy] = useState(false);
  useEffect(() => {
    setBody(draft?.body ?? "");
  }, [draft?.version, draft?.body]);
  if (!draft) return null;

  const submit = async () => {
    setBusy(true);
    try {
      onApplied(
        await api.editOperationsCaseDraft(caseId, {
          body,
          remember,
          scope: detail.productScopeAvailable ? "PRODUCT" : "ORG",
        }),
      );
      setRemember(false);
      setEditing(false);
    } catch (e) {
      onFailed(e);
    } finally {
      setBusy(false);
    }
  };

  const cited = citeCounts(draft.evidence);

  return (
    <ActionCard primary={primary} ariaLabel={COPY.draftTitle}>
      <div className="flex items-center gap-2">
        <h2 className="text-base font-extrabold text-ink">{COPY.draftTitle}</h2>
        <Tag tone="line">{DRAFT_UNSENT}</Tag>
      </div>
      {editing ? (
        <>
          <textarea
            aria-label={COPY.draftTitle}
            className="mt-3 min-h-40 w-full rounded-xl border border-[#D5DAE1] p-3.5 text-[15px] leading-[1.8] text-ink focus:border-brand-700 focus:outline-none focus:ring-2 focus:ring-brand-700/20"
            value={body}
            onChange={(e) => setBody(e.target.value)}
          />
          <label className="mt-3 flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
            {COPY.reuse}
          </label>
          <div className="mt-3 flex gap-2">
            <Btn
              variant="outline"
              className="flex-1"
              disabled={busy}
              onClick={() => {
                setBody(draft.body);
                setEditing(false);
              }}
            >
              {COPY.cancel}
            </Btn>
            <Btn className="flex-1" onClick={submit} disabled={busy || body.trim().length === 0}>
              {busy ? "저장 중…" : COPY.save}
            </Btn>
          </div>
        </>
      ) : (
        <>
          <p className="mt-3 whitespace-pre-wrap break-keep rounded-xl bg-[#F7F8FA] px-4 py-3.5 text-[15px] leading-[1.8] text-ink [overflow-wrap:anywhere]">
            {draft.body}
          </p>
          {cited.length > 0 ? (
            <p className="mt-2.5 flex flex-wrap items-center gap-1.5 text-xs text-muted">
              <span>{COPY.evidence}</span>
              {cited.map(([label, n]) => (
                <Tag key={label}>{`${label} ${n}`}</Tag>
              ))}
            </p>
          ) : null}
          <div className="mt-3.5 flex gap-2">
            <Btn variant="outline" className="flex-1" onClick={() => setEditing(true)}>
              {COPY.edit}
            </Btn>
            <BtnLink to={detail.to} variant={primary ? "solid" : "outline"} className="flex-1">
              {COPY.toSend} ↗
            </BtnLink>
          </div>
        </>
      )}
    </ActionCard>
  );
}

/** 「상품 정보 2」 — the draft's own citations, counted by the label they already carry. */
function citeCounts(evidence: { scopeLabel: string }[]): [string, number][] {
  const counts = new Map<string, number>();
  for (const e of evidence) counts.set(e.scopeLabel, (counts.get(e.scopeLabel) ?? 0) + 1);
  return [...counts.entries()];
}

const ACTIONS = [
  "REPLY_TO_CUSTOMER",
  "CONTACT_CUSTOMER",
  "REFUND_OR_COMPENSATION",
  "CANCEL_OR_EXCHANGE",
  "ADD_KNOWLEDGE",
  "REVIEW_PRODUCT_LISTING",
  "MONITOR_REPEAT_ISSUE",
  "NO_ACTION",
];

/** The seller saying a different action was right — recorded as their judgement, never as a rule change. */
function CorrectionCard({ caseId, detail, onApplied, onFailed }: CardProps) {
  const [open, setOpen] = useState(false);
  const [action, setAction] = useState("");
  const [note, setNote] = useState("");
  const [remember, setRemember] = useState(true);
  const [busy, setBusy] = useState(false);

  const submit = async () => {
    setBusy(true);
    try {
      onApplied(
        await api.correctOperationsCase(caseId, {
          correctedActionType: action === "" ? null : action,
          note,
          remember,
          scope: detail.productScopeAvailable ? "PRODUCT" : "ORG",
        }),
      );
      setNote("");
      setOpen(false);
    } catch (e) {
      onFailed(e);
    } finally {
      setBusy(false);
    }
  };

  if (!open) {
    return (
      <div className="flex items-center gap-3 rounded-[14px] bg-surface px-5 py-3.5 text-sm text-muted shadow-[0_0_0_1px_#E4E7EC]">
        <span className="break-keep">{COPY.otherHandling}</span>
        <button
          type="button"
          onClick={() => setOpen(true)}
          className="ml-auto whitespace-nowrap rounded font-semibold text-ink hover:underline focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        >
          {COPY.changeHandling}
        </button>
      </div>
    );
  }

  return (
    <section aria-label={COPY.changeHandling} className="space-y-3 rounded-[14px] bg-surface p-5 shadow-[0_0_0_1px_#E4E7EC]">
      <h2 className="text-sm font-bold text-ink">{COPY.changeHandling}</h2>
      <div>
        <label className="block text-xs font-semibold text-muted" htmlFor="correction-action">
          {COPY.handlingMethod}
        </label>
        <select
          id="correction-action"
          className="mt-1 w-full rounded-[10px] border border-[#D5DAE1] bg-surface p-2.5 text-[15px] text-ink"
          value={action}
          onChange={(e) => setAction(e.target.value)}
        >
          <option value="">선택 안 함</option>
          {ACTIONS.map((token) => (
            <option key={token} value={token}>
              {actionKo(token)}
            </option>
          ))}
        </select>
      </div>
      <div>
        <label className="block text-xs font-semibold text-muted" htmlFor="correction-note">
          {COPY.memo}
        </label>
        <textarea
          id="correction-note"
          className="mt-1 min-h-20 w-full rounded-[10px] border border-[#D5DAE1] p-2.5 text-[15px] text-ink"
          value={note}
          onChange={(e) => setNote(e.target.value)}
        />
      </div>
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} className="h-4 w-4" />
        {COPY.reuse}
      </label>
      <div className="flex gap-2">
        <Btn variant="outline" className="flex-1" onClick={() => setOpen(false)} disabled={busy}>
          {COPY.cancel}
        </Btn>
        <Btn className="flex-1" onClick={submit} disabled={busy || (action === "" && note.trim().length === 0)}>
          {busy ? "저장 중…" : COPY.save}
        </Btn>
      </div>
    </section>
  );
}
