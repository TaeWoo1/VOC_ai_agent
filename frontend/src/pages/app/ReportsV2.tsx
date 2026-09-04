import { useCallback, useEffect, useMemo, useState } from "react";
import { Link, useSearchParams } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { ListBox, Section } from "../../components/ui/Section";
import { Disclosure } from "../../components/ui/Disclosure";
import { WorkItem } from "../../components/ui/WorkItem";
import { Status } from "../../components/ui/Status";
import { Btn } from "../../components/ui/Btn";
import { api } from "../../lib/apiClient";
import type {
  AgentReportListItem,
  AgentReportView,
  ReportFacts,
  ReportKind,
  ReportNarrativeLine,
  ReportSummaryLine,
} from "../../lib/types";

const UNAVAILABLE = "이 항목은 지금 확인할 수 없습니다.";

/**
 * A fact id resolved to the object it names — label and, when the object has a screen, where it is.
 * Every sentence on this page cites ids; this is how a citation becomes a doorway.
 */
function factRef(facts: ReportFacts, id: string): { label: string; to: string | null } | null {
  const counter = facts.counters.find((c) => c.id === id);
  if (counter) return { label: counter.labelKo, to: counter.to };
  const issue = facts.issues.find((i) => i.id === id);
  if (issue) return { label: issue.title, to: issue.to };
  const opportunity = facts.opportunities.find((o) => o.id === id);
  if (opportunity) return { label: `${opportunity.issueTitle} · ${opportunity.kindLabelKo}`, to: opportunity.to };
  const step = facts.nextSteps.find((n) => n.id === id);
  if (step) return { label: step.labelKo, to: step.to };
  return null;
}

/** The citations under one line: distinct objects, linked where they have a screen. */
function Citations({ facts, ids }: { facts: ReportFacts; ids: string[] }) {
  const refs = useMemo(() => {
    const seen = new Set<string>();
    const out: { label: string; to: string | null }[] = [];
    for (const id of ids) {
      const ref = factRef(facts, id);
      if (ref && !seen.has(ref.label)) {
        seen.add(ref.label);
        out.push(ref);
      }
    }
    return out;
  }, [facts, ids]);
  if (refs.length === 0) return null;
  return (
    <span className="ml-2 inline-flex flex-wrap gap-x-2 text-xs text-muted">
      {refs.map((ref) =>
        ref.to ? (
          <Link key={ref.label} to={ref.to} className="underline-offset-2 hover:text-brand-700 hover:underline">
            {ref.label}
          </Link>
        ) : (
          <span key={ref.label}>{ref.label}</span>
        ),
      )}
    </span>
  );
}

function NarrativeBlock({ report }: { report: AgentReportView }) {
  const { facts } = report;
  if (report.narrative && report.narrativeStatus === "READY") {
    return (
      <div className="space-y-2" data-testid="report-narrative">
        {report.narrative.headline ? (
          <p className="break-keep text-lg font-semibold leading-snug text-ink">{report.narrative.headline}</p>
        ) : null}
        <ul className="space-y-1.5">
          {report.narrative.lines.map((line: ReportNarrativeLine) => (
            <li key={line.text} className="break-keep leading-relaxed text-ink">
              {line.text}
              <Citations facts={facts} ids={line.factIds} />
            </li>
          ))}
        </ul>
      </div>
    );
  }
  // The deterministic reading: what the seller gets whether or not the model wrote anything.
  return (
    <div className="space-y-2" data-testid="report-summary">
      <ul className="space-y-1.5">
        {report.summary.lines.map((line: ReportSummaryLine) => (
          <li
            key={line.text}
            className={`break-keep leading-relaxed ${line.kind === "LIMIT" ? "text-muted" : "text-ink"}`}
          >
            {line.kind === "INTERPRETATION" ? (
              <Status tone="warn" variant="word" className="mr-2">
                확인 필요
              </Status>
            ) : null}
            {line.text}
            <Citations facts={facts} ids={line.factIds} />
          </li>
        ))}
      </ul>
      {report.narrativeNoteKo ? <p className="text-sm text-muted">{report.narrativeNoteKo}</p> : null}
    </div>
  );
}

function deltaWord(c: { previous: number | null; delta: number | null }): string {
  // An absent previous reading is not a zero: no comparison is claimed against it.
  if (c.previous === null) return "이전 기간 자료 없음";
  if (c.delta === null || c.delta === 0) return `이전 기간과 같음 (${c.previous}건)`;
  return c.delta > 0 ? `이전 기간보다 ${c.delta}건 늘음 (${c.previous}건)` : `이전 기간보다 ${-c.delta}건 줄음 (${c.previous}건)`;
}

function formatGeneratedAt(iso: string): string {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return "";
  return `${d.getMonth() + 1}월 ${d.getDate()}일 ${String(d.getHours()).padStart(2, "0")}:${String(d.getMinutes()).padStart(2, "0")}`;
}

/**
 * 운영 리포트 — 주간 / 월간.
 *
 * Reads ONE stored snapshot (`GET /api/agent-reports/current`), so reopening prints what was printed
 * before; a newer reading is an explicit new version. The top is the AI narrative when one survived
 * validation, otherwise the deterministic summary; everything below is the facts the sentences cite,
 * each row a doorway to the object that owns it. The copy guard in `pages-copy.test.ts` scans this
 * file's raw source, so the claim vocabulary is described here rather than spelled out.
 */
export function ReportsV2() {
  const [params, setParams] = useSearchParams();
  const kind: ReportKind = params.get("kind") === "MONTHLY" ? "MONTHLY" : "WEEKLY";
  const reportId = params.get("id");
  const [report, setReport] = useState<AgentReportView | null>(null);
  const [history, setHistory] = useState<AgentReportListItem[] | null>(null);
  const [loading, setLoading] = useState(true);
  const [failed, setFailed] = useState(false);
  const [regenerating, setRegenerating] = useState(false);
  const [regenerateFailed, setRegenerateFailed] = useState(false);

  useEffect(() => {
    let active = true;
    setLoading(true);
    setFailed(false);
    const read = reportId ? api.getAgentReport(reportId) : api.getCurrentAgentReport(kind);
    void Promise.allSettled([read, api.listAgentReports(kind)]).then(([reportResult, listResult]) => {
      if (!active) return;
      if (reportResult.status === "fulfilled") {
        setReport(reportResult.value);
      } else {
        setReport(null);
        setFailed(true);
      }
      setHistory(listResult.status === "fulfilled" ? listResult.value : null);
      setLoading(false);
    });
    return () => {
      active = false;
    };
  }, [kind, reportId]);

  const switchKind = useCallback(
    (next: ReportKind) => {
      const nextParams = new URLSearchParams();
      if (next === "MONTHLY") nextParams.set("kind", "MONTHLY");
      setParams(nextParams);
    },
    [setParams],
  );

  const regenerate = useCallback(async () => {
    if (!report) return;
    setRegenerating(true);
    setRegenerateFailed(false);
    try {
      const next = await api.regenerateAgentReport(report.kind, report.periodStart);
      setReport(next);
      const nextParams = new URLSearchParams(params);
      nextParams.set("id", next.id);
      setParams(nextParams);
      void api.listAgentReports(report.kind).then(setHistory, () => undefined);
    } catch {
      setRegenerateFailed(true);
    } finally {
      setRegenerating(false);
    }
  }, [params, report, setParams]);

  const kindToggle = (
    <div role="group" aria-label="리포트 기간" className="inline-flex gap-1">
      {(["WEEKLY", "MONTHLY"] as const).map((k) => (
        <Btn
          key={k}
          size="sm"
          variant={k === kind ? "solid" : "outline"}
          aria-pressed={k === kind}
          onClick={() => switchKind(k)}
        >
          {k === "WEEKLY" ? "주간" : "월간"}
        </Btn>
      ))}
    </div>
  );

  if (loading) {
    return (
      <>
        <PageHead title="운영 리포트" action={kindToggle} />
        <p className="text-muted">불러오는 중…</p>
      </>
    );
  }

  if (!report) {
    return (
      <>
        <PageHead title="운영 리포트" action={kindToggle} />
        <p className="text-muted">{failed ? "리포트를 불러오지 못했습니다. 잠시 후 다시 열어 주세요." : UNAVAILABLE}</p>
      </>
    );
  }

  const { facts } = report;
  const periodic = facts.counters.filter((c) => c.periodic);
  const standing = facts.counters.filter((c) => !c.periodic);

  return (
    <div className="space-y-6">
      <PageHead
        title="운영 리포트"
        description="수집된 문의·리뷰를 기준으로, 지난 기간에 달라진 것과 다음에 할 일을 정리했습니다."
        meta={
          <span className="text-sm text-muted">
            {report.kindLabelKo} · {report.periodLabelKo} · {formatGeneratedAt(report.generatedAt)} 기준
            {report.version > 1 ? ` · ${report.version}번째 판` : ""}
          </span>
        }
        action={kindToggle}
      />

      <Section
        title="AI 운영 요약"
        action={
          <Btn size="sm" variant="outline" onClick={() => void regenerate()} disabled={regenerating}>
            {regenerating ? "다시 만드는 중…" : "최신 자료로 다시 만들기"}
          </Btn>
        }
      >
        <NarrativeBlock report={report} />
        {regenerateFailed ? <p className="text-sm text-bad">새 리포트를 만들지 못했습니다.</p> : null}
      </Section>

      <Section title="이번 기간에 달라진 것" hint={`${facts.period.labelKo} · 이전 기간과 비교`}>
        <ListBox ariaLabel="기간 수치">
          {periodic.map((c) => (
            <div key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3">
              <span className="text-ink">{c.labelKo}</span>
              <span className="text-sm text-muted">
                <span className="mr-2 text-base font-semibold tabular-nums text-ink">{c.current}건</span>
                {deltaWord(c)}
              </span>
            </div>
          ))}
          {standing.map((c) => (
            <div key={c.id} className="flex flex-wrap items-baseline justify-between gap-x-3 px-4 py-3">
              {/* No period: this is what is waiting NOW, and it links only where exactly this count is shown. */}
              {c.to && c.current > 0 ? (
                <Link to={c.to} className="text-ink underline-offset-2 hover:text-brand-700 hover:underline">
                  {c.labelKo}
                </Link>
              ) : (
                <span className="text-ink">{c.labelKo}</span>
              )}
              <span className="text-sm text-muted">
                <span className="mr-2 text-base font-semibold tabular-nums text-ink">{c.current}건</span>
                기간과 무관한 지금 수치
              </span>
            </div>
          ))}
        </ListBox>
      </Section>

      <Section title="반복된 문제" count={facts.issues.length || null} hint="이 기간이나 직전 기간에 근거 리뷰가 있었던 문제">
        {facts.issues.length === 0 ? (
          <p className="text-muted">이 기간에 근거 리뷰가 붙은 반복 문제가 없습니다.</p>
        ) : (
          <ListBox ariaLabel="반복된 문제">
            {facts.issues.map((issue) => (
              <WorkItem
                key={issue.id}
                state={issue.changeLabelsKo[0] ?? (issue.delta > 0 ? "늘어남" : issue.delta < 0 ? "줄어듦" : "그대로")}
                tone={issue.delta > 0 ? "warn" : "neutral"}
                title={issue.title}
                meta={[
                  `이번 기간 ${issue.current}건 · 이전 ${issue.previous}건`,
                  `심각도 ${issue.severityLabelKo}`,
                  issue.productName,
                ]
                  .filter(Boolean)
                  .join(" · ")}
                to={issue.to}
              />
            ))}
          </ListBox>
        )}
      </Section>

      <Section title="개선 기회" count={facts.opportunities.length || null} hint="반복 문제와 회사 지식에서 도출">
        {facts.opportunities.length === 0 ? (
          <p className="text-muted">지금 제안된 개선 기회가 없습니다.</p>
        ) : (
          <ListBox ariaLabel="개선 기회">
            {facts.opportunities.map((o) => (
              <WorkItem
                key={o.id}
                state={o.kindLabelKo}
                tone="info"
                title={o.recommendationKo}
                meta={[o.issueTitle, o.statusLabelKo, o.productName].filter(Boolean).join(" · ")}
                to={o.to}
              />
            ))}
          </ListBox>
        )}
      </Section>

      <Section title="다음에 할 일" count={facts.nextSteps.length || null}>
        {facts.nextSteps.length === 0 ? (
          <p className="text-muted">이 기간의 자료에서 제안할 다음 행동이 없습니다.</p>
        ) : (
          <ListBox ariaLabel="다음에 할 일">
            {facts.nextSteps.map((step) => (
              <WorkItem key={step.id} title={step.labelKo} to={step.to} />
            ))}
          </ListBox>
        )}
      </Section>

      {history && history.length > 1 ? (
        <Disclosure label="이전 리포트" note={`${history.length}건`}>
          <ul className="mt-2 space-y-1 text-sm">
            {history.map((item) => (
              <li key={item.id}>
                <Link
                  to={`/reports?kind=${item.kind}&id=${item.id}`}
                  aria-current={item.id === report.id ? "true" : undefined}
                  className={`underline-offset-2 hover:text-brand-700 hover:underline ${item.id === report.id ? "font-semibold text-ink" : "text-muted"}`}
                >
                  {item.periodLabelKo}
                  {item.version > 1 ? ` · ${item.version}번째 판` : ""} · {formatGeneratedAt(item.generatedAt)}
                </Link>
              </li>
            ))}
          </ul>
        </Disclosure>
      ) : null}
    </div>
  );
}
