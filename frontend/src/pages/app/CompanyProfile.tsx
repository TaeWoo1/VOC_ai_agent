import { useEffect, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { Panel } from "../../components/ui/Panel";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { api } from "../../lib/apiClient";
import { backendMessage } from "../../components/connect/channelShared";
import type { SellerProfileView } from "../../lib/types";

/** The backend's cap, repeated here only so the counter can say how much room is left. */
export const SUMMARY_MAX = 500;

export const SUMMARY_PLACEHOLDER =
  "전선몰딩과 전기자재를 제조·판매하며, 기업 고객과 시공업체 주문 비중이 높습니다.";

/**
 * 회사 정보 — who this company is, in the seller's own words (Seller Context v1-B).
 *
 * <b>One box, on purpose.</b> This is not an onboarding form: one paragraph the AI may read when it
 * chooses how to word a reply. The line this screen has to hold is the same one AI 답변 스타일 holds —
 * 답변 기준 decides WHAT is true, this decides who is speaking — and the copy says so, because a
 * seller who types 「당일 출고」 here is putting a fact in the wrong box.
 *
 * <b>Seller-authored only.</b> Nothing here suggests, generates or rewrites the text.
 */
export function CompanyProfile() {
  const [loaded, setLoaded] = useState<SellerProfileView | null>(null);
  const [loadError, setLoadError] = useState(false);
  const [summary, setSummary] = useState("");
  const [saving, setSaving] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [saved, setSaved] = useState(false);

  useEffect(() => {
    let active = true;
    void api
      .getSellerProfile()
      .then((profile) => {
        if (!active) return;
        setLoaded(profile);
        setSummary(profile.businessSummary ?? "");
      })
      .catch(() => active && setLoadError(true));
    return () => {
      active = false;
    };
  }, []);

  const submit = async () => {
    setSaving(true);
    setError(null);
    setSaved(false);
    try {
      const profile = await api.saveSellerProfile({ businessSummary: summary.trim() || null });
      setLoaded(profile);
      setSummary(profile.businessSummary ?? "");
      setSaved(true);
    } catch (e) {
      // The server's sentence: it names the count or the phrase that was refused.
      setError(backendMessage(e) ?? "저장하지 못했습니다. 입력하신 내용을 확인해 주세요.");
    } finally {
      setSaving(false);
    }
  };

  const overLength = summary.length > SUMMARY_MAX;

  return (
    <>
      <PageHead
        title="회사 정보"
        description="어떤 회사인지 한 문단으로 적어 두면, AI가 문의 답변의 표현과 관점을 고를 때 참고합니다."
      />

      {loadError ? (
        <Panel title="회사 정보">
          <p className="text-warn">회사 정보를 불러오지 못했습니다.</p>
        </Panel>
      ) : loaded === null ? (
        <Panel title="회사 정보">
          <p className="text-muted">불러오는 중…</p>
        </Panel>
      ) : (
        <div className="grid gap-4 lg:grid-cols-[minmax(0,1fr)_360px]">
          <Panel
            title="회사 소개"
            description={loaded.configured ? "저장된 소개입니다." : "아직 적지 않으셨습니다. 비워 두어도 답변은 지금처럼 작성됩니다."}
          >
            <dl className="mb-4">
              <dt className="text-sm text-muted">회사 이름</dt>
              <dd className="mt-0.5 font-medium text-ink">{loaded.name ?? "내 스토어"}</dd>
            </dl>
            <label className="block">
              <span className="text-sm font-medium text-ink">회사 소개</span>
              <textarea
                aria-label="회사 소개"
                className="mt-1 w-full rounded-lg border border-line px-3 py-2 text-base leading-relaxed text-ink"
                rows={5}
                value={summary}
                placeholder={SUMMARY_PLACEHOLDER}
                onChange={(e) => {
                  setSummary(e.target.value);
                  setSaved(false);
                }}
              />
            </label>
            <p className={`mt-1 text-sm ${overLength ? "text-warn" : "text-muted"}`} aria-live="polite">
              {summary.length} / {SUMMARY_MAX}자
            </p>
            {error ? <p className="mt-2 break-keep text-sm text-warn" role="alert">{error}</p> : null}
            {saved ? <p className="mt-2 text-sm text-good" role="status">저장했습니다.</p> : null}
            <div className="mt-4">
              <Btn onClick={submit} disabled={saving || overLength}>
                {saving ? "저장하는 중…" : "저장"}
              </Btn>
            </div>
          </Panel>

          <Panel title="이 소개는 어디에 쓰이나요">
            <ul className="space-y-2 break-keep text-sm text-ink">
              <li>문의 답변 초안을 쓸 때, 말투와 관점을 고르는 참고 자료로 씁니다. 예를 들어 기업 고객 비중이 높다고 적어 두면 그에 맞는 어조로 씁니다.</li>
              <li>AI 담당자에게 「우리 회사는 어떤 곳으로 등록돼 있어?」라고 물으면 이 글을 그대로 읽어 줍니다.</li>
              <li>
                배송 기간·환불·교환·A/S·상품 규격 같은 <strong>사실의 근거로는 쓰이지 않습니다.</strong> 그런
                내용은 <BtnLink to="/settings/policies" size="sm" variant="ghost">운영 정책 / 답변 기준</BtnLink>에 등록해 주세요.
              </li>
              <li>AI가 이 글을 대신 쓰거나 고치지 않습니다.</li>
            </ul>
          </Panel>
        </div>
      )}
    </>
  );
}
