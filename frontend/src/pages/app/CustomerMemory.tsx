import { useCallback, useEffect, useMemo, useState } from "react";
import { useParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Empty } from "../../components/ui/Empty";
import { BtnLink } from "../../components/ui/Btn";
import { IssueList } from "../../components/memory/IssueList";
import { IssueDetailPanel } from "../../components/memory/IssueDetailPanel";
import { api } from "../../lib/apiClient";
import { resolveIssueSelection } from "../../lib/memoryView";
import type { ReviewIssueView } from "../../lib/types";

/**
 * 고객운영 메모리 — what keeps coming back, and the evidence for it.
 *
 * SCOPE FENCE (v1): recurring issues, their evidence, their trend, and per-product signals. There
 * is NO search input, by decision — search over past inquiries, reviews and replies is
 * retrieval-backed work outside v1 and gated on a separate scope decision. Rendering a search box
 * before that capability exists would promise it. `memoryScope.test.tsx` holds this fence.
 *
 * The inbox is loaded alongside the issues for exactly one purpose: deciding whether an evidence
 * quote may link into it. A link that lands on "찾을 수 없습니다" is worse than no link.
 */
export function CustomerMemory() {
  const { issueId } = useParams();
  const [issues, setIssues] = useState<ReviewIssueView[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [inboxIds, setInboxIds] = useState<Set<string>>(new Set());

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

  useEffect(() => {
    let active = true;
    void api
      .getInboxStrict()
      .then((res) => {
        if (active) {
          setInboxIds(new Set(res.items.map((item) => item.id)));
        }
      })
      .catch(() => {
        // No inbox → no evidence links. The panel simply omits them.
        if (active) {
          setInboxIds(new Set());
        }
      });
    return () => {
      active = false;
    };
  }, []);

  const all = issues ?? [];
  const selection = resolveIssueSelection(all, issueId);

  const onIssueChanged = useCallback((next: ReviewIssueView) => {
    setIssues((current) =>
      current ? current.map((issue) => (issue.id === next.id ? next : issue)) : current,
    );
  }, []);

  const visible = useMemo(() => all.filter((issue) => !issue.dismissed), [all]);

  return (
    <>
      <PageHead
        title="고객운영 메모리"
        description="반복되는 고객 문제와 그 근거를 기록으로 남깁니다."
      />

      {loading ? (
        <p className="text-muted">불러오는 중…</p>
      ) : failed ? (
        <Empty
          title="기록을 불러오지 못했습니다"
          body="연결 상태를 확인한 뒤 다시 시도해 주세요."
          action={<BtnLink to="/connect">채널 연결 확인</BtnLink>}
        />
      ) : visible.length === 0 ? (
        <Empty
          title="아직 쌓인 기록이 없습니다"
          body="문의와 리뷰가 모이면, 같은 문제가 몇 번 반복됐는지와 무엇을 근거로 그렇게 보는지를 여기에서 확인합니다."
          action={<BtnLink to="/connect">채널 연결하기</BtnLink>}
        />
      ) : (
        <div className="grid gap-5 lg:grid-cols-[minmax(0,380px)_minmax(0,1fr)]">
          <div
            className={`overflow-hidden rounded-2xl border border-line bg-surface ${
              selection.kind === "FOUND" ? "hidden lg:block" : ""
            }`}
          >
            <IssueList
              issues={visible}
              selectedId={selection.kind === "FOUND" ? selection.issue.id : null}
            />
          </div>

          <div className="rounded-2xl border border-line bg-surface p-5 lg:sticky lg:top-4 lg:self-start">
            {selection.kind === "FOUND" ? (
              <IssueDetailPanel
                key={selection.issue.id}
                issue={selection.issue}
                loadedInboxIds={inboxIds}
                onIssueChanged={onIssueChanged}
              />
            ) : selection.kind === "MISSING" ? (
              <div>
                <p className="break-keep font-semibold text-ink">이 이슈를 찾을 수 없습니다</p>
                <p className="mt-2 break-keep text-sm leading-relaxed text-muted">
                  목록에서 다시 선택해 주세요. 기록이 정리되면서 이슈가 합쳐졌거나 바뀌었을 수
                  있습니다.
                </p>
              </div>
            ) : (
              <p className="break-keep text-sm leading-relaxed text-muted">
                왼쪽에서 이슈를 고르면 근거와 추세가 여기에 표시됩니다.
              </p>
            )}
          </div>
        </div>
      )}
    </>
  );
}
