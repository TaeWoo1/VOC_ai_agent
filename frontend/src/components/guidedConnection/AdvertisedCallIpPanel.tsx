import { useState } from "react";
import { copyText } from "../../lib/clipboard";
import { CALL_IP_COPY } from "../../lib/guidedConnection";

/**
 * Displays SellerOps' advertised fixed egress IP(s) — the value the seller registers in their NAVER
 * app's 'API 호출 IP' — with a copy affordance per IP. Shared by the text checklist, the guided
 * walkthrough, and the connection-test failure-recovery phases so every issuance path surfaces the same
 * guidance.
 *
 * <p>Two root causes are kept DISTINCT (see {@link CALL_IP_COPY}): an EMPTY `ips` means SellerOps has not
 * configured an egress IP yet (our side — never phrased as the seller's failure, never a fabricated value);
 * a non-empty `ips` means the seller still has to register the shown value in NAVER (their action).
 *
 * <p>When `showRegisteredAck` is set (the failure-recovery phases) a seller who ALREADY registered a call IP
 * — including one given out of band while our advertised IP is still unset — can acknowledge it and continue.
 * The acknowledgment is purely local (it stores NO IP) and is NEVER a gate: the connection test's order-access
 * probe stays the one authoritative check, so this only removes the "you must register first" nag, it never
 * asserts the IP actually works. Copy failures reveal the text rather than faking success (see the clipboard
 * util), so the seller can always select it manually.
 */
export function AdvertisedCallIpPanel({
  ips,
  showRegisteredAck = false,
}: {
  ips: readonly string[];
  /** Offer the "이미 API 호출 IP를 등록했어요" acknowledgment (failure-recovery contexts). Default off. */
  showRegisteredAck?: boolean;
}) {
  const [acknowledged, setAcknowledged] = useState(false);

  if (acknowledged) {
    return (
      <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-muted" role="status">
        {CALL_IP_COPY.acknowledgedNote}
      </p>
    );
  }

  // Advertised IP not configured yet (OUR side) — honest, never a fabricated value, never "you failed".
  if (ips.length === 0) {
    return (
      <div className="space-y-2 rounded-lg bg-canvas px-3 py-2" role="note" aria-label="호출 IP 미설정 안내">
        <p className="text-xs font-medium text-ink">{CALL_IP_COPY.advertisedUnsetTitle}</p>
        <p className="text-xs text-muted">{CALL_IP_COPY.advertisedUnsetBody}</p>
        {showRegisteredAck && <AlreadyRegisteredButton onAck={() => setAcknowledged(true)} />}
      </div>
    );
  }

  // Advertised IP is known — the remaining action is the seller registering it in NAVER.
  return (
    <div className="space-y-1 rounded-lg bg-canvas px-3 py-2" aria-label="등록할 고정 호출 IP">
      <p className="text-xs text-muted">{CALL_IP_COPY.registerTitle}</p>
      <ul className="space-y-1">
        {ips.map((ip) => (
          <CopyableIp key={ip} ip={ip} />
        ))}
      </ul>
      {showRegisteredAck && <AlreadyRegisteredButton onAck={() => setAcknowledged(true)} />}
    </div>
  );
}

function AlreadyRegisteredButton({ onAck }: { onAck: () => void }) {
  return (
    <button type="button" className="btn-ghost text-xs" onClick={onAck} data-testid="call-ip-already-registered">
      {CALL_IP_COPY.alreadyRegisteredCta}
    </button>
  );
}

function CopyableIp({ ip }: { ip: string }) {
  const [state, setState] = useState<"idle" | "copied" | "failed">("idle");

  const onCopy = async () => {
    const result = await copyText(ip);
    setState(result.ok ? "copied" : "failed");
  };

  return (
    <li className="flex items-center justify-between gap-3">
      <code className="select-all text-sm font-medium text-ink">{ip}</code>
      <button type="button" className="btn-ghost text-xs" onClick={onCopy}>
        {state === "copied" ? "복사됨" : state === "failed" ? "복사 실패 · 직접 선택" : "복사"}
      </button>
    </li>
  );
}
