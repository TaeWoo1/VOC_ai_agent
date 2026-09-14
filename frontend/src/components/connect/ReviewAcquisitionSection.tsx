import { useCallback, useEffect, useState } from "react";
import { Section } from "../Section";
import { Btn, BtnLink } from "../ui/Btn";
import { api } from "../../lib/apiClient";
import type { HelperState } from "../../lib/helper/helperStatus";
import { acquisitionReadinessOf, type AcquisitionReadinessView } from "../../lib/acquisitionReadiness";
import { readStoreIdentityBootstrap, type StoreIdentityBootstrap } from "../../lib/storeIdentityBootstrap";
import { GuidedAcquisitionRun } from "../acquisition/GuidedAcquisitionRun";
import { HelperStatusCard } from "./HelperStatusCard";

/**
 * <b>지금 동기화 for a channel whose reviews are read off the seller's own screen.</b>
 *
 * <p>The lane behind this button has been live-proven since 2026-09-12, and until now the only way to
 * start it was to ask the agent for it in a conversation. The channel screen — the one place a seller
 * goes to ask 「이 채널은 어떻게 가져오나요」 — said 「판매자가 직접 실행하는 수집 경로입니다」 and offered
 * nothing to press. This section is that press.
 *
 * <p><b>Three things must hold, and they are three different questions.</b> The account's own
 * preconditions are the backend's (`review-acquisition-readiness`); whether the 도우미 is installed,
 * running and paired is the seller's machine's, answered by the very card the 채널 연결 hub already
 * draws — mounted here rather than re-derived, so the two surfaces cannot disagree; and whether the
 * marketplace is logged in is nobody's until the run asks it.
 *
 * <p><b>That third one is why this section states a precondition in words instead of a badge.</b>
 * Checking the login would mean reading the marketplace on every render of a settings page. So the
 * panel says what to have open, the run discovers the truth, and a missing login comes back as its own
 * closed failure word — in the window while it is open, and in 수집 이력 afterwards.
 *
 * <p>Nothing here names the provider that carries the read, adds a schedule, or turns a page. One press
 * is one run: a second read needs a second press, which is what mounting the run component means.
 */
export function ReviewAcquisitionSection({
  accountId,
  onCompleted,
}: {
  accountId: string;
  /** The page reloads its history and summaries — a run that stored something changed both. */
  onCompleted: () => void;
}) {
  const [readiness, setReadiness] = useState<AcquisitionReadinessView | null>(null);
  const [readFailed, setReadFailed] = useState(false);
  // Each press is its own run. The key remounts the runner, which is what mints a new single-use ref;
  // 0 means nobody has pressed yet on this visit.
  const [runKey, setRunKey] = useState(0);
  // The 업체코드 the seller types when we cannot yet say which store this account is. It is the only
  // thing browser collection needs that the product had no place to receive without an API key.
  const [storeIdentity, setStoreIdentity] = useState("");
  const [savingIdentity, setSavingIdentity] = useState(false);
  const [identityError, setIdentityError] = useState<string | null>(null);
  /**
   * What the helper saw on the screen the seller had open, read over authenticated loopback after a run
   * that had no expectation to compare against. Null = we could not ask (no pairing, helper not there).
   */
  const [bootstrap, setBootstrap] = useState<StoreIdentityBootstrap | null>(null);

  // Reported by the card below — the one place this state is derived. Null until it has answered,
  // and null blocks the press: a button that fails is worse than one that is briefly disabled.
  const [helper, setHelper] = useState<HelperState | null>(null);

  useEffect(() => {
    let live = true;
    setReadFailed(false);
    api
      .getReviewAcquisitionReadiness(accountId)
      .then((r) => {
        if (live) setReadiness(r);
      })
      .catch(() => {
        if (live) setReadFailed(true);
      });
    return () => {
      live = false;
    };
  }, [accountId]);

  const gate = acquisitionReadinessOf(readiness, helper);

  const completed = useCallback(() => {
    onCompleted();
  }, [onCompleted]);

  /**
   * A run that could not say which store it was looking at is not a failure to report — it is the first
   * half of telling us. Ask the helper what it saw, once the run has finished and only while the account
   * still has no identity of its own.
   */
  useEffect(() => {
    if (runKey === 0 || readiness?.state !== "STORE_IDENTITY_UNKNOWN") return;
    let live = true;
    // Ask at once and then keep asking: the run may still be closing its tab when this mounts, and a
    // seller who has just watched it finish should not wait out a poll interval to be asked one question.
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
  }, [runKey, readiness?.state]);

  /** Confirm the store, save it, and start a fresh run — one explicit press, never a silent retry. */
  const confirmStore = useCallback(
    (value: string) => {
      setSavingIdentity(true);
      setIdentityError(null);
      api
        .setStoreIdentity(accountId, value)
        .then((next) => {
          setReadiness(next);
          setBootstrap(null);
          // A new run, because the ref the last one spent is single-use and this is a new decision.
          setRunKey((k) => k + 1);
        })
        .catch(() => setIdentityError("스토어를 저장하지 못했습니다. 다시 확인해 주세요."))
        .finally(() => setSavingIdentity(false));
    },
    [accountId],
  );

  // A channel with no screen read has nothing to say here at all. Drawing the section and then
  // explaining why it is empty would put a 「가져오기」 heading on every channel that cannot.
  if (readiness?.state === "CHANNEL_NOT_SUPPORTED") return null;
  // A failed read is not a missing capability: say nothing rather than draw a button whose
  // preconditions are unknown.
  if (readFailed) return null;

  return (
    <Section title="상품평 가져오기">
      <div className="space-y-4">
        <p className="break-keep text-sm text-muted">
          쿠팡은 상품평을 가져오는 판매자 API가 없어서, 열려 있는 판매자 화면을 읽어 옵니다. 쿠팡 판매자
          페이지에 로그인한 뒤 상품평 목록을 열어 두고 아래 버튼을 눌러 주세요.
        </p>

        {/* The 도우미 line, from the same component and the same words the 채널 연결 화면 uses. */}
        <div className="rounded-xl border border-line bg-surface">
          <HelperStatusCard naverHealth={null} onState={setHelper} />
        </div>

        {gate.blockedKo ? (
          <div className="flex flex-wrap items-center gap-3">
            <p className="break-keep text-sm text-warn" role="status" data-testid="acquisition-blocked">
              {gate.blockedKo}
            </p>
            {gate.action ? (
              <BtnLink to={gate.action.to} size="sm" variant="outline">
                {gate.action.label}
              </BtnLink>
            ) : null}
          </div>
        ) : null}

        {/*
          **The one fact browser collection needs, asked for where it is needed.**

          업체코드 says WHICH STORE this account is; an API key says we may call the API as it. They were
          in one form, and its three fields are all required — so a seller who wanted only screen
          collection had to go and issue OpenAPI keys to tell us their store code. This asks for the
          fact itself. Nothing here sends, validates against, or implies an API credential.
        */}
        {/*
          **스토어 확인 필요 — not a failure.** The first bounded run had nothing to compare against, so it
          read no row and stopped; what it did establish is which store was on the screen. One explicit
          press confirms it, saves it, and starts a fresh single-use run. There is no silent retry and no
          schedule: the press is the decision.
        */}
        {readiness?.state === "STORE_IDENTITY_UNKNOWN" && bootstrap?.state === "CANDIDATE" ? (
          <div className="rounded-xl border border-line bg-canvas p-4" data-testid="store-confirm">
            <p className="break-keep text-sm text-ink">
              열려 있던 쿠팡 판매자 화면에서 <span className="font-semibold">{bootstrap.value}</span> 스토어를
              확인했습니다. 이 스토어의 상품평을 가져올까요?
            </p>
            <div className="mt-3 flex flex-wrap items-center gap-2">
              <Btn
                disabled={savingIdentity}
                onClick={() => confirmStore(bootstrap.value)}
                data-testid="store-confirm-cta"
              >
                이 스토어를 연결하고 리뷰 가져오기
              </Btn>
              <Btn size="sm" variant="ghost" onClick={() => setBootstrap({ state: "NONE" })}>
                다른 스토어입니다
              </Btn>
            </div>
            {identityError ? (
              <p className="mt-2 break-keep text-sm text-bad" role="alert">{identityError}</p>
            ) : null}
          </div>
        ) : null}

        {readiness?.state === "STORE_IDENTITY_UNKNOWN" && bootstrap?.state !== "CANDIDATE" ? (
          <form
            className="flex flex-wrap items-end gap-2"
            data-testid="store-identity-form"
            onSubmit={(e) => {
              e.preventDefault();
              if (savingIdentity || storeIdentity.trim() === "") return;
              setSavingIdentity(true);
              setIdentityError(null);
              api
                .setStoreIdentity(accountId, storeIdentity.trim())
                .then((next) => setReadiness(next))
                .catch(() => setIdentityError("업체코드를 저장하지 못했습니다. 다시 확인해 주세요."))
                .finally(() => setSavingIdentity(false));
            }}
          >
            {/*
              Ambiguity is said out loud rather than guessed at. Two codes on one screen means we could not
              read it cleanly, and a picker would hand that failure to the seller as a choice.
            */}
            {bootstrap?.state === "AMBIGUOUS" ? (
              <p className="basis-full break-keep text-sm text-muted" data-testid="store-ambiguous">
                화면에서 스토어 코드를 하나로 확정하지 못했습니다. 업체코드를 직접 입력해 주세요.
              </p>
            ) : null}
            <label className="flex flex-col gap-1 text-sm">
              <span className="font-semibold text-ink">쿠팡 업체코드</span>
              <input
                className="min-h-[40px] w-56 rounded-lg border border-line px-3 text-base"
                value={storeIdentity}
                onChange={(e) => setStoreIdentity(e.target.value)}
                placeholder="쿠팡 판매자 화면에 표시되는 코드"
                aria-label="쿠팡 업체코드"
              />
            </label>
            <Btn type="submit" size="sm" disabled={savingIdentity || storeIdentity.trim() === ""}>
              저장
            </Btn>
            {identityError ? (
              <p className="basis-full break-keep text-sm text-bad" role="alert">{identityError}</p>
            ) : null}
          </form>
        ) : null}

        {gate.noteKo ? (
          <p className="break-keep text-sm text-muted" data-testid="acquisition-note">{gate.noteKo}</p>
        ) : null}

        {runKey === 0 ? (
          <Btn
            disabled={!gate.canStart}
            onClick={() => setRunKey(1)}
            data-testid="acquisition-start"
          >
            {gate.startLabelKo ?? "지금 동기화"}
          </Btn>
        ) : (
          <div className="space-y-3">
            <GuidedAcquisitionRun
              key={runKey}
              path="WING_READ_ACTION_WINDOW"
              accountId={accountId}
              onCompleted={completed}
            />
            {/* A second read is a second press, deliberately: the ref this run spent is single-use and
                a button that silently re-ran would be a schedule with one step. */}
            <Btn
              size="sm"
              variant="outline"
              disabled={!gate.canStart}
              onClick={() => setRunKey((k) => k + 1)}
              data-testid="acquisition-restart"
            >
              다시 동기화
            </Btn>
          </div>
        )}
      </div>
    </Section>
  );
}
