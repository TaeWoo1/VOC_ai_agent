import { useEffect, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { Panel } from "../../components/ui/Panel";
import { Btn } from "../../components/ui/Btn";
import { Empty } from "../../components/ui/Empty";
import { api } from "../../lib/apiClient";
import type { OrgKnowledgeType, OrgKnowledgeView } from "../../lib/types";

/**
 * 운영 정책 / 답변 기준 — the rules this company answers by.
 *
 * <b>Why this screen exists at all.</b> 상품 지식 answers questions about a product. Most real
 * questions are not about a product: in the Demo Org's own unanswered backlog the two most common
 * topics are 세금계산서 and 현금영수증, and neither resolves to a listing. Until these rules are
 * written down, every one of those is answered from nothing.
 *
 * <b>The seller never sees an enum.</b> The storage vocabulary is `SHIPPING_POLICY` and the like;
 * what is on screen is 배송, 주문 취소, 교환·반품·환불. A settings page that asks a shop owner to pick
 * between two English constants is asking them to read the schema.
 *
 * <b>인용 단위 is shown for the same reason the product library shows it.</b> A rule saved with zero
 * passages is a rule an answer can never quote, and the seller should learn that here rather than
 * from a reply that quietly did not use it.
 */
const TYPES: Array<{ value: OrgKnowledgeType; label: string; hint: string }> = [
  { value: "SHIPPING_POLICY", label: "배송", hint: "출고까지 걸리는 기간, 배송비, 도서산간" },
  { value: "CANCELLATION_POLICY", label: "주문 취소", hint: "언제까지, 어떤 방법으로 취소되는지" },
  { value: "EXCHANGE_REFUND_POLICY", label: "교환·반품·환불", hint: "기간, 조건, 배송비 부담" },
  { value: "PAYMENT_POLICY", label: "결제", hint: "결제 수단, 입금 확인, 부분 결제" },
  { value: "TAX_INVOICE", label: "세금계산서", hint: "발행 조건과 필요한 서류" },
  { value: "CASH_RECEIPT", label: "현금영수증", hint: "발급 조건과 신청 방법" },
  { value: "GENERAL_CS_FAQ", label: "공통 안내", hint: "위에 없는, 자주 묻는 것" },
  { value: "OTHER", label: "기타", hint: "아직 분류하지 않은 기준" },
];

export function OperationsPolicies() {
  const [sources, setSources] = useState<OrgKnowledgeView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<OrgKnowledgeView | "new" | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .listOrgKnowledge()
      .then((list) => active && setSources(list))
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, []);

  const reload = async () => {
    setSources(await api.listOrgKnowledge());
    setEditing(null);
  };

  return (
    <>
      <PageHead
        title="운영 정책 / 답변 기준"
        description="배송·취소·교환·증빙처럼 상품과 무관한 질문에 답할 때 쓰는 기준입니다."
      />

      <Panel
        title="등록된 기준"
        description="여기에 적힌 내용만 답변의 근거로 쓰입니다. 적혀 있지 않은 조건이나 기간은 만들어 쓰지 않습니다."
      >
        {loadError ? (
          <p className="text-warn">운영 정책을 불러오지 못했습니다.</p>
        ) : sources === null ? (
          <p className="text-muted">불러오는 중…</p>
        ) : sources.length === 0 && editing === null ? (
          <Empty
            title="아직 등록된 기준이 없습니다"
            body="배송·주문 취소·교환·세금계산서·현금영수증처럼 자주 묻는 것을 적어 두면, 상품과 연결되지 않은 문의에도 근거를 갖고 답할 수 있습니다."
            action={<Btn onClick={() => setEditing("new")}>기준 추가</Btn>}
          />
        ) : (
          <>
            <ul className="divide-y divide-line/70">
              {sources.map((source) => (
                <li key={source.id} className="py-4 first:pt-0">
                  <div className="flex flex-wrap items-start justify-between gap-2">
                    <div className="min-w-0">
                      <p className="break-keep font-semibold text-ink">
                        <span className="mr-2 rounded-full bg-canvas px-2 py-0.5 text-sm font-medium text-muted">
                          {source.typeLabel}
                        </span>
                        {source.title}
                      </p>
                      <p className="mt-1 break-keep text-sm text-muted">{preview(source.body)}</p>
                      <p className="mt-1 text-sm text-muted">
                        {source.authorName ? `${source.authorName} · ` : ""}
                        {source.updatedAt.slice(0, 10)}
                        {source.version > 1 ? ` · ${source.version}차 개정` : ""} · 인용 단위{" "}
                        {source.passageCount}개
                        {source.passageCount === 0 ? " (답변에 인용할 수 없습니다)" : ""}
                      </p>
                    </div>
                    <button
                      type="button"
                      onClick={() => setEditing(source)}
                      className="shrink-0 rounded-lg text-sm font-medium text-muted hover:text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2"
                    >
                      수정
                    </button>
                  </div>
                </li>
              ))}
            </ul>
            {editing === null ? (
              <div className="mt-4">
                <Btn variant="outline" size="sm" onClick={() => setEditing("new")}>
                  기준 추가
                </Btn>
              </div>
            ) : null}
          </>
        )}

        {editing !== null ? (
          <div className="mt-4">
            <PolicyEditor
              source={editing === "new" ? null : editing}
              onDone={reload}
              onCancel={() => setEditing(null)}
            />
          </div>
        ) : null}
      </Panel>
    </>
  );
}

/** First two lines, so the list stays a list. The rule itself is one click away. */
function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
}

/**
 * The write form.
 *
 * <b>Saving is the only thing that indexes.</b> The backend rebuilds this rule's passages inside the
 * same transaction, so a seller never has to wonder whether what they just wrote is usable yet.
 */
function PolicyEditor({
  source,
  onDone,
  onCancel,
}: {
  source: OrgKnowledgeView | null;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [knowledgeType, setKnowledgeType] = useState<OrgKnowledgeType>(
    source?.knowledgeType ?? "SHIPPING_POLICY",
  );
  const [title, setTitle] = useState(source?.title ?? "");
  const [body, setBody] = useState(source?.body ?? "");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const request = { knowledgeType, title: title.trim(), body: body.trim(), sourceUrl: null };
      if (source) {
        await api.updateOrgKnowledge(source.id, request);
      } else {
        await api.createOrgKnowledge(request);
      }
      await onDone();
    } catch {
      // Deliberately not the server's message: a failure here is one of two things a seller can act
      // on, and a transport-shaped string is neither of them.
      setError("저장하지 못했습니다. 제목과 내용을 확인해 주세요. 같은 제목의 기준이 이미 있을 수 있습니다.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!source) return;
    setSaving(true);
    try {
      await api.deleteOrgKnowledge(source.id);
      await onDone();
    } catch {
      setError("삭제하지 못했습니다.");
    } finally {
      setSaving(false);
    }
  };

  return (
    <div className="space-y-4 rounded-2xl border border-brand/30 bg-brand-50/30 p-5">
      <div className="grid gap-3 sm:grid-cols-2">
        <label className="block">
          <span className="text-sm font-medium text-ink">무엇에 대한 기준인가요</span>
          <select
            value={knowledgeType}
            onChange={(e) => setKnowledgeType(e.target.value as OrgKnowledgeType)}
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base focus:border-brand focus:outline-none"
          >
            {TYPES.map((t) => (
              <option key={t.value} value={t.value}>
                {t.label} — {t.hint}
              </option>
            ))}
          </select>
        </label>
        <label className="block">
          <span className="text-sm font-medium text-ink">제목</span>
          <input
            value={title}
            onChange={(e) => setTitle(e.target.value)}
            maxLength={200}
            placeholder="예: 현금영수증 발급 안내"
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base focus:border-brand focus:outline-none"
          />
        </label>
      </div>

      <label className="block">
        <span className="text-sm font-medium text-ink">내용</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder={
            "고객에게 그대로 안내할 수 있는 문장으로 적어 주세요.\n\n빈 줄로 문단을 나누면 그 단위로 인용됩니다."
          }
          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base leading-relaxed focus:border-brand focus:outline-none"
        />
      </label>

      {error ? <p className="text-warn">{error}</p> : null}

      <div className="flex flex-wrap items-center gap-2">
        <Btn onClick={submit} disabled={saving || !title.trim() || !body.trim()}>
          {saving ? "저장 중…" : "저장"}
        </Btn>
        <Btn variant="ghost" onClick={onCancel} disabled={saving}>
          취소
        </Btn>
        {source ? (
          <Btn variant="ghost" onClick={remove} disabled={saving} className="ml-auto text-bad">
            삭제
          </Btn>
        ) : null}
      </div>
    </div>
  );
}
