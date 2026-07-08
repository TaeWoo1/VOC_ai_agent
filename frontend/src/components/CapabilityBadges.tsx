import { Section } from "./Section";
import { useApiData } from "../lib/useApiData";
import { api } from "../lib/apiClient";
import type { DataTypeCapability } from "../lib/types";

// Channel-generic capability badges: what auto-collect supports for a channel,
// with an honest verification status, plus the boundaries it deliberately does not
// cover. Self-fetching by channel code; fails closed (a calm line) so a dead
// backend never renders fake CONFIRMED badges.

const STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  CONFIRMED: { cls: "bg-good/10 text-good", label: "확인됨" },
  NEEDS_VERIFICATION: { cls: "bg-warn/10 text-warn", label: "확인 필요" },
  UNSUPPORTED: { cls: "bg-ink/5 text-muted", label: "미지원" },
};

function CapabilityBadge({ cap }: { cap: DataTypeCapability }) {
  const style = STATUS_STYLE[cap.verificationStatus] ?? STATUS_STYLE.UNSUPPORTED;
  return (
    <span className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-base font-semibold ${style.cls}`}>
      {cap.label}
      <span className="text-sm font-medium opacity-80">{style.label}</span>
    </span>
  );
}

export function CapabilityBadges({ channelCode }: { channelCode: string }) {
  const { data, loading, error } = useApiData(
    () => api.getChannelCapabilityOverview(channelCode),
    [channelCode],
  );

  return (
    <Section title="수집 가능 데이터">
      {loading ? (
        <p className="text-base text-muted">불러오는 중…</p>
      ) : error || !data ? (
        <p className="rounded-xl bg-bad/5 px-4 py-3 text-base text-bad">
          수집 지원 정보를 불러오지 못했습니다. 잠시 후 다시 시도해 주세요.
        </p>
      ) : !data.autoCollectSupported ? (
        <p className="text-base text-muted">
          이 채널은 자동 수집을 지원하지 않습니다. 파일 업로드를 이용해 주세요.
        </p>
      ) : (
        <div className="space-y-4">
          <div className="flex flex-wrap gap-2">
            {data.dataTypes.map((cap) => (
              <CapabilityBadge key={cap.dataType} cap={cap} />
            ))}
          </div>
          {data.unsupportedScopes.length > 0 ? (
            <div>
              <p className="mb-2 text-sm font-semibold text-muted">제외 범위</p>
              <div className="flex flex-wrap gap-2">
                {data.unsupportedScopes.map((scope) => (
                  <span
                    key={scope.code}
                    className="inline-flex items-center rounded-lg bg-canvas px-2.5 py-1 text-sm text-muted"
                  >
                    {scope.label}
                  </span>
                ))}
              </div>
            </div>
          ) : null}
        </div>
      )}
    </Section>
  );
}
