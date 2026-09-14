import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useLocation, useNavigate, useParams } from "react-router-dom";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { Empty } from "../../components/ui/Empty";
import { HelperStatusCard } from "../../components/connect/HelperStatusCard";
import { GuidedAcquisitionRun, type AcquisitionRunSurface } from "../../components/acquisition/GuidedAcquisitionRun";
import { api } from "../../lib/apiClient";
import type { AcquisitionReadinessView } from "../../lib/acquisitionReadiness";
import { readStoreIdentityBootstrap, type StoreIdentityBootstrap } from "../../lib/storeIdentityBootstrap";
import {
  REVIEW_COLLECTION_STEPS,
  collectedSentence,
  lastScreenRead,
  reviewCollectionStateOf,
  type CollectionReceipt,
  type ReviewCollectionArrival,
  type ReviewCollectionState,
} from "../../lib/connect/reviewCollection";
import { reviewRecordPath } from "../../lib/reviewRecord";
import type { SellerAccountResponse } from "../../lib/types";

/**
 * <b>상품평 한 번 가져오기 — 한 화면, 한 걸음, 한 버튼.</b>
 *
 * <p>이 lane의 네 가지 사실은 네 곳에서 온다(계정 · 이 PC의 도우미 · 열린 판매자 화면 · 그 화면의 스토어).
 * 채널 화면에 있던 동안 그 넷은 <b>동시에</b> 그려졌고, 그래서 첫 화면에 누를 수 있는 solid가 「도우미 연결」
 * 하나이고 정작 목적인 버튼은 그 아래에서 disabled로 서 있었다(실측 2026-09-14). 전용 화면으로 옮긴 것은
 * 취향이 아니라 그 구조를 불가능하게 만들기 위해서다 — 한 시점에 걸음 하나, 컨트롤 하나.
 *
 * <p><b>이 화면은 셋업이자 수집이다.</b> 이미 연결된 계정이 들어오면 도우미 걸음은 스스로 지나가고 스토어
 * 확인은 아예 렌더되지 않으므로, 같은 화면이 「리뷰 수집 연결하기」와 「지금 가져오기」 양쪽의 목적지가 된다.
 * 두 경로를 따로 만들면 같은 run을 두 벌로 그리게 되고, 그 둘은 언젠가 다른 말을 한다.
 *
 * <p><b>완료 문장은 지어내지 않는다.</b> 시작 전에 이 계정의 마지막 화면 수집 기록을 기억해 두고, 끝난 뒤
 * <b>새 기록이 생겼을 때만</b> 그 기록의 수를 말한다. 아무것도 저장하지 않은 걸음은 기록을 남기지 않으므로
 * (엔진이 빈 배치를 넘기지 않는다) 「새로 가져올 상품평이 없었습니다」가 그때의 참이다.
 *
 * <p>이 화면은 마켓플레이스에 클릭·입력·전송을 하지 않는다. 판매자의 press가 장벽을 넘기는 유일한 방법이고,
 * 그 press는 기술 동작이 아니라 판매자가 방금 한 일의 이름을 단다.
 */
export function ReviewCollectionFlow() {
  const { accountId = "" } = useParams();
  const navigate = useNavigate();
  const location = useLocation();

  /**
   * <b>눌러서 왔는가, 주소로 왔는가</b> — 그리고 그 답은 한 번만 유효하다.
   *
   * 이 화면은 이제 스스로 읽으므로, 도착이 곧 수집이면 새로고침 한 번이 판매자가 요청하지 않은 마켓플레이스
   * 읽기가 된다. 그래서 press가 실어 보낸 의도를 <b>읽자마자 소비</b>한다(history state를 비운다): 같은 주소를
   * 다시 열면 그때는 시작 버튼이 있는 화면이고, 시작은 다시 판매자의 것이다.
   */
  const [arrival] = useState<ReviewCollectionArrival>(() =>
    (location.state as { start?: boolean } | null)?.start === true ? "PRESSED" : "VISITED",
  );
  useEffect(() => {
    if ((location.state as { start?: boolean } | null)?.start === true) {
      navigate(location.pathname, { replace: true, state: null });
    }
    // 한 번만. 의도는 도착의 성질이지 렌더의 성질이 아니다.
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const [account, setAccount] = useState<SellerAccountResponse | null | undefined>(undefined);
  const [readiness, setReadiness] = useState<AcquisitionReadinessView | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  /** 도우미가 보고한 한 단어. 같은 단어를 다시 받는 것은 상태 변화가 아니다. */
  const [helperKey, setHelperKey] = useState<string | null>(null);
  const [bootstrap, setBootstrap] = useState<StoreIdentityBootstrap | null>(null);
  const [runKey, setRunKey] = useState(0);
  /**
   * run이 보고한 것 중 <b>이 화면이 걸음을 정하는 데 쓰는 값들</b>만. 함수는 여기 담지 않는다 — 값이 아닌
   * 것을 상태에 담으면 그 정체성이 바뀔 때마다 화면이 자기를 다시 그리게 되고, 그것은 렌더 루프의 모양이다.
   */
  const [surface, setSurface] = useState<RunFacts>({ view: null, unavailable: null, startFailed: false });
  const sendRef = useRef<AcquisitionRunSurface["send"] | null>(null);
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  const [typed, setTyped] = useState("");
  /** 이 방문의 걸음이 남긴 것. 시작 전 기준과 비교해서만 정해진다. */
  const [receipt, setReceipt] = useState<CollectionReceipt>({ kind: "UNKNOWN" });
  const baselineRef = useRef<string | null>(null);

  useEffect(() => {
    let live = true;
    void api
      .getSellerAccountsStrict()
      .then((list) => live && setAccount(list.find((a) => a.id === accountId) ?? null))
      .catch(() => live && setAccount(null));
    return () => {
      live = false;
    };
  }, [accountId]);

  useEffect(() => {
    if (!accountId) return;
    let live = true;
    void api
      .getReviewAcquisitionReadiness(accountId)
      .then((r) => live && setReadiness(r))
      .catch(() => live && setReadFailed(true));
    // What this account's screen-read history looked like BEFORE this visit. The completion sentence
    // compares against it rather than trusting that the newest row belongs to the walk we just watched.
    void api
      .getSyncRunsStrict({ sellerAccountId: accountId })
      .then((runs) => {
        if (live) baselineRef.current = lastScreenRead(runs)?.id ?? null;
      })
      .catch(() => {
        // Unknown baseline: then this visit will not claim a number at all.
        baselineRef.current = undefined as unknown as string | null;
      });
    return () => {
      live = false;
    };
  }, [accountId]);

  const helperReady = helperKey === "CONNECTED";

  const step: ReviewCollectionState = useMemo(
    () =>
      reviewCollectionStateOf({
        readiness,
        helperKey,
        run: surface.view,
        unavailable: surface.unavailable,
        bootstrap,
        startFailed: surface.startFailed,
        arrival,
      }),
    [readiness, helperKey, surface, bootstrap, arrival],
  );

  /**
   * Ask the helper which store it is looking at — only while this account has no store of its own, and
   * only once a walk has actually been started. Asking earlier would be asking about a screen nobody opened.
   */
  useEffect(() => {
    if (readiness?.state !== "STORE_IDENTITY_UNKNOWN" || runKey === 0) return;
    let live = true;
    const ask = () => {
      void readStoreIdentityBootstrap().then((b) => {
        if (live && b) setBootstrap(b);
      });
    };
    ask();
    const timer = window.setInterval(ask, 2000);
    return () => {
      live = false;
      window.clearInterval(timer);
    };
  }, [readiness?.state, runKey]);

  /**
   * 도우미가 준비되는 대로 시작한다 — <b>판매자의 press로 들어온 방문에 한해서</b>. 그 press가 결정이었고,
   * 그 뒤로 물어볼 것은 없다. 주소로 들어온 방문은 시작하지 않고 시작 버튼을 보여 준다.
   */
  useEffect(() => {
    if (helperReady && runKey === 0 && arrival === "PRESSED") setRunKey(1);
  }, [helperReady, runKey, arrival]);

  const confirmStore = useCallback(
    (value: string) => {
      setSavingIdentity(true);
      setIdentityError(null);
      api
        .setStoreIdentity(accountId, value)
        .then((next) => {
          setReadiness(next);
          setBootstrap(null);
          setSurface({ view: null, unavailable: null, startFailed: false });
          // A new walk: the ref the last one spent is single-use, and this is a new decision.
          setRunKey((k) => k + 1);
        })
        .catch(() => setIdentityError("스토어를 저장하지 못했습니다. 다시 확인해 주세요."))
        .finally(() => setSavingIdentity(false));
    },
    [accountId],
  );

  const completed = useCallback(() => {
    void api
      .getSyncRunsStrict({ sellerAccountId: accountId })
      .then((runs) => {
        const newest = lastScreenRead(runs);
        // Only a row this walk created may be read as this walk's result.
        setReceipt(newest && newest.id !== baselineRef.current ? { kind: "STORED", run: newest } : { kind: "NONE" });
      })
      // 읽지 못한 것은 「없었다」가 아니다.
      .catch(() => setReceipt({ kind: "UNKNOWN" }));
  }, [accountId]);

  if (account === null) {
    return (
      <Empty
        title="판매 계정을 찾을 수 없습니다"
        body="채널 목록에서 다시 선택해 주세요."
        action={<BtnLink to="/connect">채널 목록</BtnLink>}
      />
    );
  }
  if (readFailed || readiness?.state === "CHANNEL_NOT_SUPPORTED" || readiness?.state === "FILE_UPLOAD_ACCOUNT") {
    return (
      <Empty
        title="이 계정은 화면에서 상품평을 가져오지 않습니다"
        body="채널 화면에서 이 계정이 지원하는 방법을 확인해 주세요."
        action={<BtnLink to={`/connect/channels/${accountId}`}>채널 화면</BtnLink>}
      />
    );
  }

  const done = step.step === "DONE";
  const back = () => navigate(`/connect/channels/${accountId}`);

  return (
    <div className="mx-auto w-full max-w-2xl space-y-6">
      <div className="flex items-start justify-between gap-4">
        <div className="min-w-0">
          <h1 className="break-keep text-xl font-bold text-ink">리뷰 수집</h1>
          <p className="mt-1 break-keep text-sm text-muted">
            로그인된 쿠팡 판매자 화면에서 상품평을 가져옵니다. API 키는 필요하지 않습니다.
          </p>
        </div>
        <Btn variant="ghost" size="sm" onClick={back} data-testid="flow-exit">
          {done ? "닫기" : "그만두기"}
        </Btn>
      </div>

      {/* 끝난 화면에는 걸음이 없다. 완료 카드가 결과 전부이고, 그 위에 아무 칸도 굵지 않은 진행 표시가
          남아 있으면 「아무 일도 일어나지 않았다」처럼 읽힌다. */}
      {done ? null : <StepRail current={step.step} skipStore={readiness?.state !== "STORE_IDENTITY_UNKNOWN"} />}

      {done ? (
        <section className="space-y-4 rounded-2xl border border-line bg-surface p-6" data-testid="flow-done">
          <div>
            <h2 className="break-keep text-lg font-semibold text-ink">{collectedSentence(receipt)}</h2>
            <p className="mt-1.5 break-keep text-sm text-muted">
              앞으로는 채널 화면의 [지금 가져오기]로 언제든 다시 가져올 수 있습니다.
            </p>
          </div>
          <div className="flex flex-wrap gap-2">
            <BtnLink to={reviewRecordPath(accountId)}>상품평 보기</BtnLink>
            <Btn variant="outline" onClick={back}>
              채널 화면으로
            </Btn>
          </div>
        </section>
      ) : (
        <section className="space-y-4 rounded-2xl border border-line bg-surface p-6" data-testid="flow-step">
          <div>
            <h2 className="break-keep text-lg font-semibold text-ink" data-testid="flow-title">
              {step.title}
            </h2>
            {step.body ? (
              <p className="mt-1.5 break-keep text-base leading-relaxed text-ink">{step.body}</p>
            ) : null}
          </div>

          {/* 실패한 걸음에서만. 정상 상태에는 복구 UI가 존재하지 않는다. */}
          {step.failure ? (
            <div className="rounded-xl border border-warn/30 bg-warn/5 px-4 py-3" role="status" data-testid="flow-failure">
              <p className="break-keep text-base font-semibold text-warn">{step.failure.title}</p>
              <p className="mt-1 break-keep text-sm text-ink">{step.failure.body}</p>
            </div>
          ) : null}

          {/* 확인해 주실 스토어 — 이 lane에서 판매자가 답하는 유일한 질문. */}
          {step.confirmStore ? (
            <p className="break-keep text-base text-ink" data-testid="flow-store">
              <span className="font-semibold">{step.confirmStore}</span> 스토어의 상품평을 가져옵니다.
            </p>
          ) : null}

          {step.askIdentity ? (
            <form
              className="flex flex-wrap items-end gap-2"
              data-testid="flow-identity-form"
              onSubmit={(e) => {
                e.preventDefault();
                if (savingIdentity || typed.trim() === "") return;
                confirmStore(typed.trim());
              }}
            >
              <label className="flex flex-col gap-1 text-sm">
                <span className="font-semibold text-ink">쿠팡 업체코드</span>
                <input
                  className="min-h-[40px] w-56 rounded-lg border border-line px-3 text-base"
                  value={typed}
                  onChange={(e) => setTyped(e.target.value)}
                  placeholder="쿠팡 판매자 화면에 표시되는 코드"
                  aria-label="쿠팡 업체코드"
                />
              </label>
              <Btn type="submit" disabled={savingIdentity || typed.trim() === ""}>
                이 스토어로 가져오기
              </Btn>
            </form>
          ) : null}

          {identityError ? (
            <p className="break-keep text-sm text-bad" role="alert">
              {identityError}
            </p>
          ) : null}

          {/* 도우미는 자기 말과 자기 버튼을 이미 갖고 있다. 그것을 다시 쓰지 않고, 그 카드를 이 걸음에 놓는다.
              연결된 뒤에는 렌더되지 않지만 마운트는 유지된다 — 이 화면에서 도우미 상태를 아는 곳은 하나뿐이다. */}
          <div className={step.step === "HELPER" ? "rounded-xl border border-line bg-canvas" : "hidden"}>
            <HelperStatusCard naverHealth={null} onState={(s) => setHelperKey(s.key)} />
          </div>

          {step.primary && step.primary.kind !== "HELPER" ? (
            <div>
              <Btn
                onClick={() => {
                  if (step.primary?.kind === "START") setRunKey((k) => k + 1);
                  else if (step.primary?.kind === "RECHECK") sendRef.current?.("REQUEST_STEP_RECHECK");
                  else if (step.primary?.kind === "CONFIRM_STORE" && step.confirmStore) confirmStore(step.confirmStore);
                }}
                disabled={savingIdentity}
                data-testid="flow-primary"
              >
                {step.primary.label}
              </Btn>
              {step.primary.kind === "CONFIRM_STORE" ? (
                <Btn
                  className="ml-2"
                  variant="ghost"
                  onClick={() => setBootstrap({ state: "NONE" })}
                  data-testid="flow-other-store"
                >
                  다른 스토어입니다
                </Btn>
              ) : null}
            </div>
          ) : null}

          {step.busy ? <Waiting /> : null}
        </section>
      )}

      {/* The run itself: one machine, no surface of its own. */}
      {runKey > 0 ? (
        <GuidedAcquisitionRun
          key={runKey}
          path="WING_READ_ACTION_WINDOW"
          accountId={accountId}
          onCompleted={completed}
          renderSurface={(s) => {
            sendRef.current = s.send;
            return <SurfaceReporter surface={s} onChange={setSurface} />;
          }}
        />
      ) : null}
    </div>
  );
}

/**
 * 기다리는 동안 화면이 말할 수 있는 것은 <b>시계뿐</b>이다.
 *
 * 실측된 한 번의 수집은 창을 열고 세션을 확인하고 한 페이지를 읽는 데 20초대가 걸린다. 그동안 아무 말도
 * 없으면 판매자는 멈춘 화면을 본다. 그래서 지나간 초를 적되 남은 시간을 약속하지 않는다 — 이 저장소는 아무도
 * 재지 않은 진행률을 그리지 않기로 했고, 경과 시간은 우리가 실제로 가진 유일한 사실이다.
 */
function Waiting() {
  const [seconds, setSeconds] = useState(0);
  useEffect(() => {
    const t = window.setInterval(() => setSeconds((n) => n + 1), 1000);
    return () => window.clearInterval(t);
  }, []);
  // 제목과 본문이 이미 「가져오는 중」이라고 말했다. 여기서 같은 말을 세 번째로 하지 않는다 — 이 줄이 더할
  // 수 있는 사실은 시계뿐이고, 그 시계는 기다림이 길어졌을 때만 사실이 된다.
  if (seconds < 5) return <span className="sr-only" role="status" data-testid="flow-busy">가져오는 중</span>;
  return (
    <p className="break-keep text-sm tabular-nums text-muted" role="status" data-testid="flow-busy">
      {seconds}초 경과
    </p>
  );
}

/** What the page keeps from the run. Values only. */
interface RunFacts {
  view: AcquisitionRunSurface["view"];
  unavailable: AcquisitionRunSurface["unavailable"];
  startFailed: boolean;
}

/** Lifts the run's state into the page without drawing anything. */
function SurfaceReporter({
  surface,
  onChange,
}: {
  surface: AcquisitionRunSurface;
  onChange: (s: RunFacts) => void;
}) {
  const { view, unavailable, startFailed } = surface;
  useEffect(() => {
    onChange({ view, unavailable, startFailed });
  }, [view, unavailable, startFailed, onChange]);
  return null;
}

/**
 * 어디쯤 왔는가. 스토어 확인은 이미 아는 계정에서 <b>일어나지 않으므로</b> 칸도 그리지 않는다 — 지나갈 수
 * 없는 걸음을 남겨 두면 판매자는 건너뛴 것이 아니라 못 한 것으로 읽는다.
 */
function StepRail({ current, skipStore }: { current: string; skipStore: boolean }) {
  const steps = REVIEW_COLLECTION_STEPS.filter((s) => s.id !== "DONE" && (!skipStore || s.id !== "STORE"));
  const index = steps.findIndex((s) => s.id === current);
  return (
    <ol className="flex flex-wrap gap-x-4 gap-y-1" aria-label="진행 단계">
      {steps.map((s, i) => (
        <li
          key={s.id}
          aria-current={i === index ? "step" : undefined}
          className={`break-keep text-sm ${i === index ? "font-semibold text-ink" : "text-muted"}`}
        >
          {s.label}
        </li>
      ))}
    </ol>
  );
}
