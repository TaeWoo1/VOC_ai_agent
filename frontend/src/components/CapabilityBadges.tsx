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

/** How each acquisition path reads to a seller. A method with no name here is not described at all. */
const METHOD_LABEL: Record<string, string> = {
  ACTION_WINDOW: "Action Window",
  API: "공식 API",
  EXPORT: "파일 내보내기",
  MANUAL: "직접 입력",
};

/**
 * A path's own evidence decides its wording AND its colour. An unproven route must not read stronger
 * than a connector capability that is merely unverified, so it borrows the same warn tone the
 * connector axis uses for `NEEDS_VERIFICATION`.
 */
const PATH_STATUS_STYLE: Record<string, { cls: string; label: string }> = {
  LIVE_PROVEN: { cls: "bg-good/10 text-good", label: "수집 지원" },
  NEEDS_VERIFICATION: { cls: "bg-warn/10 text-warn", label: "수집 지원·확인 필요" },
};

/** The first path we can actually describe. An unknown method or status is not rendered as a claim. */
function describedPath(cap: DataTypeCapability) {
  return (cap.acquisitionPaths ?? []).find(
    (path) => METHOD_LABEL[path.method] && PATH_STATUS_STYLE[path.verificationStatus],
  );
}

/**
 * One data type's badge.
 *
 * **Two questions, not one.** `supported` answers what the pull connector can serve; an acquisition
 * path answers how SellerOps actually gets the data. Coupang 상품평 is `supported: false` — Coupang
 * publishes no seller review API — and is collected anyway, through the Action Window. Rendering the
 * boolean alone printed 리뷰 미지원 on a page whose next panel counted 22 collected 상품평.
 *
 * So an acquisition path speaks **where the connector cannot** — only when `supported` is false. A type
 * its connector already serves keeps the connector's own verdict, because that verdict is then the
 * stronger fact and replacing 확인됨 with a route name would hide it. (No type is both today; the rule
 * is here so the first one that is does not silently lose its status.)
 *
 * The missing official API is not inferred from `supported: false` here — that fact belongs to the
 * connector, which publishes it as its own 제외 범위 note (Coupang: `REVIEW_API`), rendered below.
 */
function CapabilityBadge({ cap }: { cap: DataTypeCapability }) {
  const path = cap.supported ? undefined : describedPath(cap);
  if (path) {
    const pathStyle = PATH_STATUS_STYLE[path.verificationStatus];
    return (
      <span
        className={`inline-flex items-center gap-1.5 rounded-xl px-3 py-1.5 text-base font-semibold ${pathStyle.cls}`}
      >
        {cap.label}
        <span className="text-sm font-medium opacity-80">
          {pathStyle.label} · {METHOD_LABEL[path.method]}
        </span>
      </span>
    );
  }
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
