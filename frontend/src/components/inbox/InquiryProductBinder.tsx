import { useCallback, useEffect, useState } from "react";
import { isAxiosError } from "axios";
import { api } from "../../lib/apiClient";
import {
  bindErrorMessage,
  needsOverrideConfirm,
  SOURCE_BINDING_EXISTS,
} from "../../lib/inquiryProductBinding";
import type { InquiryDetail, ProductSummaryView } from "../../lib/types";
import { Btn } from "../ui/Btn";

/**
 * "이 문의는 어떤 상품에 대한 것인가" — asked of the person who knows, never guessed.
 *
 * ## What this deliberately does not do
 *
 * It does not read the inquiry. Nothing here looks at the question's text, ranks candidates by
 * similarity to it, pre-selects the closest name, or asks a model. The seller types their own words
 * into the same product search the rest of the product uses, and the id that reaches the backend is
 * the one they clicked. Every shortcut in that list — auto-selecting a single result, defaulting to
 * the last-used product, matching on a shared title — would produce an attribution nobody made, and
 * an attribution nobody made is exactly what the 3,415 number-named and bucketed rows were.
 *
 * A single result is therefore still one click away, and an empty search is an empty list rather
 * than "everything you sell".
 *
 * ## The override
 *
 * Replacing an attribution the CHANNEL made needs a second press. The screen asks first when it can
 * already tell, and the backend's 409 `SOURCE_BINDING_EXISTS` asks anyway when it cannot — a detail
 * loaded before a collection run can be stale about which kind of binding is in place. Either way the
 * override flag is set by the seller's answer to a stated question and never pre-armed.
 */
export function InquiryProductBinder({
  detail,
  onBound,
  onCancel,
}: {
  detail: InquiryDetail;
  onBound: (productId: string, productName: string | null) => void;
  onCancel: () => void;
}) {
  const [query, setQuery] = useState("");
  const [results, setResults] = useState<ProductSummaryView[]>([]);
  const [searching, setSearching] = useState(false);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  /** The product the seller picked that would overrule the channel — held until they confirm. */
  const [pendingOverride, setPendingOverride] = useState<ProductSummaryView | null>(null);

  const search = useCallback(async (term: string) => {
    if (!term.trim()) {
      setResults([]);
      return;
    }
    setSearching(true);
    try {
      setResults(await api.searchProductsStrict(term.trim(), 20));
    } catch {
      setResults([]);
      setError("상품을 찾지 못했습니다. 잠시 후 다시 시도해 주세요.");
    } finally {
      setSearching(false);
    }
  }, []);

  useEffect(() => {
    const handle = setTimeout(() => void search(query), 250);
    return () => clearTimeout(handle);
  }, [query, search]);

  async function bind(product: ProductSummaryView, override: boolean) {
    setBusy(true);
    setError(null);
    try {
      const bound = await api.bindInquiryProduct(detail.workItemId, product.id, override);
      onBound(bound.productId ?? product.id, bound.productName ?? product.name);
    } catch (e) {
      const status = isAxiosError(e) ? e.response?.status : undefined;
      const code = isAxiosError(e)
        ? ((e.response?.data as { code?: string } | undefined)?.code ?? null)
        : null;
      if (code === SOURCE_BINDING_EXISTS) {
        // Not an error the seller has to fix — a question only they can answer.
        setPendingOverride(product);
        setError(null);
      } else {
        setError(bindErrorMessage(status, code));
      }
    } finally {
      setBusy(false);
    }
  }

  if (pendingOverride) {
    return (
      <div className="mt-3 rounded-lg border border-line bg-canvas p-4">
        <p className="break-keep text-sm leading-relaxed text-ink">
          이 문의는 채널이 알려준 상품 번호로 <b>{detail.productName ?? "다른 상품"}</b>에 연결돼
          있습니다. <b>{pendingOverride.name}</b>(으)로 바꾸시겠습니까?
        </p>
        <div className="mt-3 flex flex-wrap gap-2">
          <Btn size="sm" onClick={() => void bind(pendingOverride, true)} disabled={busy}>
            {busy ? "바꾸는 중…" : "이 상품으로 바꾸기"}
          </Btn>
          <Btn size="sm" variant="ghost" onClick={() => setPendingOverride(null)} disabled={busy}>
            그대로 두기
          </Btn>
        </div>
      </div>
    );
  }

  return (
    <div className="mt-3 rounded-lg border border-line bg-canvas p-4">
      <label className="block text-sm font-medium text-ink" htmlFor="bind-product-search">
        상품 검색
      </label>
      <input
        id="bind-product-search"
        className="mt-1 w-full rounded-lg border border-line bg-surface p-2 text-ink"
        placeholder="상품명 또는 상품코드"
        value={query}
        onChange={(e) => setQuery(e.target.value)}
        disabled={busy}
        autoComplete="off"
      />
      {error ? <p className="mt-2 break-keep text-sm text-warn">{error}</p> : null}
      {searching ? <p className="mt-2 text-sm text-muted">찾는 중…</p> : null}
      {!searching && query.trim() && results.length === 0 ? (
        <p className="mt-2 break-keep text-sm text-muted">검색 결과가 없습니다.</p>
      ) : null}
      <ul className="mt-2 space-y-1">
        {results.map((product) => (
          <li key={product.id}>
            <button
              type="button"
              className="w-full rounded-lg px-2 py-1.5 text-left text-sm text-ink hover:bg-surface disabled:opacity-50"
              onClick={() => {
                // Ask before the round trip when the screen already knows this overrules the
                // channel. The 409 below stays as the backstop for a detail that has gone stale.
                if (needsOverrideConfirm(detail, product.id)) {
                  setPendingOverride(product);
                  return;
                }
                void bind(product, false);
              }}
              disabled={busy}
            >
              <span className="break-keep font-medium">{product.name}</span>
              {product.sku ? <span className="ml-2 text-muted">{product.sku}</span> : null}
            </button>
          </li>
        ))}
      </ul>
      <div className="mt-3">
        <Btn size="sm" variant="ghost" onClick={onCancel} disabled={busy}>
          취소
        </Btn>
      </div>
    </div>
  );
}
