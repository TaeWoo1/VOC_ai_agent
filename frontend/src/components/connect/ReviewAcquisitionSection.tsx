import { useCallback, useEffect, useState } from "react";
import { Section } from "../Section";
import { Btn, BtnLink } from "../ui/Btn";
import { api } from "../../lib/apiClient";
import type { HelperState } from "../../lib/helper/helperStatus";
import { acquisitionReadinessOf, type AcquisitionReadinessView } from "../../lib/acquisitionReadiness";
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

        {runKey === 0 ? (
          <Btn
            disabled={!gate.canStart}
            onClick={() => setRunKey(1)}
            data-testid="acquisition-start"
          >
            지금 동기화
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
