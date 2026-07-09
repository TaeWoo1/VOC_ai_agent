import type { CommandType } from "../lib/actionWindow/contract";
import { SCENARIO_NAMES, type ScenarioName } from "../lib/actionWindow/fixtures";
import {
  dispatchOperationsCommand,
  loadRunScenario,
} from "../lib/actionWindow/operationsStore";
import { useOperationsStore } from "../hooks/useOperationsStore";
import { isFixturePreviewEnabled } from "../lib/actionWindow/devMode";
import { blockerView, channelLabel, resolveCopy } from "../lib/actionWindow/copy";
import { RunStatusBadge } from "../components/actionWindow/RunStatusBadge";
import { OperationRunTimeline } from "../components/actionWindow/OperationRunTimeline";
import { HumanCheckpointCard } from "../components/actionWindow/HumanCheckpointCard";
import { ActionWindowControlPanel } from "../components/actionWindow/ActionWindowControlPanel";
import { CompletedResult } from "../components/actionWindow/CompletedResult";

const SCENARIO_LABEL: Record<ScenarioName, string> = {
  "ready-to-start": "시작 전",
  "starting": "시작 중",
  "human-action-required": "확인 필요",
  "waiting-for-user": "사용자 대기",
  "observing": "확인 중",
  "download-detected": "다운로드 감지",
  "processing": "처리 중",
  "completed": "완료",
  "paused": "일시정지",
  "ui-drift": "화면 변경",
  "login-required": "로그인 필요",
  "failed": "실패",
};

/** FE-1 Review Operations run detail (/operations/current) — the single surface
 *  that renders command controls from `allowedCommands`. State is shared with the
 *  operations home (/operations) via the operations store (FE-2). */
export function Operations() {
  const { run, note, runScenario } = useOperationsStore();

  function handleCommand(type: CommandType) {
    dispatchOperationsCommand(type);
  }

  const blocker = run?.blocker ? blockerView(run.blocker.code) : undefined;

  return (
    <div className="mx-auto flex max-w-3xl flex-col gap-4 p-4 pb-16">
      <header className="flex flex-col gap-2">
        <div className="flex flex-wrap items-center justify-between gap-2">
          <h1 className="text-2xl font-bold text-ink">
            {run ? resolveCopy(run.runCopyKey, run.runCopyParams) : "리뷰 운영"}
          </h1>
          {run ? <RunStatusBadge status={run.status} /> : null}
        </div>
        {run ? (
          <p className="text-muted">채널: {channelLabel(run.channelCode)}</p>
        ) : (
          <p className="text-muted">아직 진행 중인 작업이 없어요. 새로 시작할 수 있어요.</p>
        )}
      </header>

      {/* Fixture/demo preview — DEV-ONLY (never rendered in the production build). */}
      {isFixturePreviewEnabled() ? (
        <nav
          aria-label="데모 시나리오 (개발용)"
          className="rounded-2xl border-2 border-dashed border-line bg-canvas p-3"
        >
          <p className="mb-2 text-xs font-semibold uppercase tracking-wide text-muted">
            🧪 데모 미리보기 · 개발용 · 실제 화면에는 표시되지 않아요
          </p>
          <div className="flex flex-wrap gap-1.5">
            {SCENARIO_NAMES.map((name) => {
              const active = name === runScenario;
              return (
                <button
                  key={name}
                  type="button"
                  aria-pressed={active}
                  onClick={() => loadRunScenario(name)}
                  className={
                    "rounded-lg px-3 py-1.5 text-sm transition focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 " +
                    (active ? "bg-ink text-white" : "border border-line bg-surface text-muted hover:bg-surface/70")
                  }
                >
                  {SCENARIO_LABEL[name]}
                </button>
              );
            })}
          </div>
        </nav>
      ) : null}

      <p aria-live="polite" className="min-h-[1.25rem] text-sm text-brand-700">
        {note}
      </p>

      {run === null ? (
        <section aria-label="시작하기" className="rounded-2xl bg-surface p-6 text-center shadow-card">
          <p className="text-lg text-ink">리뷰 내려받기를 시작할 수 있어요.</p>
          <p className="mt-1 text-muted">시작하면 판매자센터 화면에서 단계별로 안내해요.</p>
          <button
            type="button"
            onClick={() => handleCommand("START_RUN")}
            className="mt-4 hidden rounded-xl bg-brand px-5 py-3 font-medium text-white transition hover:bg-brand-600 focus:outline-none focus-visible:ring-2 focus-visible:ring-brand focus-visible:ring-offset-2 sm:inline-block"
          >
            시작
          </button>
          <p className="mt-4 text-sm text-muted sm:hidden">
            시작은 데스크톱에서 할 수 있어요. 휴대폰에서는 진행 상황만 볼 수 있어요.
          </p>
        </section>
      ) : (
        <>
          {/* Mobile: read-only. The real operation runs on desktop (local agent + browser). */}
          <p
            role="note"
            className="rounded-2xl border border-line bg-canvas px-4 py-3 text-sm text-muted sm:hidden"
          >
            <span aria-hidden="true">📱 </span>
            휴대폰에서는 진행 상황만 볼 수 있어요. 시작·확인 등 실제 작업은 데스크톱에서 진행해요.
          </p>

          {blocker && run.status !== "WAITING_FOR_HUMAN" ? (
            <div role="status" className="rounded-2xl border border-bad/30 bg-bad/5 p-4">
              <p className="font-medium text-ink">
                <span aria-hidden="true">⚠ </span>
                {blocker.title}
                <span className="ml-2 align-middle text-xs text-muted">
                  {run.blocker?.recoverable ? "다시 시도할 수 있어요" : "복구할 수 없어요"}
                </span>
              </p>
              <p className="mt-0.5 text-sm text-muted">{blocker.body}</p>
            </div>
          ) : null}

          <OperationRunTimeline run={run} />

          {run.status === "WAITING_FOR_HUMAN" ? (
            <HumanCheckpointCard run={run} onCommand={handleCommand} />
          ) : null}

          {run.status === "COMPLETED" ? <CompletedResult run={run} /> : null}

          {/* Interactive controls are desktop-only; mobile stays read-only. */}
          <div className="hidden sm:block">
            <ActionWindowControlPanel run={run} onCommand={handleCommand} />
          </div>
        </>
      )}
    </div>
  );
}
