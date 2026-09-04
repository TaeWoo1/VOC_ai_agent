import { useState } from "react";
import { Link } from "react-router-dom";
import { api } from "../../lib/apiClient";
import { copyText } from "../../lib/clipboard";
import { count } from "../../lib/format";
import type { OpportunityView } from "../../lib/types";
import { KnowledgeQuickAdd } from "../knowledge/KnowledgeQuickAdd";
import { Btn } from "../ui/Btn";
import { Status } from "../ui/Status";
import { KIND_TONE, STATUS_TONE, destinationOf } from "./opportunityWords";

/**
 * One improvement opportunity: what repeated, why this is suggested, the evidence, and the next action.
 *
 * <b>Framed, because it asks for the seller's hand</b> (docs/reviewnary_design.md §3). Everything a seller
 * reads here is the backend's sentence — the why-lines, the recommendation, the draft — and this card
 * only decides order and controls. The draft is editable text; where it goes is decided by
 * {@link destinationOf}, and both destinations are seams that already exist.
 */
export function OpportunityCard({
  opportunity,
  onChanged,
  showEvidenceLink = true,
}: {
  opportunity: OpportunityView;
  onChanged: (next: OpportunityView) => void;
  /** Off on the issue's own evidence surface, where the link would point at the page it is on. */
  showEvidenceLink?: boolean;
}) {
  const o = opportunity;
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [title, setTitle] = useState(o.draft?.title ?? "");
  const [body, setBody] = useState(o.draft?.body ?? "");
  const [copied, setCopied] = useState<"ok" | "manual" | null>(null);
  const [saving, setSaving] = useState(false);
  const [savedTo, setSavedTo] = useState<string | null>(null);
  const dirty = o.draft != null && (title !== o.draft.title || body !== o.draft.body);
  const destination = destinationOf(o);

  async function run(action: () => Promise<OpportunityView>, failure: string) {
    setBusy(true);
    setError(null);
    try {
      const next = await action();
      setTitle(next.draft?.title ?? "");
      setBody(next.draft?.body ?? "");
      setCopied(null);
      onChanged(next);
    } catch {
      setError(failure);
    } finally {
      setBusy(false);
    }
  }

  async function copyDraft() {
    const result = await copyText(`${title}\n\n${body}`);
    // Never claim a copy that did not happen: the text is on screen, so "직접 복사" is the honest fallback.
    setCopied(result.ok ? "ok" : "manual");
  }

  return (
    <article
      aria-label={`개선 기회 · ${o.kindLabelKo}`}
      data-testid="opportunity-card"
      className="rounded-2xl border border-line bg-surface p-4 sm:p-5"
    >
      <header className="flex flex-wrap items-center gap-x-3 gap-y-1">
        <Status tone={KIND_TONE[o.kind]} variant="word">{o.kindLabelKo}</Status>
        {o.status !== "OPEN" ? (
          <Status tone={STATUS_TONE[o.status]} variant="chip">{o.statusLabelKo}</Status>
        ) : null}
      </header>
      <p className="mt-2 break-keep text-base font-semibold leading-snug text-ink">{o.recommendationKo}</p>

      <section className="mt-4">
        <h4 className="text-sm font-semibold text-ink">왜 이 기회인가</h4>
        <ul className="mt-1.5 space-y-1">
          {o.whyKo.map((line) => (
            <li key={line} className="break-keep text-sm leading-relaxed text-muted">
              {line}
            </li>
          ))}
        </ul>
        {o.knowledge && o.knowledge.excerpts.length > 0 ? (
          <ul className="mt-2 space-y-1 border-l-2 border-line pl-3">
            {o.knowledge.excerpts.map((excerpt) => (
              <li key={excerpt} className="break-keep text-sm leading-relaxed text-ink">
                “{excerpt}”
              </li>
            ))}
          </ul>
        ) : null}
        {showEvidenceLink ? (
          <p className="mt-2 text-sm">
            <Link
              to={o.evidenceTo}
              className="rounded font-semibold text-brand-700 transition hover:text-brand-800 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
            >
              근거 리뷰 {count(o.evidenceCount)}건 보기 ›
            </Link>
          </p>
        ) : null}
      </section>

      {o.status === "OPEN" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <Btn
            size="sm"
            disabled={busy}
            onClick={() => run(() => api.acceptOpportunity(o.issueId, o.kind), "초안을 준비하지 못했습니다. 잠시 후 다시 시도해 주세요.")}
          >
            {busy ? "준비 중…" : o.nextActionKo}
          </Btn>
          <Btn
            size="sm"
            variant="ghost"
            disabled={busy}
            onClick={() => run(() => api.dismissOpportunity(o.issueId, o.kind), "상태를 바꾸지 못했습니다.")}
          >
            지금은 보류
          </Btn>
        </div>
      ) : null}

      {o.status === "DISMISSED" ? (
        <div className="mt-4 flex flex-wrap items-center gap-2">
          <p className="text-sm text-muted">보류한 기회입니다. 근거가 남아 있는 동안 다시 열 수 있습니다.</p>
          <Btn
            size="sm"
            variant="outline"
            disabled={busy}
            onClick={() => run(() => api.restoreOpportunity(o.issueId, o.kind), "상태를 바꾸지 못했습니다.")}
          >
            되돌리기
          </Btn>
        </div>
      ) : null}

      {o.status === "ACCEPTED" && o.draft ? (
        <section className="mt-4 space-y-3" aria-label="준비된 초안">
          <div>
            <label className="text-sm font-semibold text-ink" htmlFor={`opp-title-${o.issueId}-${o.kind}`}>
              준비된 초안
            </label>
            <input
              id={`opp-title-${o.issueId}-${o.kind}`}
              value={title}
              onChange={(e) => setTitle(e.target.value)}
              className="mt-1.5 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            />
            <textarea
              aria-label="초안 내용"
              value={body}
              onChange={(e) => setBody(e.target.value)}
              rows={Math.min(12, Math.max(4, body.split("\n").length + 1))}
              className="mt-2 w-full rounded-lg border border-line bg-surface px-3 py-2 text-base leading-relaxed text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            />
          </div>
          <div className="flex flex-wrap items-center gap-2">
            {dirty ? (
              <Btn
                size="sm"
                variant="outline"
                disabled={busy || title.trim().length === 0 || body.trim().length === 0}
                onClick={() =>
                  run(
                    () => api.updateOpportunityDraft(o.issueId, o.kind, { title, body }),
                    "초안을 저장하지 못했습니다.",
                  )
                }
              >
                초안 저장
              </Btn>
            ) : null}
            {destination.kind === "COPY" ? (
              <Btn size="sm" disabled={dirty} onClick={copyDraft}>
                {destination.label}
              </Btn>
            ) : savedTo ? null : (
              <Btn size="sm" disabled={dirty} onClick={() => setSaving(true)}>
                {destination.label}
              </Btn>
            )}
            <Btn
              size="sm"
              variant="ghost"
              disabled={busy}
              onClick={() => run(() => api.restoreOpportunity(o.issueId, o.kind), "상태를 바꾸지 못했습니다.")}
            >
              초안 버리기
            </Btn>
          </div>
          {dirty ? <p className="text-xs text-muted">고친 내용을 먼저 저장하면 {destination.label}가 열립니다.</p> : null}
          {copied === "ok" ? <p className="text-sm text-good">복사했습니다.</p> : null}
          {copied === "manual" ? (
            <p className="text-sm text-muted">이 브라우저에서는 자동 복사가 되지 않습니다. 위 내용을 직접 복사해 주세요.</p>
          ) : null}
          {savedTo ? (
            <p className="text-sm text-good">
              저장했습니다.{" "}
              <Link to={savedTo} className="font-semibold text-brand-700 hover:text-brand-800">
                저장한 곳 보기
              </Link>
            </p>
          ) : null}
          {saving && destination.kind === "KNOWLEDGE" ? (
            <KnowledgeQuickAdd
              scope={destination.scope}
              productId={o.productId}
              productName={o.productName}
              topic={destination.topic}
              body={body}
              saveLabel={destination.label}
              onSave={async (value) => {
                if (destination.scope === "PRODUCT" && o.productId) {
                  await api.createProductKnowledgeSource(o.productId, {
                    sourceType: value.topic as import("../../lib/types").KnowledgeSourceType,
                    title: title.trim() || value.title,
                    body: value.body,
                    variantId: value.variantId,
                  });
                  setSavedTo(`/products/${o.productId}`);
                } else {
                  await api.createOrgKnowledge({
                    knowledgeType: value.topic as import("../../lib/types").OrgKnowledgeType,
                    title: title.trim() || value.title,
                    body: value.body,
                    sourceUrl: null,
                  });
                  setSavedTo("/settings/policies");
                }
                setSaving(false);
              }}
              onCancel={() => setSaving(false)}
            />
          ) : null}
        </section>
      ) : null}

      {error ? <p className="mt-2 text-sm text-bad">{error}</p> : null}
    </article>
  );
}
