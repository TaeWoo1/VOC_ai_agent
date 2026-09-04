import { useEffect, useMemo, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Btn, BtnLink } from "../ui/Btn";
import { Status, type StatusTone } from "../ui/Status";
import { useBridge } from "../../hooks/useBridge";
import { BRIDGE_TOKEN_KEY, bridgeHttpBase } from "../../lib/bridge/bridgeClient";
import { helperStatusOf, naverSessionOf, type HelperState } from "../../lib/helper/helperStatus";
import { relativeTime } from "../../lib/format";
import type { ConnectionStatusView } from "../../lib/types";

export const HELPER_GUIDE_PATH = "/connect/helper";
/** Where 「네이버 로그인」 goes: the guided run whose first step opens the seller's own NAVER window. */
export const NAVER_LOGIN_PATH = "/connect/review-history";

/**
 * The reviewnary 도우미 as the seller sees it on 채널 연결 (Local Helper Pilot Packaging v1).
 *
 * Two lines and at most one button each: the helper (연결됨 · 설치 필요 · 실행 필요 · 다시 연결 필요 ·
 * 업데이트 필요) and the NAVER login as the helper last observed it. Every word comes from
 * `lib/helper/helperStatus.ts`; this component only reads the bridge phase, one loopback health probe (for
 * the version) and the NAVER account's `sessionReadiness`, and draws.
 *
 * It does NOT auto-raise the approval dialog: `autoPair:false`. A native window appearing because a page
 * was opened is a surprise; here the seller presses 「도우미 연결」 first, and then the window is expected.
 */
export function HelperStatusCard({
  naverHealth,
  enabled = true,
}: {
  /** The NAVER account's connection status (carries `sessionReadiness`), or null when there is none. */
  naverHealth: ConnectionStatusView | null;
  enabled?: boolean;
}) {
  const navigate = useNavigate();
  const bridge = useBridge(enabled, { autoPair: false });
  const [agentVersion, setAgentVersion] = useState<string | null>(null);
  const [pairedBefore, setPairedBefore] = useState(false);

  useEffect(() => {
    try {
      setPairedBefore(!!window.localStorage.getItem(BRIDGE_TOKEN_KEY));
    } catch {
      setPairedBefore(false);
    }
  }, [bridge.state.phase]);

  // The version rides on the unauthenticated health probe; it is re-read whenever the phase settles so a
  // helper restarted into a new version is noticed without a page reload.
  useEffect(() => {
    // Only once something answered: a helper that is not there has no version to ask for.
    if (!enabled || bridge.state.phase === "connecting" || bridge.state.phase === "unreachable") {
      setAgentVersion(null);
      return;
    }
    let active = true;
    void fetch(`${bridgeHttpBase()}/bridge/health`)
      .then((r) => (r.ok ? r.json() : null))
      .then((body: { agentVersion?: unknown } | null) => {
        if (active) setAgentVersion(body && typeof body.agentVersion === "string" ? body.agentVersion : null);
      })
      .catch(() => {
        if (active) setAgentVersion(null);
      });
    return () => {
      active = false;
    };
  }, [enabled, bridge.state.phase]);

  const helper: HelperState = useMemo(
    () =>
      helperStatusOf({
        phase: bridge.state.phase,
        pairedBefore,
        agentVersion,
        maybeNeedsLocalNetworkAccess: bridge.state.maybeNeedsLocalNetworkAccess,
        pairingHint: bridge.state.pairingHint,
        attestedApproval: bridge.state.attestedApproval,
      }),
    [bridge.state, pairedBefore, agentVersion],
  );
  const naver = naverSessionOf(
    naverHealth?.sessionReadiness ?? null,
    naverHealth?.sessionObservedAt ? relativeTime(naverHealth.sessionObservedAt) : null,
  );

  const tone = (t: HelperState["tone"]): StatusTone => t;

  function helperAction() {
    if (!helper.action) return null;
    switch (helper.action.kind) {
      case "install":
      case "update":
        return (
          <BtnLink to={HELPER_GUIDE_PATH} size="sm" variant={helper.action.kind === "install" ? "solid" : "outline"}>
            {helper.action.label}
          </BtnLink>
        );
      case "connect":
        return (
          <Btn size="sm" onClick={() => bridge.requestPairing()} data-testid="helper-connect">
            {helper.action.label}
          </Btn>
        );
      case "retry":
        return (
          <div className="flex flex-wrap items-center gap-2">
            <Btn size="sm" variant="outline" onClick={() => bridge.retry()} data-testid="helper-retry">
              {helper.action.label}
            </Btn>
            <BtnLink to={HELPER_GUIDE_PATH} size="sm" variant="ghost">
              시작 방법 보기
            </BtnLink>
          </div>
        );
    }
  }

  return (
    <ul className="divide-y divide-line/70" data-testid="helper-status">
      <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
        <div className="min-w-0 flex-1">
          <div className="flex flex-wrap items-center gap-2">
            <p className="break-keep text-base font-semibold text-ink">reviewnary 도우미</p>
            <span data-testid="helper-state">
              <Status tone={tone(helper.tone)}>{helper.label}</Status>
            </span>
          </div>
          {helper.note ? <p className="mt-0.5 break-keep text-sm text-muted">{helper.note}</p> : null}
        </div>
        <div className="flex shrink-0 items-center">{helperAction()}</div>
      </li>
      {naverHealth ? (
        <li className="flex flex-wrap items-start justify-between gap-x-4 gap-y-2 px-4 py-3">
          <div className="min-w-0 flex-1">
            <div className="flex flex-wrap items-center gap-2">
              <p className="break-keep text-base font-semibold text-ink">네이버</p>
              <span data-testid="naver-session-state">
                <Status tone={naver.tone}>{naver.label}</Status>
              </span>
            </div>
            {naver.note ? <p className="mt-0.5 break-keep text-sm text-muted">{naver.note}</p> : null}
          </div>
          {naver.action ? (
            <div className="flex shrink-0 items-center">
              <Btn size="sm" onClick={() => navigate(NAVER_LOGIN_PATH)} data-testid="naver-login">
                {naver.action.label}
              </Btn>
            </div>
          ) : null}
        </li>
      ) : null}
    </ul>
  );
}
