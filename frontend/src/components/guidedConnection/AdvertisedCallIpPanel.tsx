import { useState } from "react";
import { copyText } from "../../lib/clipboard";

/**
 * Displays SellerOps' advertised fixed egress IP(s) — the value the seller registers in their NAVER
 * app's 'API 호출 IP' — with a copy affordance per IP. Shared by the text checklist and the guided
 * walkthrough so both issuance paths surface the same guidance.
 *
 * <p>Fail-safe + honest: with no configured IP it shows a generic note and NEVER a fabricated value;
 * the IP is not a secret (a seller must register it publicly). Copy failures reveal the text rather
 * than faking success (see the clipboard util), so the seller can always select it manually.
 */
export function AdvertisedCallIpPanel({ ips }: { ips: readonly string[] }) {
  if (ips.length === 0) {
    return (
      <p className="rounded-lg bg-canvas px-3 py-2 text-xs text-muted" role="note">
        등록할 고정 IP가 아직 표시되지 않습니다. 준비되면 이 자리에 표시되며, 그때 애플리케이션의 'API 호출 IP'에
        등록하면 됩니다. 급하면 담당자에게 문의하세요.
      </p>
    );
  }
  return (
    <div className="space-y-1 rounded-lg bg-canvas px-3 py-2" aria-label="등록할 고정 호출 IP">
      <p className="text-xs text-muted">아래 고정 IP를 애플리케이션의 'API 호출 IP'에 등록하세요.</p>
      <ul className="space-y-1">
        {ips.map((ip) => (
          <CopyableIp key={ip} ip={ip} />
        ))}
      </ul>
    </div>
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
