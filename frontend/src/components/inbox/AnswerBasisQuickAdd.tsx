import { useEffect, useState } from "react";
import { Btn } from "../ui/Btn";
import { api } from "../../lib/apiClient";
import type { ProductVariantView } from "../../lib/types";

/**
 * 답변 기준 추가 — write the missing knowledge without leaving the inquiry.
 *
 * <b>The seller already told us everything except the sentence.</b> The product, the channel and the
 * question are on screen; sending them to the product library to search for the product again would
 * make them re-establish context the machine has. So this is the same POST the library screen makes,
 * with the product supplied and the form reduced to the two decisions only a person can make: what is
 * true, and whether it is true of the whole listing or of one 규격.
 *
 * <b>It saves and re-asks. It does not send.</b> Saving re-indexes, the caller regenerates, and the
 * regenerated draft goes through the same approval and the same confirm-before-send as every other
 * one. Nothing here reaches a marketplace.
 *
 * <b>Variants come from the channel, never from this box.</b> The select is populated from stored
 * `product_variants` rows; there is no free-text option name, because a 규격 the seller typed would
 * be a second naming space that nothing can reconcile with what the customer chose from.
 */
export function AnswerBasisQuickAdd({
  productId,
  onSaved,
}: {
  productId: string;
  onSaved: () => void | Promise<void>;
}) {
  const [open, setOpen] = useState(false);
  const [body, setBody] = useState("");
  const [variantId, setVariantId] = useState("");
  const [variants, setVariants] = useState<ProductVariantView[] | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);

  useEffect(() => {
    if (!open) return;
    let active = true;
    // Lazily, and only once the seller has decided to write something: the seller who reads the
    // sentence and moves on should not have paid for a catalogue read.
    void api
      .getProductKnowledgeStrict(productId)
      .then((view) => active && setVariants(view.variants.filter((v) => v.optionName)))
      .catch(() => active && setVariants([]));
    return () => {
      active = false;
    };
  }, [open, productId]);

  async function onSave() {
    const written = body.trim();
    if (!written) return;
    setBusy(true);
    setError(null);
    try {
      await api.createProductKnowledgeSource(productId, {
        sourceType: "DESCRIPTION",
        title: titleFor(written),
        body: written,
        variantId: variantId || null,
      });
      setBody("");
      setVariantId("");
      setOpen(false);
      await onSaved();
    } catch {
      setError("답변 기준을 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setBusy(false);
    }
  }

  if (!open) {
    return (
      <div className="mt-3">
        <Btn onClick={() => setOpen(true)}>답변 기준 추가</Btn>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-xl border border-line bg-surface p-4">
      <p className="break-keep text-base font-semibold text-ink">이 상품의 답변 기준</p>
      {/*
        Named 「답변 기준 내용」, not 「내용」: the reply box below carries that word already, and two
        boxes labelled the same on one screen is how a seller types their answer into the library.
      */}
      <label className="mt-3 block text-sm font-medium text-ink" htmlFor="answer-basis-body">
        답변 기준 내용
      </label>
      <textarea
        id="answer-basis-body"
        rows={4}
        className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-ink"
        placeholder="이 질문에 답할 때 기준이 되는 사실을 적어 주세요."
        value={body}
        onChange={(e) => setBody(e.target.value)}
        disabled={busy}
      />
      <label className="mt-3 block text-sm font-medium text-ink" htmlFor="answer-basis-variant">
        적용 범위
      </label>
      <select
        id="answer-basis-variant"
        className="mt-1 w-full rounded-lg border border-line bg-canvas p-2 text-ink"
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
      {error ? <p className="mt-2 break-keep text-sm text-warn">{error}</p> : null}
      <div className="mt-4 flex flex-wrap gap-2">
        <Btn onClick={onSave} disabled={busy || !body.trim()}>
          {busy ? "저장 중…" : "저장하고 다시 답변 만들기"}
        </Btn>
        <Btn variant="outline" onClick={() => setOpen(false)} disabled={busy}>
          취소
        </Btn>
      </div>
    </div>
  );
}

/**
 * The document's title, taken from the first line the seller wrote.
 *
 * The full editor asks for a title; this form does not, because a seller answering one question
 * should type one thing. A note's first line becoming its title is the convention every notebook
 * uses, and it stays editable in the product library afterwards.
 */
export function titleFor(body: string): string {
  const first = body.split("\n").map((line) => line.trim()).find((line) => line.length > 0);
  if (!first) return "답변 기준";
  return first.length > 60 ? `${first.slice(0, 60)}…` : first;
}
