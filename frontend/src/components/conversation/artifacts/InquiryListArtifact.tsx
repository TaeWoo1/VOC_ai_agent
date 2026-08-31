import { useEffect, useState } from "react";
import { Link } from "react-router-dom";
import type { InquiryGroupKey, InquiryItem, InquiryListArtifact as InquiryList } from "../../../lib/conversation/types";
import { Status, type StatusTone } from "../../ui/Status";
import { Btn, BtnLink } from "../../ui/Btn";
import { NavIcon } from "../../icons/NavIcon";
import { api } from "../../../lib/apiClient";
import { useConversation } from "../../../lib/conversation/ConversationProvider";
import { previewText } from "../../../lib/plainText";
import { relativeTime } from "../../../lib/format";
import { ArtifactCard } from "./ArtifactCard";
import { useContinueInPanel } from "../useContinueInPanel";

/** The first word of every row is its work state — the same words the 문의 screen uses. */
const STATE: Record<InquiryGroupKey, { word: string; tone: StatusTone }> = {
  DRAFT_READY: { word: "초안 준비됨", tone: "info" },
  NEEDS_CLARIFICATION: { word: "되묻는 초안", tone: "warn" },
  KNOWLEDGE_MISSING: { word: "답변 기준 필요", tone: "warn" },
  UNANSWERED: { word: "답변 필요", tone: "warn" },
  ANSWERED: { word: "답변함", tone: "good" },
};

const PREPARE_PROMPT = "답변 준비해줘";

/**
 * The inquiry rows as structured objects (Agent Interaction Model v2 §7): title first (the sentence
 * the seller recognises the work by), state at the right, one quiet meta line — not a pile of links.
 *
 * CLICK == FOCUS (§3): pressing a row selects it in the conversation (`selectEntity`, the same state
 * transition as saying its name) and expands its compact detail in place; the workspace is a
 * secondary icon action, not the row's default. Outside the provider (a bare render) the row falls
 * back to a plain link so nothing dead-ends.
 */
export function InquiryListArtifact({ artifact, onPrompt }: { artifact: InquiryList; onPrompt?: (prompt: string) => void }) {
  const conversation = useConversation();
  const onOpen = useContinueInPanel("INQUIRY_LIST");
  const selectedId = conversation?.workingSet?.selectedInquiry?.inquiryId ?? null;
  const [expanded, setExpanded] = useState<string | null>(null);
  const groups = artifact.groups.filter((g) => g.items.length > 0);
  return (
    <ArtifactCard title={artifact.title} note={artifact.note}>
      {groups.length === 0 ? <p className="px-4 pb-2 text-sm text-muted">보여드릴 문의가 없습니다.</p> : null}
      {groups.map((group) => (
        <section key={group.key} aria-label={group.label}>
          {groups.length > 1 ? (
            <p className="border-y border-line/70 bg-canvas px-4 py-1.5 text-xs font-semibold text-muted">
              {group.label} <span className="tabular-nums">{group.items.length}</span>
            </p>
          ) : null}
          <ul className="divide-y divide-line/70">
            {group.items.map((item) => (
              <Row
                key={item.inquiryId}
                item={item}
                state={STATE[group.key]}
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
      ))}
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
  state: { word: string; tone: StatusTone };
  selected: boolean;
  expanded: boolean;
  /** null = no conversation around (bare render): the row is a plain link to its workspace. */
  onSelect: (() => void) | null;
  onOpen: () => void;
  onPrompt?: (prompt: string) => void;
}) {
  const title = previewText(item.title) || "제목 없는 문의";
  const meta = [item.productName, item.channelNameKo].filter(Boolean).join(" · ");
  const body = (
    <>
      <div className="flex items-start gap-2">
        <p className="min-w-0 flex-1 break-keep text-base font-semibold leading-snug text-ink line-clamp-2">{title}</p>
        <Status tone={state.tone} variant="word">{state.word}</Status>
      </div>
      <p className="mt-0.5 flex flex-wrap items-center gap-x-2 text-sm text-muted">
        {meta ? <span className="break-keep">{meta}</span> : null}
        <span className="tabular-nums">{relativeTime(item.receivedAt)}</span>
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
  return (
    <li className={selected ? "bg-brand-50/60" : ""}>
      <div className="flex items-start gap-1 px-4 py-2.5">
        <button
          type="button"
          onClick={onSelect}
          aria-expanded={expanded}
          aria-current={selected ? "true" : undefined}
          className="min-w-0 flex-1 text-left transition focus:outline-none focus-visible:ring-2 focus-visible:ring-inset focus-visible:ring-brand-700"
          data-testid="inquiry-row-select"
        >
          {body}
        </button>
        <Link
          to={item.to}
          onClick={onOpen}
          aria-label="문의 화면에서 열기"
          title="문의 화면에서 열기"
          className="mt-0.5 inline-flex h-7 w-7 shrink-0 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        >
          <NavIcon name="open" className="h-4 w-4" />
        </Link>
      </div>
      {expanded ? <RowDetail item={item} onOpen={onOpen} onPrompt={onPrompt} /> : null}
    </li>
  );
}

/** The compact in-place detail of a clicked row — READ only, the same read the inquiry screen makes. */
function RowDetail({ item, onOpen, onPrompt }: { item: InquiryItem; onOpen: () => void; onPrompt?: (prompt: string) => void }) {
  const [detail, setDetail] = useState<{ state: "loading" | "loaded" | "failed"; body: string | null }>({ state: "loading", body: null });
  useEffect(() => {
    if (!item.workItemId) {
      setDetail({ state: "loaded", body: null });
      return;
    }
    let live = true;
    api.getInquiryDetailStrict(item.workItemId)
      .then((d) => {
        if (live) setDetail({ state: "loaded", body: d.details ?? null });
      })
      .catch(() => {
        if (live) setDetail({ state: "failed", body: null });
      });
    return () => {
      live = false;
    };
  }, [item.workItemId]);
  const draftable = item.workItemId != null && item.status.toUpperCase() !== "ANSWERED";
  return (
    <div className="space-y-2 border-t border-line/60 bg-canvas/60 px-4 py-2.5" data-testid="inquiry-row-detail">
      {detail.state === "loading" ? (
        <p className="text-sm text-muted">문의 내용을 불러오는 중입니다.</p>
      ) : detail.body ? (
        <p className="whitespace-pre-wrap break-keep text-base leading-relaxed text-ink">{previewText(detail.body)}</p>
      ) : detail.state === "failed" ? (
        <p className="text-sm text-muted">문의 내용을 불러오지 못했습니다. 문의 화면에서 확인해 주세요.</p>
      ) : null}
      <div className="flex flex-wrap items-center gap-2">
        {draftable && onPrompt ? <Btn size="sm" onClick={() => onPrompt(PREPARE_PROMPT)}>답변 준비</Btn> : null}
        <BtnLink to={item.to} variant="outline" size="sm" onClick={onOpen}>문의 화면에서 열기</BtnLink>
      </div>
    </div>
  );
}
