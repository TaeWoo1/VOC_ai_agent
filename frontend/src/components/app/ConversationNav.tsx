import { useEffect, useState } from "react";
import { useLocation, useNavigate } from "react-router-dom";
import { useConversation } from "../../lib/conversation/ConversationProvider";
import { NavIcon } from "../icons/NavIcon";
import { relativeTime } from "../../lib/format";
import type { ConversationSummary } from "../../lib/conversation/types";

const ITEM =
  "flex min-h-[34px] w-full items-center gap-2 rounded-lg px-2.5 text-left text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

/**
 * The thread list, in the sidebar (Chat UI v1): 「새 대화」 as an icon control beside the heading, then the
 * recent conversations with the CURRENT one marked. Collapsible (folded by default under 1366px so a narrow
 * shell keeps its primary navigation readable). Reads the list from the runtime through the provider and
 * re-reads when a turn lands or a thread is opened (`historyVersion`) — never on a timer.
 */
export function ConversationNav() {
  const conversation = useConversation();
  const navigate = useNavigate();
  const location = useLocation();
  const [open, setOpen] = useState<boolean>(() =>
    typeof window === "undefined" || typeof window.matchMedia !== "function" ? true : window.matchMedia("(min-width: 1366px)").matches,
  );
  const [items, setItems] = useState<ConversationSummary[] | null>(null);
  const version = conversation?.historyVersion ?? 0;
  const currentId = conversation?.conversationId ?? null;

  useEffect(() => {
    if (!conversation || !open) return;
    let live = true;
    conversation
      .loadHistory(12)
      .then((rows) => {
        if (live) setItems(rows);
      })
      .catch(() => {
        if (live) setItems([]);
      });
    return () => {
      live = false;
    };
  }, [open, version, currentId]);

  if (!conversation) return null;
  const goHome = () => {
    if (location.pathname !== "/") navigate("/");
  };

  return (
    <section className="mb-5" aria-label="대화">
      <div className="flex items-center justify-between px-2.5 pb-1">
        <button
          type="button"
          onClick={() => setOpen((v) => !v)}
          aria-expanded={open}
          className="flex min-h-[28px] items-center gap-1 rounded-md text-xs font-semibold text-muted hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        >
          <NavIcon name="chevronDown" className={`h-3.5 w-3.5 transition ${open ? "" : "-rotate-90"}`} />
          대화
        </button>
        <button
          type="button"
          onClick={() => {
            conversation.newConversation();
            goHome();
          }}
          aria-label="새 대화"
          title="새 대화"
          className="inline-flex h-7 w-7 items-center justify-center rounded-md text-muted transition hover:bg-canvas hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        >
          <NavIcon name="compose" className="h-4 w-4" />
        </button>
      </div>
      {open ? (
        items === null ? (
          <p className="px-2.5 py-1 text-sm text-muted">불러오는 중…</p>
        ) : items.length === 0 ? (
          <p className="px-2.5 py-1 text-sm text-muted">지난 대화가 없습니다.</p>
        ) : (
          <ul className="space-y-0.5" aria-label="지난 대화">
            {items.map((h) => {
              const current = h.conversationId === currentId;
              return (
                <li key={h.conversationId}>
                  <button
                    type="button"
                    aria-current={current ? "true" : undefined}
                    onClick={() => {
                      void conversation.openConversation(h.conversationId);
                      goHome();
                    }}
                    className={`${ITEM} ${current ? "bg-canvas font-semibold text-brand-700" : "text-muted hover:bg-canvas hover:text-ink"}`}
                  >
                    <span className="min-w-0 flex-1 truncate">{h.headline ?? "제목 없는 대화"}</span>
                    <span className="shrink-0 text-xs tabular-nums text-muted">{relativeTime(h.updatedAt)}</span>
                  </button>
                </li>
              );
            })}
          </ul>
        )
      ) : null}
    </section>
  );
}
