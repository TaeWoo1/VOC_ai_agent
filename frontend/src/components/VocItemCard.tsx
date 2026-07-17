import { useCallback, useEffect, useState } from "react";
import type { OperatorVocItem, TriageDisposition } from "../lib/types";
import { previewText, productLabel, replyStatusLabel } from "../lib/vocItems";
import { VocItemReplyPrep } from "./VocItemReplyPrep";
import { VocItemTriageControl } from "./VocItemTriageControl";

// One drill-down row behind an attention signal: the product it concerns, a reply
// chip, ★rating, dates, and a sanitized preview line. The preview is produced/redacted
// by the backend — this only renders it, or a neutral placeholder when none is
// available. No raw text.
//
// The product is a display NAME only — the backend sends no product identifier here —
// so it reads as the row's subject and is deliberately not a link or a routing target.

export function VocItemCard({ item, accountId }: { item: OperatorVocItem; accountId: string }) {
  const reply = replyStatusLabel(item.replyStatus);
  const preview = previewText(item.safePreview);
  const product = productLabel(item.productName);

  // The row's LIVE decision, not the one the list last fetched.
  //
  // `item` is a snapshot: the list refetches only on its own deps, and nothing on the triage
  // path bumps them. So a decision recorded in this session never reaches `item`, and a
  // mount rule reading it would leave an operator who just clicked 대응 필요 looking at a
  // pressed button and no panel — able to reach 답변 준비 only by reloading the page.
  //
  // Seeded from the row and advanced only on a server-confirmed decision (see
  // VocItemTriageControl.onRecorded). Re-seeded when the row itself changes, so a real
  // refetch — a new page, a new window — still wins over a stale session decision.
  const [decided, setDecided] = useState<TriageDisposition | null>(item.triageDisposition);
  useEffect(() => setDecided(item.triageDisposition), [item.triageDisposition]);

  // Whether this row carries reply work — the server's batch answer, promoted locally the
  // moment a draft is saved in this session.
  //
  // `item.hasReplyPreparation` is computed with the page, so it predates any draft written
  // since. Without the promotion an operator could save a draft, change their mind to
  // 지켜보기, and watch the panel take their draft with it — recoverable only by re-triaging
  // or reopening the drill-down.
  //
  // MONOTONIC within a session: it goes false → true and never back. The panel's job here is
  // to not vanish out from under work that exists, and nothing an operator does in this
  // session destroys a draft (a withdrawal explicitly keeps it), so there is no true → false
  // transition to model. The server is still the authority — reopening the drill-down
  // re-seeds from the batch projection below.
  const [prepared, setPrepared] = useState(item.hasReplyPreparation);
  useEffect(() => setPrepared(item.hasReplyPreparation), [item.hasReplyPreparation]);

  // Whether the panel is holding work that exists nowhere else — an unsaved edit, or a write
  // in flight. Unmounting over either destroys it silently: the buffer lives only in the
  // panel, and a write whose handler is unmounted reports neither success nor failure.
  //
  // Stable identity, so the panel's effect fires on the value changing rather than on this
  // row re-rendering.
  const [localWork, setLocalWork] = useState(false);
  const noteLocalWork = useCallback((has: boolean) => setLocalWork(has), []);
  const promote = useCallback(() => setPrepared(true), []);
  return (
    <li className="flex flex-col gap-2 py-3">
      {/* Subject line. The visually-redundant prefix is sr-only so the placeholder
          ("상품명 미상") is not announced as a bare, context-free string. */}
      <p
        className={`text-sm font-semibold ${product.isPlaceholder ? "text-muted italic font-normal" : "text-ink"}`}
      >
        <span className="sr-only">상품: </span>
        {product.text}
      </p>
      <div className="flex flex-col gap-2 md:flex-row md:items-center md:justify-between">
        <div className="flex flex-wrap items-center gap-3">
          <span
            className={`inline-flex items-center rounded-lg px-2.5 py-1 text-sm font-semibold ${reply.cls}`}
          >
            {reply.text}
          </span>
          {item.rating != null ? (
            <span className="text-sm font-semibold text-ink">{"★".repeat(item.rating)}</span>
          ) : null}
        </div>
        <div className="flex items-center gap-4 text-sm text-muted">
          <span>작성 {item.sourceCreatedDate ?? "날짜 미상"}</span>
          <span>수집 {item.collectedDate ?? "-"}</span>
        </div>
      </div>
      <p className={`text-sm ${preview.isPlaceholder ? "text-muted italic" : "text-ink"}`}>
        {preview.text}
      </p>
      {/* Only for a row that can actually carry a decision. A null actionRef is a
          capability limit (a Cafe24 community article has no triage anchor), so the row
          stays fully readable and simply offers nothing — rendering a disabled control
          would say "you may not", when the truth is "this row cannot be decided". */}
      {item.actionRef != null ? (
        <VocItemTriageControl
          accountId={accountId}
          actionRef={item.actionRef}
          disposition={item.triageDisposition}
          onRecorded={setDecided}
        />
      ) : null}
      {/* Reply preparation, for a row that can carry a decision AND either needs one now or
          already carries work. Mounting it opens a read, so it stays off rows that offer
          nothing.

          The `|| prepared` half is what keeps work from being stranded: a draft written while
          the review was 대응 필요 must stay readable — and any approval withdrawable — after
          the operator moves it to 지켜보기. On the decision alone that row would render no
          panel, leaving an approved reply the operator can neither see nor take back.

          Both operands are free: `decided` is local, and `prepared` starts from a flag the
          page already batch-computed and is promoted in-session by the panel's own save. So
          the rule costs no request of its own — the panel reads once when it mounts, and
          again only after its own writes. */}
      {item.actionRef != null && (decided === "RESPONSE_NEEDED" || prepared || localWork) ? (
        <VocItemReplyPrep
          accountId={accountId}
          actionRef={item.actionRef}
          disposition={decided}
          onPrepared={promote}
          onLocalWork={noteLocalWork}
        />
      ) : null}
    </li>
  );
}
