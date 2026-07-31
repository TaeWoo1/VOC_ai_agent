import { useEffect, useReducer, useRef, useState, type FormEvent } from "react";
import { Link, useNavigate, useSearchParams } from "react-router-dom";
import { api } from "../lib/apiClient";
import { classifyStartError, parseCafe24Result } from "../lib/cafe24Connect";
import { normalizeMallInput } from "../lib/cafe24Tutorial/mallId";
import {
  FAILURE_COPY,
  INITIAL_STATE,
  PHASE_COPY,
  STEP_LABELS,
  STEP_ORDER,
  clearTutorialState,
  interpretCallback,
  interpretCapability,
  loadTutorialState,
  saveTutorialState,
  tutorialReducer,
  type TutorialPhase,
} from "../lib/cafe24Tutorial/state";
import type { Cafe24CapabilityFeatureView } from "../lib/types";

/**
 * Cafe24 first-connection tutorial: a guided, seven-step onboarding wrapper over the existing
 * OAuth start/callback contract + the read-only capability check + one read-only order sync.
 *
 * <p>It never auto-clicks, auto-submits, or writes to the marketplace; the seller consents on
 * Cafe24 themselves. It never surfaces a secret, OAuth code/state, token, or mall internal id —
 * only sanitized statuses and fixed copy. A failed verification is never shown as success, and a
 * bare OAuth link is never treated as completion (the capability check + order sync decide it).
 */
export function Cafe24Tutorial() {
  const [state, dispatch] = useReducer(tutorialReducer, INITIAL_STATE);
  const [params] = useSearchParams();
  const navigate = useNavigate();

  const [mallInput, setMallInput] = useState("");
  const [mallError, setMallError] = useState<string | null>(null);
  const [busy, setBusy] = useState(false);
  const [stepError, setStepError] = useState<string | null>(null);

  const initedRef = useRef(false);

  // 1) Init: a callback return (URL status) wins; otherwise resume persisted state; else fresh.
  useEffect(() => {
    if (initedRef.current) {
      return;
    }
    initedRef.current = true;
    const rawStatus = params.get("status");
    if (rawStatus) {
      const { status, accountId } = parseCafe24Result(params);
      dispatch(interpretCallback(status, accountId));
      // Strip the params so a refresh does not re-process the callback.
      navigate("/connect/cafe24/tutorial", { replace: true });
      return;
    }
    const restored = loadTutorialState();
    if (restored) {
      dispatch({ type: "RESTORE", state: restored });
    }
  }, [params, navigate]);

  // 2) Persist the resumable slice on every change (no secrets stored).
  useEffect(() => {
    saveTutorialState(state);
  }, [state]);

  // 3) Auto-run the read-only capability check when entering verify (or on an in-place retry,
  //    tracked by verifyNonce). Gated on phase alone — the dispatch moves the phase off "verify",
  //    so re-renders can't re-fire it — and NOT on a persistent ref, which would suppress the
  //    surviving dispatch under React StrictMode's mount→cleanup→mount.
  useEffect(() => {
    if (state.phase !== "verify" || !state.accountId) {
      return;
    }
    let cancelled = false;
    setBusy(true);
    setStepError(null);
    api
      .getCafe24Capability(state.accountId)
      .then((view) => {
        if (cancelled) {
          return;
        }
        const result = interpretCapability(view);
        if (result.kind === "verified") {
          dispatch({ type: "VERIFIED" });
        } else if (result.kind === "retry") {
          dispatch({ type: "VERIFY_RETRYABLE" });
        } else {
          dispatch({ type: "VERIFY_FAILED", failure: result.failure });
        }
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: "VERIFY_FAILED", failure: "verify_unavailable" });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase, state.accountId, state.verifyNonce]);

  // 4) Auto-run the read-only first order sync when entering first_sync. Same phase-gated pattern
  //    (no persistent ref) so StrictMode's remount cannot strand the step on the busy state.
  useEffect(() => {
    if (state.phase !== "first_sync" || !state.accountId) {
      return;
    }
    let cancelled = false;
    setBusy(true);
    setStepError(null);
    api
      .manualSync(state.accountId, "ORDER_SUMMARY")
      .then((run) => {
        if (cancelled) {
          return;
        }
        const ok = run.status === "SUCCESS" || run.status === "PARTIAL";
        dispatch({ type: "SYNC_RESULT", ok });
      })
      .catch(() => {
        if (!cancelled) {
          dispatch({ type: "SYNC_RESULT", ok: false });
        }
      })
      .finally(() => {
        if (!cancelled) {
          setBusy(false);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [state.phase, state.accountId]);

  function submitMall(event: FormEvent) {
    event.preventDefault();
    const result = normalizeMallInput(mallInput);
    if (!result.ok) {
      setMallError(mallInputErrorCopy(result.reason));
      return;
    }
    setMallError(null);
    dispatch({ type: "MALL_CONFIRMED", mallId: result.mallId });
  }

  async function startConsent() {
    if (busy || !state.mallId) {
      return;
    }
    setBusy(true);
    setStepError(null);
    try {
      const start = await api.startCafe24Connect(state.mallId);
      // Persist accountId before we leave the SPA, so a callback/refresh can resume.
      dispatch({ type: "CONSENT_STARTED", accountId: start.sellerAccountId });
      saveTutorialState({ ...state, phase: "consent", accountId: start.sellerAccountId });
      window.location.assign(start.authorizationUrl);
    } catch (err) {
      setStepError(classifyStartError(err));
      dispatch({ type: "CONSENT_START_FAILED" });
      setBusy(false);
    }
  }

  function retry() {
    setStepError(null);
    dispatch({ type: "RETRY" });
  }

  function retryVerify() {
    setStepError(null);
    dispatch({ type: "VERIFY_RETRY" });
  }

  function finish() {
    clearTutorialState();
    navigate("/settings/channels");
  }

  const copy = PHASE_COPY[state.phase];

  return (
    <div className="mx-auto max-w-2xl space-y-6">
      <div>
        <h1 className="text-2xl font-bold">카페24 첫 연결</h1>
        <p className="mt-1 text-base text-muted">
          읽기 전용으로 안전하게 연결하고, 사용 가능한 기능을 확인합니다.
        </p>
      </div>

      <ProgressRail current={state.phase} />

      <section className="card space-y-4">
        <div>
          <h2 className="text-lg font-semibold text-ink">{copy.title}</h2>
          <p className="mt-1 text-base text-muted">{copy.body}</p>
        </div>

        {state.phase === "intro" ? (
          <div className="flex justify-end">
            <button type="button" className="btn-primary" onClick={() => dispatch({ type: "START" })}>
              시작하기
            </button>
          </div>
        ) : null}

        {state.phase === "mall_confirm" ? (
          <form className="space-y-4" onSubmit={submitMall}>
            <label htmlFor="cafe24-tutorial-mall" className="block text-base font-semibold text-ink">
              쇼핑몰 주소 또는 Mall ID
            </label>
            <input
              id="cafe24-tutorial-mall"
              className="w-full rounded-xl border border-line px-4 py-3 text-lg focus:border-brand focus:outline-none"
              value={mallInput}
              onChange={(event) => setMallInput(event.target.value)}
              placeholder="예: mystore 또는 mystore.cafe24.com"
              autoComplete="off"
            />
            <div className="rounded-xl bg-line/10 px-4 py-3 text-sm text-muted">
              <p className="font-semibold text-ink">Mall ID 찾는 방법</p>
              <p className="mt-1">
                카페24 자사몰 주소 <span className="font-mono">mystore.cafe24.com</span> 에서 앞부분
                <span className="font-mono"> mystore</span> 가 Mall ID입니다. 전체 주소를 붙여넣어도
                자동으로 정규화됩니다.
              </p>
            </div>
            {mallError ? (
              <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">{mallError}</div>
            ) : null}
            <div className="flex justify-end">
              <button type="submit" className="btn-primary">
                Mall ID 확인
              </button>
            </div>
          </form>
        ) : null}

        {state.phase === "permissions" ? (
          <div className="space-y-4">
            <ul className="space-y-2 text-base text-ink">
              <li>• 주문 요약 읽기 (mall.read_order)</li>
              <li>• 문의·리뷰 게시판 읽기 (mall.read_community)</li>
            </ul>
            <div className="rounded-xl bg-line/10 px-4 py-3 text-sm text-muted">
              글쓰기·답변 등록 권한은 요청하지 않습니다. 1:1 맞춤상담 게시판은 수집하지 않습니다.
            </div>
            <p className="text-sm text-muted">
              확인한 Mall ID: <span className="font-mono text-ink">{state.mallId}</span>
            </p>
            <div className="flex justify-end">
              <button
                type="button"
                className="btn-primary"
                onClick={() => dispatch({ type: "PERMISSIONS_ACK" })}
              >
                동의 화면으로 진행
              </button>
            </div>
          </div>
        ) : null}

        {state.phase === "consent" ? (
          <div className="space-y-4">
            {stepError ? (
              <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">{stepError}</div>
            ) : null}
            <div className="flex justify-end">
              <button type="button" className="btn-primary" disabled={busy} onClick={startConsent}>
                {busy ? "이동 중…" : "카페24 동의 화면으로 이동"}
              </button>
            </div>
          </div>
        ) : null}

        {state.phase === "verify" ? (
          <div className="space-y-3">
            <p className="text-base text-muted">
              {busy ? "검증 중입니다…" : "검증을 다시 시도할 수 있습니다."}
            </p>
            {state.verifyRetryable ? (
              <div className="rounded-xl bg-warn/10 px-4 py-3 text-warn">
                일시적인 오류가 발생했습니다. 잠시 후 다시 검증해 주세요.
              </div>
            ) : null}
            {!busy ? (
              <div className="flex justify-end">
                <button type="button" className="btn-primary" onClick={retryVerify}>
                  다시 검증
                </button>
              </div>
            ) : null}
          </div>
        ) : null}

        {state.phase === "first_sync" ? (
          <p className="text-base text-muted">
            {busy ? "주문 요약을 읽어오는 중입니다…" : "동기화 결과를 확인하고 있습니다…"}
          </p>
        ) : null}

        {state.phase === "done" ? (
          <div className="space-y-4">
            <CompletionFeatures accountId={state.accountId} />
            <div className="flex justify-end">
              <button type="button" className="btn-primary" onClick={finish}>
                채널 화면으로
              </button>
            </div>
          </div>
        ) : null}

        {state.phase === "failed" ? (
          <div className="space-y-4">
            <div className="rounded-xl bg-bad/10 px-4 py-3 text-bad">
              {state.failure ? FAILURE_COPY[state.failure] : "다시 시도해 주세요."}
            </div>
            <div className="flex items-center justify-between gap-3">
              <Link to="/settings/channels" className="btn-ghost">
                채널 연결로 돌아가기
              </Link>
              <button type="button" className="btn-primary" onClick={retry}>
                다시 시도
              </button>
            </div>
          </div>
        ) : null}
      </section>
    </div>
  );
}

function ProgressRail({ current }: { current: TutorialPhase }) {
  const activeIndex = STEP_ORDER.indexOf(current);
  return (
    <ol className="flex flex-wrap gap-2" aria-label="연결 진행 단계">
      {STEP_ORDER.map((phase, index) => {
        const done = activeIndex > index && current !== "failed";
        const active = current === phase;
        const tone = active
          ? "bg-brand/15 text-brand"
          : done
            ? "bg-good/10 text-good"
            : "bg-line/10 text-muted";
        return (
          <li key={phase} className={`rounded-full px-3 py-1 text-sm ${tone}`}>
            {index + 1}. {STEP_LABELS[phase]}
          </li>
        );
      })}
    </ol>
  );
}

/**
 * The completion screen fetches the capability view once more (read-only) and shows each
 * feature's real verified state — order/inquiry/review/issue plus the honestly NOT_ENABLED
 * reply + excluded-board lines.
 */
function CompletionFeatures({ accountId }: { accountId: string | null }) {
  const [features, setFeatures] = useState<Cafe24CapabilityFeatureView[] | null>(null);
  const [error, setError] = useState(false);

  useEffect(() => {
    if (!accountId) {
      return;
    }
    let cancelled = false;
    api
      .getCafe24Capability(accountId)
      .then((view) => {
        if (!cancelled) {
          setFeatures(view.features);
        }
      })
      .catch(() => {
        if (!cancelled) {
          setError(true);
        }
      });
    return () => {
      cancelled = true;
    };
  }, [accountId]);

  if (error) {
    return <p className="text-base text-muted">기능 상태를 불러오지 못했습니다.</p>;
  }
  if (!features) {
    return <p className="text-base text-muted">기능 상태를 불러오는 중…</p>;
  }
  return (
    <ul className="space-y-2">
      {features.map((f) => (
        <li
          key={f.feature}
          className="flex items-center justify-between rounded-xl border border-line px-4 py-3"
        >
          <span className="text-base text-ink">{f.label}</span>
          <FeatureBadge state={f.state} />
        </li>
      ))}
    </ul>
  );
}

function FeatureBadge({ state }: { state: string }) {
  const map: Record<string, { tone: string; label: string }> = {
    AVAILABLE: { tone: "bg-good/10 text-good", label: "사용 가능" },
    NEEDS_ATTENTION: { tone: "bg-warn/10 text-warn", label: "확인 필요" },
    NOT_ENABLED: { tone: "bg-line/10 text-muted", label: "미활성화" },
  };
  const badge = map[state] ?? { tone: "bg-line/10 text-muted", label: state };
  return <span className={`rounded-full px-3 py-1 text-sm ${badge.tone}`}>{badge.label}</span>;
}

function mallInputErrorCopy(reason: "empty" | "bad_host" | "malformed"): string {
  switch (reason) {
    case "empty":
      return "쇼핑몰 주소 또는 Mall ID를 입력해 주세요.";
    case "bad_host":
      return "카페24 자사몰 주소(*.cafe24.com)만 입력할 수 있습니다.";
    case "malformed":
    default:
      return "Mall ID 형식이 올바르지 않습니다. 영문 소문자·숫자·하이픈만 사용할 수 있습니다.";
  }
}
