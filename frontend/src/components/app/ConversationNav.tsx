import { useEffect, useState } from "react";
import { AnimatePresence, motion } from "motion/react";
import { COLLAPSE } from "../../lib/motion";
import { useLocation, useNavigate } from "react-router-dom";
import { useConversation } from "../../lib/conversation/ConversationProvider";
import { NavIcon } from "../icons/NavIcon";
import type { ConversationSummary } from "../../lib/conversation/types";
import { relativeTime } from "../../lib/format";

// Reviewnary Visual System v1 §6 — the thread list is history, not navigation. It sits at `xs` in
// `muted`, and the current thread is marked by an accent RULE rather than a filled blue row: a
// filled row is the strongest thing the rail can draw, and it was being spent on "you are already
// here". 32px rows keep twelve of them from out-weighing the five destinations below.
const ITEM =
  "flex min-h-[32px] w-full items-center gap-2 rounded-md border-l-2 px-2 text-left text-xs transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700 focus-visible:ring-offset-2";

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
      .loadHistory(8)
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
          <NavIcon name="chevronDown" className={`h-3.5 w-3.5 transition-transform duration-150 ${open ? "" : "-rotate-90"}`} />
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
      <AnimatePresence initial={false}>
        {open ? (
          <motion.div key="threads" variants={COLLAPSE} initial="hidden" animate="shown" exit="gone" className="overflow-hidden">
            {items === null ? (
              <p className="px-2.5 py-1 text-sm text-muted">불러오는 중…</p>
            ) : items.length === 0 ? (
              <p className="px-2.5 py-1 text-sm text-muted">지난 대화가 없습니다.</p>
            ) : (
              <ul className="space-y-0.5" aria-label="지난 대화">
                {items.map((h) => {
                  const current = h.conversationId === currentId;
                  // **The disambiguator appears exactly where the ambiguity is.** A seller who asks
                  // 「네이버 리뷰 최신화해줘」 on three days gets three rows reading the same words, and the
                  // list becomes unnavigable. A time column on EVERY row was removed for a good reason —
                  // it restated the order the list is already in — so it comes back only on the rows that
                  // cannot otherwise be told apart.
                  const ambiguous = items.filter((o) => (o.headline ?? "") === (h.headline ?? "")).length > 1;
                  return (
                    <li key={h.conversationId}>
                      <button
                        type="button"
                        aria-current={current ? "true" : undefined}
                        onClick={() => {
                          void conversation.openConversation(h.conversationId);
                          goHome();
                        }}
                        className={`${ITEM} ${current ? "border-brand-700 font-semibold text-ink" : "border-transparent text-muted hover:border-line hover:text-ink"}`}
                      >
                        {/* The thread's own first sentence, and nothing else. A time column beside every
                            row made twelve near-identical truncated sentences into a table, and the
                            list is ordered by recency already — the column restated the order it was
                            in (Frontend-first Agent Workspace Redesign v1). */}
                        <span className="min-w-0 flex-1 truncate">{h.headline ?? "제목 없는 대화"}</span>
                        {ambiguous ? (
                          <span className="shrink-0 text-xs font-normal text-muted">{relativeTime(h.updatedAt)}</span>
                        ) : null}
                      </button>
                    </li>
                  );
                })}
              </ul>
            )}
          </motion.div>
        ) : null}
      </AnimatePresence>
    </section>
  );
}
