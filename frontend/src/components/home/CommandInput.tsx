import { useEffect, useState } from "react";
import { Link, useNavigate } from "react-router-dom";
import { Btn } from "../ui/Btn";
import { IssueList } from "../memory/IssueList";
import { api } from "../../lib/apiClient";
import { agentHref } from "../../lib/agentContext";
import {
  COMMAND_INTENTS,
  INTENT_HEADING,
  matchCommandIntent,
  type CommandIntentKey,
} from "../../lib/commandIntents";
import { previewText } from "../../lib/plainText";
import type { InquiryQueueItem, ReviewIssueView } from "../../lib/types";

/**
 * <b>「무엇을 도와드릴까요?」 — and what comes back is an object, not a paragraph.</b>
 *
 * <p>Agent Command Center v1 §6/§7/§9. Three things this box is, stated plainly because each of them
 * is a fence:
 *
 * <ul>
 *   <li><b>It is a palette, not a planner.</b> A recognised sentence resolves to a workspace object
 *       that already exists — the inquiry queue, the repeated-issue list — and an unrecognised one is
 *       handed to the Agent, where the LLM planner plans it or the run fails, unchanged. See
 *       {@code lib/commandIntents.ts}.</li>
 *   <li><b>It never answers in prose.</b> 「미답변 문의 22건입니다」 as a sentence is a claim the
 *       seller cannot check; the same 22 rows they can click are the answer.</li>
 *   <li><b>It cannot send anything.</b> There is no write call in this module and no path from a
 *       typed sentence to one. 「답변 보내줘」 reaches the Agent, whose tool catalogue is 100% READ,
 *       and the marketplace write still happens only through the approval CTA on the inquiry screen.</li>
 * </ul>
 */
export function CommandInput({ unansweredCount }: { unansweredCount: number | null }) {
  const [text, setText] = useState("");
  const [intent, setIntent] = useState<CommandIntentKey | null>(null);
  const navigate = useNavigate();

  function submit(event: React.FormEvent) {
    event.preventDefault();
    const asked = text.trim();
    if (!asked) return;
    const matched = matchCommandIntent(asked);
    if (matched) {
      setIntent(matched);
      return;
    }
    // Not ours. The Agent owns free-form goals and always has — this box does not invent an answer
    // for a sentence it only half recognised, and it does not send the run either: the sentence
    // lands in the Agent's own box and the seller presses the button there.
    navigate(agentHref({ goal: asked, surface: "home" }));
  }

  return (
    <section className="space-y-3" aria-label="AI에게 묻기">
      <form onSubmit={submit} className="flex flex-wrap gap-2">
        <label htmlFor="home-command" className="sr-only">
          무엇을 도와드릴까요?
        </label>
        <input
          id="home-command"
          value={text}
          onChange={(e) => setText(e.target.value)}
          placeholder="무엇을 도와드릴까요?"
          className="min-h-[52px] min-w-0 flex-1 rounded-xl border border-line bg-surface px-4 text-base text-ink placeholder:text-muted focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
        />
        <Btn type="submit" variant="solid">
          물어보기
        </Btn>
      </form>

      {/* The supported set, visible. A box that silently understands three sentences and nothing else
          is a box the seller has to learn by failing at it. */}
      <div className="flex flex-wrap gap-2">
        {COMMAND_INTENTS.map((option) => (
          <button
            key={option.key}
            type="button"
            onClick={() => {
              setText(option.label);
              setIntent(option.key);
            }}
            className="min-h-[36px] rounded-full border border-line bg-surface px-3 py-1.5 text-sm font-semibold text-muted transition hover:border-brand/40 hover:text-ink focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
          >
            {option.label}
          </button>
        ))}
      </div>

      {intent ? <CommandResult intent={intent} unansweredCount={unansweredCount} /> : null}
    </section>
  );
}

function CommandResult({
  intent,
  unansweredCount,
}: {
  intent: CommandIntentKey;
  unansweredCount: number | null;
}) {
  return (
    <div className="rounded-2xl border border-line bg-surface p-5" data-testid="command-result">
      <h3 className="break-keep text-lg font-semibold text-ink">{INTENT_HEADING[intent]}</h3>
      {intent === "UNANSWERED_INQUIRIES" ? <UnansweredObject count={unansweredCount} /> : null}
      {intent === "REVIEW_ISSUES" ? <ReviewIssueObject /> : null}
      {intent === "TODAY" ? <TodayObject /> : null}
    </div>
  );
}

/**
 * The inquiry queue, as rows.
 *
 * <p>The COUNT is the home screen's own KPI, passed in rather than re-read: two reads of "how much
 * is waiting" is two chances for this box to contradict the number six inches above it. The ROWS are
 * the work queue, which is the list the 문의 screen works from.
 */
function UnansweredObject({ count }: { count: number | null }) {
  const [rows, setRows] = useState<InquiryQueueItem[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const page = await api.getInquiryQueueStrict({ phase: "OPEN", page: 0, size: 5 });
        if (live) setRows(page.content);
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return <p className="mt-2 text-base text-muted">문의를 읽지 못했습니다. 문의 화면에서 확인해 주세요.</p>;
  }
  return (
    <>
      {count != null ? (
        <p className="mt-1 text-base text-muted">
          지금 답변이 필요한 문의는 <span className="font-semibold text-ink">{count}건</span>입니다.
        </p>
      ) : null}
      <ul className="mt-3 divide-y divide-line/70">
        {(rows ?? []).map((item) => (
          <li key={item.workItemId}>
            <Link
              to={`/inquiries/${item.inquiryId}`}
              className="flex flex-wrap items-center gap-x-3 gap-y-1 py-3 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
            >
              <span className="min-w-0 flex-1 break-keep font-medium text-ink">
                {previewText(item.title) || "제목 없는 문의"}
              </span>
              <span className="whitespace-nowrap text-sm text-muted">
                {item.channelNameKo ?? "채널 미상"}
              </span>
            </Link>
          </li>
        ))}
      </ul>
      <Link
        to="/inquiries"
        className="mt-3 inline-block font-semibold text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
      >
        문의 화면에서 전체 보기
      </Link>
    </>
  );
}

/** The repeated-issue list, rendered by the component the 고객 기억 screen uses. Not a second copy. */
function ReviewIssueObject() {
  const [issues, setIssues] = useState<ReviewIssueView[] | null>(null);
  const [failed, setFailed] = useState(false);

  useEffect(() => {
    let live = true;
    void (async () => {
      try {
        const found = await api.getReviewIssuesStrict();
        if (live) setIssues(found.slice(0, 5));
      } catch {
        if (live) setFailed(true);
      }
    })();
    return () => {
      live = false;
    };
  }, []);

  if (failed) {
    return <p className="mt-2 text-base text-muted">리뷰 문제를 읽지 못했습니다. 리뷰 화면에서 확인해 주세요.</p>;
  }
  if (issues && issues.length === 0) {
    return <p className="mt-2 text-base text-muted">반복해서 나타나는 문제는 아직 없습니다.</p>;
  }
  return (
    <div className="mt-3 overflow-hidden rounded-xl border border-line">
      <IssueList issues={issues ?? []} selectedId={null} />
    </div>
  );
}

/**
 * The briefing is the object, and it is already on this screen.
 *
 * <p>Rendering it a second time would be the duplication this package is removing, so the palette
 * does what a palette does: it takes the seller to the object.
 */
function TodayObject() {
  return (
    <>
      <p className="mt-1 break-keep text-base text-muted">
        오늘 확인할 일은 이 화면 맨 위에 정리해 두었습니다.
      </p>
      <button
        type="button"
        onClick={() => window.scrollTo({ top: 0, behavior: "smooth" })}
        className="mt-3 font-semibold text-brand-700 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand-700"
      >
        브리핑으로 이동
      </button>
    </>
  );
}
