import { useCallback, useEffect, useState } from "react";
import type { OperatorVocItem, TriageDisposition } from "../lib/types";
import {
  categoryChip,
  previewText,
  productLabel,
  replyStatusLabel,
  reportedSubmissionLabel,
  triageDispositionLabel,
} from "../lib/vocItems";
import { VocItemReplyPrep } from "./VocItemReplyPrep";
import { VocItemTriageControl } from "./VocItemTriageControl";

// One drill-down row behind an attention signal: the product it concerns, a reply
// chip, ★rating, dates, and a sanitized preview line. The preview is produced/redacted
// by the backend — this only renders it, or a neutral placeholder when none is
// available. No raw text.
//
// The product is a display NAME only — the backend sends no product identifier here —
// so it reads as the row's subject and is deliberately not a link or a routing target.

export function VocItemCard({
  item,
  accountId,
  onOutcomeRecorded,
  triageMode = "edit",
}: {
  item: OperatorVocItem;
  accountId: string;
  /** Bubbled to the list so the count and this row's badge reflect a reply the operator just posted. */
  onOutcomeRecorded?: () => void;
  /**
   * Whether this row offers to CHANGE the triage decision, or only shows it.
   *
   * "edit" (default) renders the interactive control — the arrival-signal drill-down, where the
   * decision is actually made. "readonly" renders a compact label instead, for the 내 답변 작업
   * worklist: there a full toggle group reads as a competing "take it off my list" control beside
   * 작업에서 제외, and moving a DRAFTED row to 지켜보기 silently fails to remove it. The reply flow
   * itself is unchanged in both modes — only the triage toggle is withheld.
   */
  triageMode?: "edit" | "readonly";
}) {
  const reply = replyStatusLabel(item.replyStatus);
  const preview = previewText(item.safePreview);
  const product = productLabel(item.productName);
  const category = categoryChip(item.category);
  const reported = reportedSubmissionLabel(item.hasReportedSubmission);

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
          {/* What the review is about, per the stored rule-based analysis. Context only — it
              does not decide whether the row is here. Absent when nothing analyzed the row:
              no chip at all, never a placeholder and never 기타 (see categoryChip). */}
          {/* SellerOps' own record, beside the channel's chip and never merged into it: one says
              what the marketplace reported at the last import, the other what the operator says they
              did since. This row is already excluded from the headline count and sorted to the
              bottom — the badge is what makes that visible instead of merely true. */}
          {reported != null ? (
            <span
              className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium ${reported.cls}`}
            >
              {reported.text}
            </span>
          ) : null}
          {category != null ? (
            <span
              className={`inline-flex items-center rounded-lg px-2 py-0.5 text-xs font-medium ${category.cls}`}
            >
              <span className="sr-only">분류: </span>
              {category.text}
            </span>
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
        triageMode === "readonly" ? (
          // The decision, shown but not editable here — see `triageMode`. A label, never a
          // disabled toggle: the operator is not being refused an action, the action simply
          // lives on the drill-down. The word is the live decision (`decided`), so a row that
          // arrived 대응 필요 says so.
          <div className="flex items-center gap-2">
            <span className="text-sm text-muted">처리 상태</span>
            <span
              className="rounded-lg bg-canvas px-2.5 py-1 text-sm font-semibold text-ink"
              data-testid="voc-triage-readonly"
            >
              {triageDispositionLabel(decided)}
            </span>
          </div>
        ) : (
          <VocItemTriageControl
            accountId={accountId}
            actionRef={item.actionRef}
            disposition={item.triageDisposition}
            onRecorded={setDecided}
          />
        )
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
          onOutcomeRecorded={onOutcomeRecorded}
          onLocalWork={noteLocalWork}
        />
      ) : null}
    </li>
  );
}
