import { useCallback, useEffect, useMemo, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { Btn, BtnLink } from "../ui/Btn";
import { Status, type StatusTone } from "../ui/Status";
import { useBridge } from "../../hooks/useBridge";
import { BRIDGE_TOKEN_KEY, bridgeHttpBase } from "../../lib/bridge/bridgeClient";
import { api } from "../../lib/apiClient";
import { helperStatusOf, naverSessionOf, type DeviceLinkWord, type HelperState } from "../../lib/helper/helperStatus";
import { relativeTime } from "../../lib/format";
import type { ConnectionStatusView } from "../../lib/types";

export const HELPER_GUIDE_PATH = "/connect/helper";
/** Where 「네이버 로그인」 goes: the guided run whose first step opens the seller's own NAVER window. */
export const NAVER_LOGIN_PATH = "/connect/review-history";

/** The helper's own answer about its account link (`GET /bridge/device/status`), reduced to one word. */
function deviceWordOf(body: { linked?: unknown; linking?: unknown } | null): DeviceLinkWord {
  if (!body) return "unknown";
  if (body.linked === true) return "linked";
  switch (body.linking) {
    case "pending":
      return "linking";
    case "denied":
    case "expired":
    case "unreachable":
      return body.linking;
    default:
      return "unlinked";
  }
}

function pairingBearer(): string | null {
  try {
    return window.localStorage.getItem(BRIDGE_TOKEN_KEY);
  } catch {
    return null;
  }
}

/**
 * The reviewnary 도우미 as the seller sees it on 채널 연결 (Local Helper Pilot Packaging v1 + Helper Device
 * Authentication v1).
 *
 * Two lines and at most one button each: the helper (연결됨 · 설치 필요 · 실행 필요 · 다시 연결 필요 ·
 * 업데이트 필요 · 기기 연결 필요) and the NAVER login as the helper last observed it. Every word comes from
 * `lib/helper/helperStatus.ts`; this component only reads the bridge phase, one loopback health probe (for
 * the version), the helper's own link status once paired, and the NAVER account's `sessionReadiness`, and draws.
 *
 * 「이 기기 연결」 is the whole device grant from the seller's side: the paired helper asks the server for a
 * code, this page hands that code to the server with the seller's OWN session, and the helper collects its
 * token. Nothing is typed, and no password is involved anywhere.
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
  const [device, setDevice] = useState<DeviceLinkWord | undefined>(undefined);
  const [linkError, setLinkError] = useState<string | null>(null);
  const paired = enabled && bridge.state.phase === "paired";
  const mounted = useRef(true);
  useEffect(() => {
    mounted.current = true;
    return () => {
      mounted.current = false;
    };
  }, []);

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

  const readDevice = useCallback(async (): Promise<DeviceLinkWord> => {
    const bearer = pairingBearer();
    if (!bearer) return "unknown";
    try {
      const r = await fetch(`${bridgeHttpBase()}/bridge/device/status`, { headers: { Authorization: `Bearer ${bearer}` } });
      if (!r.ok) return "unknown";
      return deviceWordOf((await r.json()) as { linked?: unknown; linking?: unknown });
    } catch {
      return "unknown";
    }
  }, []);

  // Once paired, ask the helper whether it is linked to the account; while a link is in flight (or the helper
  // has not answered yet), keep asking. The helper is the source of truth for the word — this page only
  // forwards a code and waits.
  const deviceRef = useRef<DeviceLinkWord | undefined>(undefined);
  deviceRef.current = device;
  useEffect(() => {
    if (!paired) {
      setDevice(undefined);
      return;
    }
    let active = true;
    const tick = () => {
      void readDevice().then((word) => {
        if (active) setDevice(word);
      });
    };
    tick();
    // Fast while something is in flight; slow but never silent once linked, so a revoke made in 설정 (or on
    // another browser) turns this card back into 기기 연결 필요 without a reload.
    let beat = 0;
    const interval = setInterval(() => {
      beat += 1;
      const word = deviceRef.current;
      if (word === "linking" || word === "unknown") tick();
      else if (beat % 5 === 0) tick();
    }, 2000);
    return () => {
      active = false;
      clearInterval(interval);
    };
  }, [paired, readDevice]);

  async function linkThisDevice() {
    const bearer = pairingBearer();
    if (!bearer) return;
    setLinkError(null);
    setDevice("linking");
    type LinkStart = { ok?: unknown; userCode?: unknown; reason?: unknown };
    let start: LinkStart | null = null;
    try {
      const r = await fetch(`${bridgeHttpBase()}/bridge/device/link`, {
        method: "POST",
        headers: { Authorization: `Bearer ${bearer}`, "Content-Type": "application/json" },
        body: "{}",
      });
      start = r.ok ? ((await r.json()) as LinkStart) : null;
    } catch {
      start = null;
    }
    if (!mounted.current) return;
    if (!start) {
      setDevice("unreachable");
      return;
    }
    if (start.ok !== true) {
      // busy: a grant is already pending — keep watching; already_linked: re-read; unreachable: say so.
      setDevice(start.reason === "unreachable" ? "unreachable" : start.reason === "already_linked" ? "unknown" : "linking");
      return;
    }
    if (typeof start.userCode !== "string") {
      setDevice("unreachable");
      return;
    }
    try {
      await api.approveHelperDevice(start.userCode);
    } catch {
      if (!mounted.current) return;
      setLinkError("이 계정으로 연결을 승인하지 못했습니다. 다시 로그인한 뒤 시도해 주세요.");
      setDevice("expired");
      return;
    }
    // The helper collects its token on its next poll; the status loop above notices.
  }

  const helper: HelperState = useMemo(
    () =>
      helperStatusOf({
        phase: bridge.state.phase,
        pairedBefore,
        agentVersion,
        maybeNeedsLocalNetworkAccess: bridge.state.maybeNeedsLocalNetworkAccess,
        pairingHint: bridge.state.pairingHint,
        attestedApproval: bridge.state.attestedApproval,
        device: paired ? device ?? "unknown" : undefined,
      }),
    [bridge.state, pairedBefore, agentVersion, device, paired],
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
      case "link":
        return (
          <Btn size="sm" onClick={() => void linkThisDevice()} data-testid="helper-link">
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
          {linkError ? <p className="mt-0.5 break-keep text-sm text-bad" role="alert">{linkError}</p> : null}
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
