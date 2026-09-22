import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { AgentLaunch } from "../../components/ui/AgentLaunch";
import { useAgentSurface } from "../../lib/agentPanel";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { IssueList } from "../../components/memory/IssueList";
import { IssueDetailPanel } from "../../components/memory/IssueDetailPanel";
import { api } from "../../lib/apiClient";
import { groupIssues, resolveIssueSelection } from "../../lib/memoryView";
import { MasterDetail, useWideLayout } from "../../components/workspace/MasterDetail";
import type { ReviewIssueView } from "../../lib/types";

/**
 * 반복 문제 (was 고객운영 메모리) — what keeps coming back, and the evidence for it. One name since UI/UX v2: the
 * Home's section, the nav entry and this page's title all say 반복 문제.
 *
 * SCOPE FENCE (v1): recurring issues, their evidence, their trend, and per-product signals. There
 * is NO search input, by decision — search over past inquiries, reviews and replies is
 * retrieval-backed work outside v1 and gated on a separate scope decision. Rendering a search box
 * before that capability exists would promise it. `memoryScope.test.tsx` holds this fence.
 *
 * The inbox is no longer read here. It used to be loaded for exactly one purpose — deciding whether
 * an evidence quote was allowed to link anywhere — because the only destination was an inbox page
 * that had to already hold the row. The evidence quote now links to the review's own processing
 * surface, which resolves itself from the review id, so whether a seller can reach the review behind
 * a quote no longer depends on what another screen happened to have fetched.
 */
export function CustomerMemory() {
  const { issueId } = useParams();
  const [issues, setIssues] = useState<ReviewIssueView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);

  // The same conversation every other screen opens — the panel, not a second chat (Reports v1 §3).
  // ONLY THE SCREEN TRAVELS. The label deliberately does not name the opened issue: `AgentContext`
  // has no issue field, so a header saying 「접착 부족」 would promise a scope nothing carries, and
  // the follow-up would be answered by whatever problem the sentence itself names.
  useAgentSurface({ surface: "memory", label: "반복 문제" });

  const load = useCallback(async () => {
    setLoading(true);
    setFailed(false);
    try {
      setIssues(await api.getReviewIssuesStrict());
    } catch {
      setIssues(null);
      setFailed(true);
    } finally {
      setLoading(false);
    }
  }, []);

  useEffect(() => {
    void load();
  }, [load]);

  const all = issues ?? [];
  const wide = useWideLayout();

  const onIssueChanged = useCallback((next: ReviewIssueView) => {
    setIssues((current) =>
      current ? current.map((issue) => (issue.id === next.id ? next : issue)) : current,
    );
  }, []);

  const visible = useMemo(() => all.filter((issue) => !issue.dismissed), [all]);
  // Master-detail (UI/UX v2 Phase 1): on a wide screen the first problem is open when none is chosen. The old
  // first screen was two thirds 「왼쪽에서 이슈를 고르면…」 — an empty panel asking for a click before it said
  // anything. The list order is the server's (worst first), so 「first」 is not a new ranking.
  // The default is pinned once chosen: acting on a problem can move it to another group, and a default recomputed
  // from the new order would swap the pane to a different problem under the seller's cursor.
  const [pinned, setPinned] = useState<string | null>(null);
  const firstId = groupIssues(visible)[0]?.issues[0]?.id ?? null;
  useEffect(() => {
    if (wide && !issueId && pinned === null && firstId) setPinned(firstId);
  }, [wide, issueId, pinned, firstId]);
  const selection = resolveIssueSelection(all, issueId ?? (wide ? pinned ?? firstId ?? undefined : undefined));
  const found = selection.kind === "FOUND" ? selection.issue : null;

  const head = (
    <PageHead
      title="반복 문제"
      description="고객이 반복해서 말한 문제와 그 근거를 회사의 기록으로 남깁니다."
      action={<AgentLaunch context={{ surface: "memory" }} label="이 내용으로 물어보기" />}
    />
  );

  const detail =
    found ? (
      <IssueDetailPanel key={found.id} issue={found} onIssueChanged={onIssueChanged} />
    ) : selection.kind === "MISSING" ? (
      <div>
        <p className="break-keep font-semibold text-ink">이 문제를 찾을 수 없습니다</p>
        <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
          목록에서 다시 선택해 주세요. 기록이 정리되면서 문제가 합쳐졌거나 바뀌었을 수 있습니다.
        </p>
      </div>
    ) : null;

  const list = loading ? (
    <>
      {head}
      <p className="text-muted">불러오는 중…</p>
    </>
  ) : failed ? (
    <>
      {head}
      <Empty
        title="기록을 불러오지 못했습니다"
        body="연결 상태를 확인한 뒤 다시 시도해 주세요."
        action={<BtnLink to="/connect">채널 연결 확인</BtnLink>}
      />
    </>
  ) : visible.length === 0 ? (
    <>
      {head}
      <Empty
        title="아직 쌓인 기록이 없습니다"
        body="문의와 리뷰가 모이면, 같은 문제가 몇 번 반복됐는지와 무엇을 근거로 그렇게 보는지를 여기에서 확인합니다."
        action={<BtnLink to="/connect">채널 연결하기</BtnLink>}
      />
    </>
  ) : !wide && issueId ? (
    // Narrow: the chosen problem takes the column, with the way back to the list above it.
    <>
      {head}
      <Link to="/memory" className="text-sm font-semibold text-muted hover:text-ink hover:underline">
        ← 반복 문제 목록
      </Link>
      {detail}
    </>
  ) : (
    <>
      {head}
      <IssueList issues={visible} selectedId={found?.id ?? null} />
    </>
  );

  return <MasterDetail wide={wide} list={list} detailLabel="선택한 반복 문제" detail={visible.length > 0 ? detail : null} />;
}
