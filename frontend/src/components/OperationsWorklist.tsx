import { useState } from "react";
import { Link } from "react-router-dom";
import { AttentionSignalList } from "./AttentionSignalList";
import { MyReplyWork } from "./MyReplyWork";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import { resolveWorklistAccounts, type WorklistAccount } from "../lib/worklistAccounts";

// The operations home's worklist: what needs a look, on the page the seller actually works from.
//
// This component resolves WHICH account's worklist to show and nothing else — the worklist itself is
// <AttentionSignalList>, unchanged and shared. It is channel-generic and already renders inquiry
// signals beside review ones, so nothing here is review-specific and an inquiry worklist needs no
// new surface.
//
// Fail-closed, like <ImportHistoryList> beside it: a dead read must never render as "nothing needs
// your attention". That failure mode is the whole reason this product's reads are strict.
//
// `refreshKey` exists because the completion copy now says the reviews appear "아래". A worklist
// fetched before the import landed would make that sentence false: the seller finishes an export,
// reads that their reviews are below, and sees the pre-import list. The page bumps this when a run
// reaches its terminal, so the promise the copy makes is one the list actually keeps. It is NOT
// threaded into the account read — connecting a channel is not something an import does.

export function OperationsWorklist({ refreshKey = 0 }: { refreshKey?: number }) {
  const { data, loading, error } = useApiData(() => api.getSellerAccountsStrict(), []);
  // Which account the seller CHOSE. Never seeded from the data — see the chooser note below.
  const [chosenId, setChosenId] = useState<string | null>(null);

  if (loading) {
    return (
      <Shell>
        <p className="text-base text-muted">불러오는 중…</p>
      </Shell>
    );
  }
  if (error || !data) {
    return (
      <Shell>
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          확인할 일을 불러오지 못했어요. 잠시 후 다시 시도해 주세요.
        </p>
      </Shell>
    );
  }

  const resolution = resolveWorklistAccounts(data);

  if (resolution.kind === "none") {
    return (
      <Shell>
        <p className="text-base text-muted">
          아직 연결된 판매 채널이 없어요. 채널을 연결하면 확인할 일이 여기에 표시돼요.
        </p>
        <Link to="/settings/channels" className="btn-ghost mt-3 inline-block">
          채널 연결하러 가기 →
        </Link>
      </Shell>
    );
  }

  if (resolution.kind === "single") {
    // Named, not merely rendered. One account is not an inference — there is nothing to choose
    // between — but the rows still have to say whose they are, or a seller who later connects a
    // second channel silently reinterprets everything they remember from this page.
    return <NamedWorklist account={resolution.account} refreshKey={refreshKey} />;
  }

  const chosen = resolution.accounts.find((a) => a.id === chosenId) ?? null;
  return (
    <>
      <Shell>
        {/* NOTHING is preselected, and that is load-bearing rather than fussy. `reviews` carries no
            seller_account_id, so the backend refuses to attribute them per-account when an org holds
            several on one channel — it returns an empty snapshot instead. Auto-picking here would
            render one account's view as the seller's whole worklist: the exact inference the server
            declines to make, on the page they trust most. */}
        <p className="text-base text-muted">
          확인할 채널을 선택해 주세요.
        </p>
        <div className="mt-3 flex flex-wrap gap-2" role="group" aria-label="채널 선택">
          {resolution.accounts.map((account) => (
            <button
              key={account.id}
              type="button"
              onClick={() => setChosenId(account.id)}
              aria-pressed={chosen?.id === account.id}
              className={`rounded-xl px-3 py-1.5 text-sm font-semibold ${
                chosen?.id === account.id
                  ? "bg-brand text-white"
                  : "bg-canvas text-muted hover:text-ink"
              }`}
            >
              {account.label}
            </button>
          ))}
        </div>
      </Shell>
      {chosen ? <NamedWorklist account={chosen} refreshKey={refreshKey} /> : null}
    </>
  );
}

const SECTION_TITLE = "오늘 확인할 일";

/**
 * The named region wrapper for the states that render before a worklist exists.
 *
 * Named via `aria-label` rather than the shared <Section>, which renders a bare <section> carrying
 * no accessible name and therefore no `region` role — matching <ImportHistoryList> so the operations
 * home can address both rails by role instead of by text. Once an account is resolved the worklist
 * itself supplies the heading, so this shell does not wrap it and the title is never doubled.
 */
function Shell({ children }: { children: React.ReactNode }) {
  return (
    <section aria-label={SECTION_TITLE} className="rounded-2xl bg-surface p-5 shadow-card">
      <h2 className="mb-1 text-lg font-semibold text-ink">{SECTION_TITLE}</h2>
      {children}
    </section>
  );
}

/**
 * The worklist for one named account.
 *
 * <p>The name sits above it rather than inside {@code AttentionSignalList}, so that component stays
 * exactly as the channel page used it — one worklist implementation, not two that can drift in
 * window semantics or copy.
 */
function NamedWorklist({
  account,
  refreshKey,
}: {
  account: WorklistAccount;
  refreshKey: number;
}) {
  return (
    <div className="flex flex-col gap-2">
      <p className="text-sm text-muted">
        <span className="sr-only">채널: </span>
        {account.label}
      </p>
      <AttentionSignalList accountId={account.id} refreshKey={refreshKey} />
      {/* The operator's OWN committed work, directly reachable and not window-scoped — so a draft
          they started survives a reload instead of living only inside a signal drill-down. */}
      <MyReplyWork accountId={account.id} />
    </div>
  );
}
