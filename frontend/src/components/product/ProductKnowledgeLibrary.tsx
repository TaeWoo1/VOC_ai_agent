import { useEffect, useState } from "react";
import { Btn } from "../ui/Btn";
import { Empty } from "../ui/Empty";
import { api } from "../../lib/apiClient";
import type {
  KnowledgeSourceType,
  KnowledgeSourceView,
  ProductVariantView,
} from "../../lib/types";

/**
 * 상품 지식 — what the SELLER wrote about this product.
 *
 * <b>A different axis from the catalogue above it.</b> Listings and specs are what a channel stated;
 * this is what a person wrote, and the Agent is required to keep the two apart when it cites either.
 * The screen keeps them apart too: separate section, separate wording, separate provenance line.
 *
 * <b>`chunks` is shown because it is what retrieval can reach.</b> A document saved with zero
 * passages is a document the Agent will never quote, and a seller should learn that here rather than
 * from an answer that quietly did not use it.
 */
const TYPES: Array<{ value: KnowledgeSourceType; label: string; hint: string }> = [
  { value: "DESCRIPTION", label: "상품 설명", hint: "이 상품이 무엇인지, 어떤 점이 다른지" },
  { value: "FAQ", label: "자주 묻는 질문", hint: "고객이 반복해서 묻는 것과 그 답" },
  { value: "USAGE", label: "사용법", hint: "사용·설치·보관 방법" },
  { value: "POLICY", label: "정책", hint: "교환·반품·배송·A/S 기준" },
  { value: "LINK", label: "참고 자료", hint: "상세페이지 주소와 옮겨 적은 내용" },
];

const TYPE_LABEL: Record<KnowledgeSourceType, string> = {
  DESCRIPTION: "상품 설명",
  FAQ: "자주 묻는 질문",
  USAGE: "사용법",
  POLICY: "정책",
  LINK: "참고 자료",
};

export function ProductKnowledgeLibrary({ productId }: { productId: string }) {
  const [sources, setSources] = useState<KnowledgeSourceView[] | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [editing, setEditing] = useState<KnowledgeSourceView | "new" | null>(null);

  useEffect(() => {
    let active = true;
    setSources(null);
    setLoadError(false);
    void api
      .listProductKnowledgeSources(productId)
      .then((list) => active && setSources(list))
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, [productId]);

  const reload = async () => {
    const list = await api.listProductKnowledgeSources(productId);
    setSources(list);
    setEditing(null);
  };

  if (loadError) {
    return <p className="text-warn">상품 지식을 불러오지 못했습니다.</p>;
  }

  return (
    <div className="space-y-4">
      {sources === null ? (
        <p className="text-muted">불러오는 중…</p>
      ) : sources.length === 0 && editing === null ? (
        <Empty
          title="아직 등록된 상품 지식이 없습니다"
          body="상품 설명·자주 묻는 질문·사용법·정책을 적어 두면, AI가 답변을 만들 때 이 내용을 근거로 사용합니다. 여기에 없는 내용은 지어내지 않습니다."
          action={<Btn onClick={() => setEditing("new")}>지식 추가</Btn>}
        />
      ) : (
        <>
          <ul className="divide-y divide-line/70">
            {(sources ?? []).map((source) => (
              <li key={source.id} className="py-4 first:pt-0">
                <div className="flex flex-wrap items-start justify-between gap-2">
                  <div className="min-w-0">
                    <p className="break-keep font-semibold text-ink">
                      <span className="mr-2 rounded-full bg-canvas px-2 py-0.5 text-sm font-medium text-muted">
                        {TYPE_LABEL[source.sourceType]}
                      </span>
                      {source.title}
                    </p>
                    <p className="mt-1 break-keep text-sm text-muted">{preview(source.body)}</p>
                    <p className="mt-1 text-sm text-muted">
                      {source.variantId ? `${source.variantName ?? "특정 규격"} 전용 · ` : ""}
                      {source.authorName ? `${source.authorName} · ` : ""}
                      {source.updatedAt.slice(0, 10)} · 인용 단위 {source.chunks}개
                      {source.chunks === 0 ? " (AI가 인용할 수 없습니다)" : ""}
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
            <Btn variant="outline" size="sm" onClick={() => setEditing("new")}>
              지식 추가
            </Btn>
          ) : null}
        </>
      )}

      {editing !== null ? (
        <KnowledgeEditor
          productId={productId}
          source={editing === "new" ? null : editing}
          onDone={reload}
          onCancel={() => setEditing(null)}
        />
      ) : null}
    </div>
  );
}

/** First two lines, so the list stays a list. The document itself is one click away. */
function preview(body: string): string {
  const flat = body.replace(/\s+/g, " ").trim();
  return flat.length > 140 ? `${flat.slice(0, 140)}…` : flat;
}

/**
 * The write form.
 *
 * <b>Saving is the only thing that indexes.</b> There is no separate "reindex" action and no queue:
 * the backend rebuilds this document's passages inside the same transaction, so a seller never has to
 * wonder whether what they just wrote is usable yet.
 */
function KnowledgeEditor({
  productId,
  source,
  onDone,
  onCancel,
}: {
  productId: string;
  source: KnowledgeSourceView | null;
  onDone: () => Promise<void>;
  onCancel: () => void;
}) {
  const [sourceType, setSourceType] = useState<KnowledgeSourceType>(source?.sourceType ?? "USAGE");
  const [title, setTitle] = useState(source?.title ?? "");
  const [body, setBody] = useState(source?.body ?? "");
  const [sourceUrl, setSourceUrl] = useState(source?.sourceUrl ?? "");
  const [variantId, setVariantId] = useState(source?.variantId ?? "");
  const [variants, setVariants] = useState<ProductVariantView[]>([]);
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    let active = true;
    void api
      .getProductKnowledgeStrict(productId)
      .then((view) => active && setVariants(view.variants.filter((v) => v.optionName)))
      .catch(() => active && setVariants([]));
    return () => {
      active = false;
    };
  }, [productId]);

  const submit = async () => {
    setSaving(true);
    setError(null);
    try {
      const request = {
        sourceType,
        title: title.trim(),
        body: body.trim(),
        sourceUrl: sourceUrl.trim() || null,
        variantId: variantId || null,
      };
      if (source) {
        await api.updateProductKnowledgeSource(source.id, request);
      } else {
        await api.createProductKnowledgeSource(productId, request);
      }
      await onDone();
    } catch {
      // Deliberately not the server's message: a failure here is one of two things a seller can act
      // on, and a transport-shaped string is neither of them.
      setError("저장하지 못했습니다. 제목과 내용을 확인해 주세요. 같은 제목의 지식이 이미 있을 수 있습니다.");
    } finally {
      setSaving(false);
    }
  };

  const remove = async () => {
    if (!source) return;
    setSaving(true);
    try {
      await api.deleteProductKnowledgeSource(source.id);
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
          <span className="text-sm font-medium text-ink">종류</span>
          <select
            value={sourceType}
            onChange={(e) => setSourceType(e.target.value as KnowledgeSourceType)}
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
            placeholder="예: 세탁 및 관리 방법"
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base focus:border-brand focus:outline-none"
          />
        </label>
      </div>

      {/*
        적용 범위 — the second axis, and the only one a customer can be wrong about.

        Shown even when the product has no stored variants, because its absence is informative: a
        listing with one 규격 has one honest answer, and hiding the control would leave a seller
        wondering where per-규격 knowledge goes.
      */}
      <label className="block">
        <span className="text-sm font-medium text-ink">적용 범위</span>
        <select
          value={variantId}
          onChange={(e) => setVariantId(e.target.value)}
          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base focus:border-brand focus:outline-none"
        >
          <option value="">전체 상품 공통</option>
          {variants.map((variant) => (
            <option key={variant.id} value={variant.id}>
              {variant.optionName}
            </option>
          ))}
        </select>
        <span className="mt-1 block break-keep text-sm text-muted">
          규격에 따라 답이 달라지는 내용이면 규격을 골라 주세요. 다른 규격의 문의에는 사용하지 않습니다.
        </span>
      </label>

      <label className="block">
        <span className="text-sm font-medium text-ink">내용</span>
        <textarea
          value={body}
          onChange={(e) => setBody(e.target.value)}
          rows={8}
          placeholder={"고객에게 그대로 설명할 수 있는 문장으로 적어 주세요.\n\n빈 줄로 문단을 나누면 그 단위로 인용됩니다."}
          className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base leading-relaxed focus:border-brand focus:outline-none"
        />
      </label>

      {sourceType === "LINK" ? (
        <label className="block">
          <span className="text-sm font-medium text-ink">원문 주소</span>
          <input
            value={sourceUrl}
            onChange={(e) => setSourceUrl(e.target.value)}
            placeholder="https://…"
            className="mt-1 w-full rounded-xl border border-line bg-surface px-3 py-2.5 text-base focus:border-brand focus:outline-none"
          />
          {/* Said plainly: SellerOps does not fetch it. Automatic acquisition is an approved action,
              never a side effect of saving a note. */}
          <span className="mt-1 block text-sm text-muted">
            주소는 출처로만 남습니다. SellerOps가 이 주소를 열어 내용을 가져오지는 않습니다.
          </span>
        </label>
      ) : null}

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
