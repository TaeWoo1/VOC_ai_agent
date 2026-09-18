import { useCallback, useEffect, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { isAxiosError } from "axios";
import { PageHead } from "../../components/ui/PageHead";
import { Section } from "../../components/ui/Section";
import { Btn } from "../../components/ui/Btn";
import { Status } from "../../components/ui/Status";
import { Disclosure } from "../../components/ui/Disclosure";
import { api } from "../../lib/apiClient";
import { actionKo, subjectFallback, subjectKindKo } from "../../lib/customerOperations";
import type { OperationsCaseDetail } from "../../lib/customerOperationsTypes";

/**
 * <b>One case, end to end</b> (Knowledge &amp; Intelligence Closure v1): what happened, what Reviewnary looked at,
 * which of the company's own knowledge it used, what it suggests — and, when it could not answer, the one thing the
 * seller can tell it so that it can.
 *
 * <b>Nothing here sends anything.</b> Teaching writes company knowledge and re-prepares the draft; rewriting the draft
 * saves a version; correcting the recommendation records what the seller thinks. Registering the reply with the
 * customer stays on the inquiry screen, which owns that decision.
 */
export function OperationsCase() {
  const { caseId = "" } = useParams();
  const [detail, setDetail] = useState<OperationsCaseDetail | null | undefined>(undefined);
  const [error, setError] = useState<string | null>(null);

  const load = useCallback(async () => {
    try {
      setDetail(await api.getOperationsCase(caseId));
    } catch {
      setDetail(null);
    }
  }, [caseId]);

  useEffect(() => {
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
    setError(isAxiosError(e) ? (e.response?.data as { message?: string } | undefined)?.message ?? "저장하지 못했습니다." : "저장하지 못했습니다.");
  };

  return (
    <div className="space-y-6">
      <PageHead
        compact
        title={detail.title ?? subjectFallback(detail.subjectKind)}
        meta={
          <span className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
            <span>{subjectKindKo(detail.subjectKind)}</span>
            {detail.channelNameKo ? <span>{detail.channelNameKo}</span> : null}
            {detail.rating !== null ? <span>별점 {detail.rating}점</span> : null}
            {detail.receivedOn ? <span>{detail.receivedOn}</span> : null}
            {detail.productName ? <span>{detail.productName}</span> : null}
          </span>
        }
        action={
          <Link className="text-sm font-medium text-brand-700 underline" to={detail.to}>
            {detail.subjectKind === "INQUIRY" ? "문의 화면에서 보기" : "리뷰 화면에서 보기"}
          </Link>
        }
      />

      {error ? <p className="break-keep text-sm text-bad">{error}</p> : null}

      <Section title="무슨 일이 있었나">
        <p className="whitespace-pre-wrap break-keep leading-relaxed text-ink">{detail.body ?? "내용이 없습니다."}</p>
        <p className="break-keep text-sm text-muted">{detail.reasonNote}</p>
      </Section>

      {detail.media && detail.media.length > 0 ? (
        <Section title="고객이 올린 사진" count={detail.media.length}>
          <ul className="grid gap-3 sm:grid-cols-2">
            {detail.media.map((m) => (
              <MediaItem key={m.ordinal} caseId={caseId} media={m} />
            ))}
          </ul>
        </Section>
      ) : null}

      <Section title="Reviewnary가 확인한 것">
        {detail.investigated.length > 0 ? (
          <ul className="flex flex-wrap gap-2">
            {detail.investigated.map((item) => (
              <li key={item.label}>
                <Status tone="neutral">
                  {item.label} {item.results}건
                </Status>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">아직 조사 기록이 없습니다.</p>
        )}
        {detail.summary ? <p className="break-keep leading-relaxed text-ink">{detail.summary}</p> : null}
      </Section>

      <Section title="사용한 회사 지식" count={detail.knowledgeUsed.length || null}>
        {detail.knowledgeUsed.length > 0 ? (
          <ul className="divide-y divide-line rounded-xl border border-line bg-surface">
            {detail.knowledgeUsed.map((used) => (
              <li key={`${used.title}-${used.provenance}`} className="p-3">
                <p className="flex flex-wrap items-center gap-x-2 text-sm text-muted">
                  <span className="font-medium text-ink">{used.authority}</span>
                  <span>{used.provenance}</span>
                  {used.capturedOn ? <span>{used.capturedOn} 기준</span> : null}
                  {used.cited ? <Status tone="info">판단에 사용</Status> : null}
                  {used.pastAnswer ? <Status tone="neutral">지난 답변</Status> : null}
                </p>
                <p className="mt-1 break-keep font-medium text-ink">{used.title}</p>
                <p className="mt-1 break-keep text-sm leading-relaxed text-muted">{used.excerpt}</p>
              </li>
            ))}
          </ul>
        ) : (
          <p className="text-sm text-muted">이 건에 쓸 수 있는 회사 지식을 찾지 못했습니다.</p>
        )}
      </Section>

      <Section title="Reviewnary의 제안">
        {detail.recommendedAction ? (
          <p className="break-keep leading-relaxed text-ink">{detail.recommendedAction}</p>
        ) : null}
        {actionKo(detail.recommendedActionType) ? (
          <p className="text-sm text-muted">제안한 처리: {actionKo(detail.recommendedActionType)}</p>
        ) : null}
        {detail.missingInformation.length > 0 ? (
          <p className="break-keep text-sm text-muted">더 알아야 할 것: {detail.missingInformation.join(", ")}</p>
        ) : null}
        {detail.whyDecisionNeeded ? (
          <p className="break-keep rounded-xl border border-line bg-surface p-3 text-sm leading-relaxed text-ink">
            판매자 확인이 필요한 이유: {detail.whyDecisionNeeded}
          </p>
        ) : null}
      </Section>

      {detail.gap ? (
        <TeachCard caseId={caseId} detail={detail} onApplied={applied} onFailed={failed} />
      ) : null}

      {detail.draft ? (
        <DraftCard caseId={caseId} detail={detail} onApplied={applied} onFailed={failed} />
      ) : null}

      <CorrectionCard caseId={caseId} detail={detail} onApplied={applied} onFailed={failed} />
    </div>
  );
}

type MediaProps = { caseId: string; media: NonNullable<OperationsCaseDetail["media"]>[number] };

/**
 * One photo: the picture itself (fetched with the seller's session), then what Reviewnary saw in it — or, plainly,
 * that it did not look. A photo that was not inspected never gets a description.
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
  const visible =
    media.problemVisible === "YES" ? "문제가 보임" : media.problemVisible === "NO" ? "문제가 보이지 않음" : media.problemVisible === "UNCLEAR" ? "사진만으로 판단 어려움" : null;
  return (
    <li className="space-y-2 rounded-xl border border-line bg-surface p-3">
      {src ? (
        <img src={src} alt={`고객이 올린 사진 ${media.ordinal}`} className="max-h-64 w-full rounded-lg object-contain" />
      ) : (
        <p className="text-sm text-muted">
          {media.imagePath ? (failed ? "사진을 불러오지 못했습니다." : "사진을 불러오는 중…") : "영상은 여기서 보여 드리지 않습니다."}
        </p>
      )}
      <p className="flex flex-wrap items-center gap-2 text-sm text-muted">
        <span>{media.statusKo}</span>
        {media.inspected && visible ? <Status tone={media.problemVisible === "YES" ? "warn" : "neutral"}>{visible}</Status> : null}
      </p>
      {media.inspected && media.depicts ? (
        <p className="break-keep text-sm text-ink">사진에 보이는 것: {media.depicts}</p>
      ) : null}
      {media.inspected && media.problemDescription ? (
        <p className="break-keep text-sm text-ink">{media.problemDescription}</p>
      ) : null}
    </li>
  );
}

type CardProps = {
  caseId: string;
  detail: OperationsCaseDetail;
  onApplied: (next: OperationsCaseDetail) => void;
  onFailed: (e: unknown) => void;
};

/** The Teach loop: the one thing the seller can say so this case — and the next like it — can be answered. */
function TeachCard({ caseId, detail, onApplied, onFailed }: CardProps) {
  const gap = detail.gap;
  const [open, setOpen] = useState(false);
  const [content, setContent] = useState("");
  const [scope, setScope] = useState(detail.productScopeAvailable ? gap?.suggestedScope ?? "ORG" : "ORG");
  const [busy, setBusy] = useState(false);
  if (!gap) return null;
  // A past answer the seller gave on a similar question is precedent, not today's basis; confirming it here is how it
  // becomes one — the seller reads it, may edit it, and saves it as their own current knowledge.
  const precedent = detail.knowledgeUsed.find((used) => used.pastAnswer && used.reusableText);

  const submit = async () => {
    setBusy(true);
    try {
      onApplied(await api.teachOperationsCase(caseId, { content, scope }));
      setContent("");
      setOpen(false);
    } catch (e) {
      onFailed(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section title="부족한 정보">
      <p className="break-keep leading-relaxed text-ink">{gap.sentence}</p>
      {open ? (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
          <label className="block text-sm font-medium text-ink" htmlFor="teach-content">
            고객에게 안내할 내용
          </label>
          <textarea
            id="teach-content"
            className="min-h-28 w-full rounded-lg border border-line p-2 text-ink"
            value={content}
            onChange={(e) => setContent(e.target.value)}
            placeholder={gap.missingSubject ? `${gap.missingSubject}에 대해 고객에게 안내할 내용을 적어 주세요.` : "고객에게 안내할 내용을 적어 주세요."}
          />
          <fieldset className="space-y-1">
            <legend className="text-sm font-medium text-ink">어디에 적용할까요?</legend>
            {detail.productScopeAvailable ? (
              <label className="flex items-center gap-2 text-sm text-ink">
                <input
                  type="radio"
                  name="teach-scope"
                  checked={scope === "PRODUCT"}
                  onChange={() => setScope("PRODUCT")}
                />
                이 상품에만{detail.productName ? ` (${detail.productName})` : ""}
              </label>
            ) : null}
            <label className="flex items-center gap-2 text-sm text-ink">
              <input type="radio" name="teach-scope" checked={scope === "ORG"} onChange={() => setScope("ORG")} />
              회사 전체 기준으로
            </label>
          </fieldset>
          <div className="flex gap-2">
            <Btn onClick={submit} disabled={busy || content.trim().length === 0}>
              {busy ? "저장하는 중…" : "저장하고 다시 준비"}
            </Btn>
            <Btn variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              취소
            </Btn>
          </div>
        </div>
      ) : (
        <div className="flex flex-wrap gap-2">
          <Btn onClick={() => setOpen(true)}>정보 알려주기</Btn>
          {precedent ? (
            <Btn
              variant="outline"
              onClick={() => {
                setContent(precedent.reusableText ?? "");
                setOpen(true);
              }}
            >
              지난 답변을 기준으로 쓰기
            </Btn>
          ) : null}
        </div>
      )}
    </Section>
  );
}

/** The prepared draft, its citations, and the seller's rewrite — with the explicit 「다음에도 참고」. */
function DraftCard({ caseId, detail, onApplied, onFailed }: CardProps) {
  const draft = detail.draft;
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
    } catch (e) {
      onFailed(e);
    } finally {
      setBusy(false);
    }
  };

  return (
    <Section
      title="준비된 답변"
      hint={<span>아직 보내지 않았습니다 · v{draft.version}</span>}
    >
      <textarea
        aria-label="답변 초안"
        className="min-h-32 w-full rounded-lg border border-line p-3 leading-relaxed text-ink"
        value={body}
        onChange={(e) => setBody(e.target.value)}
      />
      {draft.evidence.length > 0 ? (
        <Disclosure label="이 답변이 참고한 근거" note={`${draft.evidence.length}건`}>
          <ul className="mt-2 space-y-2">
            {draft.evidence.map((item, index) => (
              <li key={`${item.kind}-${index}`} className="break-keep text-sm text-muted">
                <span className="font-medium text-ink">{item.scopeLabel}</span> {item.title ?? ""}
                {item.snippet ? ` — ${item.snippet}` : ""}
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
      <label className="flex items-center gap-2 text-sm text-ink">
        <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
        다음에도 참고하기 (비슷한 건에서 이 방식으로 씁니다)
      </label>
      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={submit} disabled={busy || body.trim().length === 0}>
          {busy ? "저장하는 중…" : "고쳐 쓰기 저장"}
        </Btn>
        <Link className="text-sm font-medium text-brand-700 underline" to={detail.to}>
          문의 화면에서 답변 보내기
        </Link>
      </div>
    </Section>
  );
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

  return (
    <Section title="제안이 맞지 않나요?">
      {open ? (
        <div className="space-y-3 rounded-xl border border-line bg-surface p-3">
          <label className="block text-sm font-medium text-ink" htmlFor="correction-action">
            맞는 처리 방법
          </label>
          <select
            id="correction-action"
            className="w-full rounded-lg border border-line p-2 text-ink"
            value={action}
            onChange={(e) => setAction(e.target.value)}
          >
            <option value="">고르지 않음</option>
            {ACTIONS.map((token) => (
              <option key={token} value={token}>
                {actionKo(token)}
              </option>
            ))}
          </select>
          <label className="block text-sm font-medium text-ink" htmlFor="correction-note">
            이렇게 처리하는 이유 (선택)
          </label>
          <textarea
            id="correction-note"
            className="min-h-20 w-full rounded-lg border border-line p-2 text-ink"
            value={note}
            onChange={(e) => setNote(e.target.value)}
          />
          <label className="flex items-center gap-2 text-sm text-ink">
            <input type="checkbox" checked={remember} onChange={(e) => setRemember(e.target.checked)} />
            다음에도 참고하기
          </label>
          <div className="flex gap-2">
            <Btn onClick={submit} disabled={busy || (action === "" && note.trim().length === 0)}>
              {busy ? "저장하는 중…" : "저장"}
            </Btn>
            <Btn variant="outline" onClick={() => setOpen(false)} disabled={busy}>
              취소
            </Btn>
          </div>
        </div>
      ) : (
        <Btn variant="outline" onClick={() => setOpen(true)}>
          다르게 처리해야 해요
        </Btn>
      )}
    </Section>
  );
}
