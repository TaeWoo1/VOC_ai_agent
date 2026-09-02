import { useEffect, useState } from "react";
import { MoreRows, useHeadRows } from "./headRows";
import { Link } from "react-router-dom";
import type { InquiryGroupKey, InquiryItem, InquiryListArtifact as InquiryList } from "../../../lib/conversation/types";
import { Status, type StatusTone } from "../../ui/Status";
import { Btn } from "../../ui/Btn";
import { api } from "../../../lib/apiClient";
import { onlySharedWord } from "../../../lib/conversation/sharedWord";
import { useConversation } from "../../../lib/conversation/ConversationProvider";
import { previewText } from "../../../lib/plainText";
import { recallSnippet, rememberSnippet } from "../../../lib/conversation/snippetCache";
import { relativeTime } from "../../../lib/format";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

/**
 * The first word of every row is its work state — the same words the 문의 screen uses.
 *
 * `all` is what that state is called when EVERY row has it: the word stops being a mark on each row and
 * becomes one sentence about the list (`sharedWord.ts`).
 */
const STATE: Record<InquiryGroupKey, { word: string; tone: StatusTone; all: string }> = {
  DRAFT_READY: { word: "초안 준비됨", tone: "info", all: "모두 초안이 준비돼 있습니다." },
  NEEDS_CLARIFICATION: { word: "되묻는 초안", tone: "warn", all: "모두 고객에게 되묻는 초안입니다." },
  KNOWLEDGE_MISSING: { word: "답변 기준 필요", tone: "warn", all: "모두 답변 기준이 필요합니다." },
  UNANSWERED: { word: "답변 필요", tone: "warn", all: "모두 답변이 필요한 문의입니다." },
  ANSWERED: { word: "답변함", tone: "good", all: "모두 답변한 문의입니다." },
};

/** Which group a `scope.status` produces — so a list the seller ASKED for by state says nothing extra. */
const ASKED_FOR: Record<string, InquiryGroupKey> = { UNANSWERED: "UNANSWERED", ANSWERED: "ANSWERED" };

const PREPARE_PROMPT = "답변 준비해줘";

/**
 * The inquiry rows as structured objects (Agent Interaction Model v2 §7): title first (the sentence
 * the seller recognises the work by), state at the right, one quiet meta line — not a pile of links.
 *
 * CLICK == FOCUS (§3): pressing a row selects it in the conversation (`selectEntity`, the same state
 * transition as saying its name) and expands its compact detail in place. Outside the provider (a bare
 * render) the row falls back to a plain link so nothing dead-ends.
 *
 * <b>ONE control per row</b> (Frontend-first Agent Workspace Redesign v1). The row used to carry a
 * workspace icon beside it, its expansion a 「문의 화면에서 열기」 button, and the card a footer link —
 * three ways to the same screen, in three visual weights. The row is the control; the workspace is a
 * text link inside the row it belongs to.
 */
export function InquiryListArtifact({ artifact, onPrompt, headline }: { artifact: InquiryList; onPrompt?: (prompt: string) => void; headline?: string }) {
  const conversation = useConversation();
  const onOpen = useContinueInPanel("INQUIRY_LIST");
  const selectedId = conversation?.workingSet?.selectedInquiry?.inquiryId ?? null;
  const groups = artifact.groups.filter((g) => g.items.length > 0);
  // A RANKED list has already made a judgement — 「먼저 보실 것은 …」 — so its top row opens with the
  // list (Agentic Experience v2 §3). A ranking whose answer is still a row the seller has to click is
  // a list wearing a judgement's sentence: the point of asking 「제일 급한 게 뭐야」 is to see THAT one,
  // read it, and act. The same bounded detail READ a click makes, and only for the first row.
  const ranked = artifact.scope?.rank === "URGENCY";
  const [expanded, setExpanded] = useState<string | null>(
    () => (ranked ? groups[0]?.items[0]?.inquiryId ?? null : null),
  );
  // A list with no rows draws NOTHING (Conversation UX v2 §D): 「…는 없습니다」 is already the turn's own
  // sentence, and a box under it saying 「보여드릴 문의가 없습니다」 is that answer a second time.
  if (groups.length === 0) return null;
  // A ROWS list keeps the ORDER the seller asked for, so its groups are consecutive runs of one state
  // — and a mixed set comes back as 답변 필요 1 · 답변함 1 · 답변 필요 1, three headers that name the
  // same two things and count to one each. Every row already carries its state as its first word, so
  // when a label repeats the headers say nothing the rows do not (Working Context v1 §5). Headers stay
  // for a genuinely grouped list, where each label appears once and the count is the group's size.
  const labelled = new Set(groups.map((g) => g.label)).size === groups.length;
  const showHeaders = groups.length > 1 && labelled;
  // The state word, when every row has the same one: off the rows, and into one caption — unless the
  // seller ASKED for that state (the sentence above already says it) or the sentence already carries it.
  const shared = onlySharedWord(groups.flatMap((g) => g.items.map(() => STATE[g.key].word)));
  const headKey = groups[0]!.key;
  const askedFor = artifact.scope?.status ? ASKED_FOR[artifact.scope.status] === headKey : false;
  const caption = shared && !askedFor && !(headline ?? "").includes(shared) ? STATE[headKey].all : null;
  const note = [artifact.note, caption].filter(Boolean).join(" ") || null;
  // The head is spent across the groups IN ORDER, so a capped list still reads as the list the seller
  // asked for rather than the first group of it.
  const total = groups.reduce((n, g) => n + g.items.length, 0);
  const head = useHeadRows(total);
  let budget = head.shown;
  return (
    <ArtifactCard title={artifact.title} note={note} headline={headline} titleSaid={artifact.titleSaid}>
      {/* Keyed by POSITION as well as kind: a ROWS list keeps the seller's order, so its groups are
          consecutive runs and the same `key` ("UNANSWERED") legitimately appears more than once. React
          was told two siblings were the same node and warned it might drop or duplicate rows — a list
          of the seller's work is the last place to let that happen. */}
      {groups.map((group, runIndex) => {
        const take = Math.max(0, Math.min(budget, group.items.length));
        budget -= take;
        if (take === 0) return null;
        return (
        <section key={`${group.key}-${runIndex}`} aria-label={group.label}>
          {showHeaders ? (
            <p className="border-y border-line/70 bg-canvas px-4 py-1.5 text-xs font-semibold text-muted">
              {group.label} <span className="tabular-nums">{group.items.length}</span>
            </p>
          ) : null}
          <ul className="divide-y divide-line/70">
            {group.items.slice(0, take).map((item) => (
              <Row
                key={item.inquiryId}
                item={item}
                state={shared ? null : STATE[group.key]}
                selected={selectedId === item.inquiryId}
                expanded={expanded === item.inquiryId}
                onSelect={
                  conversation
                    ? () => {
                        setExpanded((prev) => (prev === item.inquiryId ? null : item.inquiryId));
                        void conversation.selectEntity({ inquiryId: item.inquiryId, workItemId: item.workItemId });
                      }
                    : null
                }
                onOpen={onOpen}
                onPrompt={onPrompt}
              />
            ))}
          </ul>
        </section>
        );
      })}
      <MoreRows hidden={head.hidden} noun="문의" onExpand={head.expand} />
      {artifact.more ? (
        <p className="px-4 py-2">
          <Link to={artifact.more.to} onClick={onOpen} className="text-sm font-semibold text-brand-700 hover:underline">{artifact.more.label}</Link>
        </p>
      ) : null}
    </ArtifactCard>
  );
}

function Row({ item, state, selected, expanded, onSelect, onOpen, onPrompt }: {
  item: InquiryItem;
  /** null = every row in this list has the same state, and the list says it once instead. */
  state: { word: string; tone: StatusTone } | null;
  selected: boolean;
  expanded: boolean;
  /** null = no conversation around (bare render): the row is a plain link to its workspace. */
  onSelect: (() => void) | null;
  onOpen: () => void;
  onPrompt?: (prompt: string) => void;
}) {
  const title = previewText(item.title) || "제목 없는 문의";
  // The snippet is transient by contract, so a refine of the rows on screen is composed from the
  // PERSISTED rows and arrives without one. What this page already drew for that inquiry stands in —
  // page memory only, never storage (`snippetCache.ts`).
  rememberSnippet(item.inquiryId, item.snippet);
  const preview = previewText(item.snippet ?? recallSnippet(item.inquiryId));
  const meta = [item.productName, item.channelNameKo].filter(Boolean).join(" · ");
  const body = (
    <>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-keep text-base font-semibold leading-snug text-ink line-clamp-2">{title}</p>
        {state ? <Status tone={state.tone} variant="word">{state.word}</Status> : null}
      </div>
      {/* The customer's own sentence, one line, without a click — a row the seller can read is the
          difference between a list of objects and a table of ids. Absent on a reloaded thread.
          Hidden while the row is OPEN: the full message is right below it, and a one-line copy of its
          own first line above it is that sentence twice (Working Context v1 §5). */}
      {preview && preview !== title && !expanded ? (
        <p className="mt-0.5 break-keep text-sm leading-snug text-muted line-clamp-1" data-testid="inquiry-row-preview">{preview}</p>
      ) : null}
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
        {meta ? <span className="break-keep">{meta}</span> : null}
        {/* PRIORITIZE: why this row is where it is. It REPLACES the receipt date rather than standing
            beside it — 「1개월 전」 and 「40일째 대기」 are one fact in two renderings, and the one that
            explains the order is the one worth the space. */}
        {item.waitingDays != null ? (
          <span className="font-semibold text-warn" data-testid="inquiry-row-waiting">
            {item.waitingDays === 0 ? "오늘 접수" : `${item.waitingDays}일째 대기`}
          </span>
        ) : (
          <span className="tabular-nums">{relativeTime(item.receivedAt)}</span>
        )}
      </p>
    </>
  );
  if (!onSelect) {
    return (
      <li>
        <Link to={item.to} onClick={onOpen} className="block px-4 py-2.5 transition hover:bg-canvas focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700">
          {body}
        </Link>
      </li>
    );
  }
  // ONE control per row (design contract §7): the row IS the control. The workspace icon that used to
  // sit beside it was the third way to reach the same screen — the row's own 「문의 화면에서 열기」 and
  // the card's footer link being the other two — and three copies of one action make the seller choose
  // which one is real.
  return (
    <li className={selected ? "bg-brand-50/60" : ""}>
      <button
        type="button"
        onClick={onSelect}
        aria-expanded={expanded}
        aria-current={selected ? "true" : undefined}
        className="block w-full px-4 py-2.5 text-left transition hover:bg-canvas/70 focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
        data-testid="inquiry-row-select"
      >
        {body}
      </button>
      {expanded ? <RowDetail item={item} onOpen={onOpen} onPrompt={onPrompt} /> : null}
    </li>
  );
}

/** The compact in-place detail of a clicked row — READ only, the same read the inquiry screen makes. */
function RowDetail({ item, onOpen, onPrompt }: { item: InquiryItem; onOpen: () => void; onPrompt?: (prompt: string) => void }) {
  // The row's own snippet is what the customer wrote, and it is already here: an answered inquiry has
  // no work item to read, so before this the expanded row showed a title and nothing (PO QA:
  // 「문의 row를 선택해도 본문이 바로 보이지 않음」). The fuller detail replaces it when it can be read.
  const initial = item.snippet ?? recallSnippet(item.inquiryId);
  const [detail, setDetail] = useState<{ state: "loading" | "loaded" | "failed"; body: string | null }>(
    item.workItemId ? { state: "loading", body: initial } : { state: "loaded", body: initial },
  );
  useEffect(() => {
    if (!item.workItemId) return;
    let live = true;
    api.getInquiryDetailStrict(item.workItemId)
      .then((d) => {
        if (live) setDetail({ state: "loaded", body: d.details ?? initial });
      })
      .catch(() => {
        if (live) setDetail({ state: initial ? "loaded" : "failed", body: initial });
      });
    return () => {
      live = false;
    };
  }, [item.workItemId]);
  const draftable = item.workItemId != null && item.status.toUpperCase() !== "ANSWERED";
  return (
    <div className="space-y-2 border-t border-line/60 bg-canvas/60 px-4 py-2.5" data-testid="inquiry-row-detail">
      {detail.state === "loading" && !detail.body ? (
        <p className="text-sm text-muted">문의 내용을 불러오는 중입니다.</p>
      ) : detail.body ? (
        // The customer's own words, at the size the design contract gives them (§1 `lg`) — the largest
        // text in the turn, because it is the thing the seller opened the row to read.
        <p className="whitespace-pre-wrap break-keep text-lg font-medium leading-relaxed text-ink" data-testid="inquiry-row-body">{previewText(detail.body)}</p>
      ) : detail.state === "failed" ? (
        <p className="text-sm text-muted">문의 내용을 불러오지 못했습니다. 문의 화면에서 확인해 주세요.</p>
      ) : null}
      {/* One primary per row. The workspace is a text link, not a second button: the card's own footer
          already offers the LIST's screen with an almost identical label, and two buttons of equal
          weight three centimetres apart make the seller decide which one is the real one. */}
      <div className="flex flex-wrap items-center gap-3">
        {draftable && onPrompt ? <Btn size="sm" onClick={() => onPrompt(PREPARE_PROMPT)}>답변 준비</Btn> : null}
        <Link to={item.to} onClick={onOpen} className="text-sm text-muted hover:text-ink hover:underline">문의 화면에서 열기</Link>
      </div>
    </div>
  );
}
