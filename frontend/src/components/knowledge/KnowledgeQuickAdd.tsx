import { useEffect, useState } from "react";
import { Btn } from "../ui/Btn";
import { api } from "../../lib/apiClient";
import { ORG_TOPICS, PRODUCT_TOPICS } from "../../lib/knowledgeWords";
import type { KnowledgeTopicValue } from "../../lib/knowledgeWords";
import type { ProductVariantView } from "../../lib/types";

/** What the seller decided, handed to whoever owns the write. */
export interface QuickAddValue {
  /** The stored type token — `KnowledgeSourceType` for a product, `OrgKnowledgeType` for the company. */
  topic: KnowledgeTopicValue;
  title: string;
  body: string;
  /** The 규격 this applies to, or null for the whole listing. Always null for a company-wide rule. */
  variantId: string | null;
}

/**
 * <b>The one structured editor knowledge is written in.</b>
 * (Knowledge Setup &amp; Inbox UX v1 §4)
 *
 * <p>Chat and the knowledge inbox carry the REASON — which customer asked, what could not be
 * answered — and this carries the DECISION. A sentence typed into a conversation is not knowledge
 * until a person has said what it is about and where it applies, and those are the two things a
 * free-text turn cannot capture without guessing.
 *
 * <p><b>Every field is a decision only a person can make.</b> Scope is shown and not asked — the
 * seller opened this from a product, or from the company's rules, and asking them to pick the
 * product again is asking them to re-establish context the machine has. Provenance is stated rather
 * than chosen: what they write here is theirs.
 *
 * <p><b>It saves nothing itself.</b> The caller owns the write, because the same form serves three
 * different ones (a product source, a company rule, and accepting a candidate — which must close
 * the candidate in the same press). A component that both edits and decides where the row goes is
 * two components arguing about one truth.
 *
 * <p>Reaches no marketplace and calls no model.
 */
export function KnowledgeQuickAdd({
  scope,
  productId,
  productName,
  topic,
  body,
  variants: variantsAllowed = true,
  saveLabel = "저장",
  onSave,
  onCancel,
}: {
  scope: "PRODUCT" | "ORG";
  /** Required for a product 규격 list; the caller has it because the caller chose the scope. */
  productId?: string | null;
  productName?: string | null;
  /** Preselected type, when the thing that opened this knows what it is about. */
  topic?: KnowledgeTopicValue | null;
  /** Prefilled text — a sentence the seller already wrote. Empty for a question they must answer. */
  body?: string | null;
  /**
   * Whether the caller's write can carry a 규격.
   *
   * <p>All three callers can, since Knowledge Gap Continuity v1 gave `accept` a `variantId`. The
   * switch stays because the rule it encodes is the one worth keeping: a select that silently drops
   * the seller's choice is worse than an absent one, so a caller whose write cannot carry a 규격
   * must not offer the control.
   */
  variants?: boolean;
  saveLabel?: string;
  onSave: (value: QuickAddValue) => Promise<void>;
  onCancel: () => void;
}) {
  const topics = scope === "PRODUCT" ? PRODUCT_TOPICS : ORG_TOPICS;
  const [chosenTopic, setChosenTopic] = useState<KnowledgeTopicValue>(topic ?? topics[0].value);
  const [text, setText] = useState(body ?? "");
  const [variantId, setVariantId] = useState("");
  const [variants, setVariants] = useState<ProductVariantView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (scope !== "PRODUCT" || !productId || !variantsAllowed) {
      setVariants([]);
      return;
    }
    let active = true;
    void api
      .getProductKnowledgeStrict(productId)
      .then((view) => active && setVariants(view.variants.filter((v) => v.optionName)))
      .catch(() => active && setVariants([]));
    return () => {
      active = false;
    };
  }, [scope, productId, variantsAllowed]);

  async function save() {
    const written = text.trim();
    if (!written) return;
    setBusy(true);
    setError(null);
    try {
      await onSave({
        topic: chosenTopic,
        title: titleFor(written),
        body: written,
        variantId: scope === "PRODUCT" && variantsAllowed ? variantId || null : null,
      });
    } catch {
      setError("저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-4" data-testid="knowledge-quick-add">
      <p className="break-keep text-base font-semibold text-ink">
        {scope === "PRODUCT" ? "상품 지식 추가" : "운영 기준 추가"}
      </p>

      {/* 어디에 · 무엇에 대한 것인가 — the two facts that make a sentence usable, on one line. */}
      <dl className="mt-3 flex flex-wrap gap-x-6 gap-y-1 text-sm">
        <div className="flex gap-2">
          <dt className="text-muted">적용 범위</dt>
          <dd className="break-keep font-medium text-ink">
            {scope === "PRODUCT" ? (productName ?? "이 상품") : "회사 전체"}
          </dd>
        </div>
        <div className="flex gap-2">
          <dt className="text-muted">출처</dt>
          <dd className="font-medium text-ink">판매자가 직접 입력</dd>
        </div>
      </dl>

      <label className="mt-3 block text-sm font-medium text-ink" htmlFor="quick-add-topic">
        주제
      </label>
      <select
        id="quick-add-topic"
        className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-base text-ink"
        value={chosenTopic}
        onChange={(e) => setChosenTopic(e.target.value as KnowledgeTopicValue)}
        disabled={busy}
      >
        {topics.map((t) => (
          <option key={t.value} value={t.value}>
            {t.label} — {t.hint}
          </option>
        ))}
      </select>

      <label className="mt-3 block text-sm font-medium text-ink" htmlFor="quick-add-body">
        고객에게 안내할 내용
      </label>
      <textarea
        id="quick-add-body"
        rows={4}
        className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-base text-ink"
        placeholder="고객에게 그대로 안내할 수 있는 문장으로 적어 주세요."
        value={text}
        onChange={(e) => setText(e.target.value)}
        disabled={busy}
      />

      {/*
        규격 — the second axis, and the only one a customer can be wrong about. Shown only for a
        product, and shown even when the listing has none, because its absence is informative.
      */}
      {scope === "PRODUCT" && variantsAllowed ? (
        <>
          <label className="mt-3 block text-sm font-medium text-ink" htmlFor="quick-add-variant">
            규격
          </label>
          <select
            id="quick-add-variant"
            className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-base text-ink"
            value={variantId}
            onChange={(e) => setVariantId(e.target.value)}
            disabled={busy || variants === null}
          >
            <option value="">전체 상품 공통</option>
            {(variants ?? []).map((variant) => (
              <option key={variant.id} value={variant.id}>
                {variant.optionName}
              </option>
            ))}
          </select>
          <p className="mt-1.5 break-keep text-sm text-muted">
            규격에 따라 답이 달라지면 규격을 골라 주세요. 고른 규격의 문의에만 사용합니다.
          </p>
        </>
      ) : null}

      {error ? <p className="mt-2 break-keep text-sm text-warn" role="alert">{error}</p> : null}

      <div className="mt-4 flex flex-wrap gap-2">
        <Btn onClick={() => void save()} disabled={busy || !text.trim()}>
          {busy ? "저장 중…" : saveLabel}
        </Btn>
        <Btn variant="outline" onClick={onCancel} disabled={busy}>
          취소
        </Btn>
      </div>
    </div>
  );
}

/**
 * The document's title, taken from the first line the seller wrote.
 *
 * The full library editor asks for a title; this form does not, because a seller answering one
 * question should type one thing. A note's first line becoming its title is the convention every
 * notebook uses, and it stays editable in the library afterwards.
 */
export function titleFor(body: string): string {
  const first = body.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  if (!first) return "답변 기준";
  return first.length > 60 ? `${first.slice(0, 60)}…` : first;
}
