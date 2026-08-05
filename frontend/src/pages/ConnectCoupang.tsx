import { useCallback, useEffect, useRef, useState } from "react";
import { useNavigate } from "react-router-dom";
import { api } from "../lib/apiClient";
import { selectChannelAccount } from "../lib/channelConnection";
import { AdvertisedCallIpPanel } from "../components/guidedConnection/AdvertisedCallIpPanel";
import { SecureCredentialForm } from "../components/guidedConnection/SecureCredentialForm";
import type { ConnectionTestResultView, CredentialTemplateView } from "../lib/types";

/**
 * The first-time Coupang connection surface. It shows the official PREREQUISITES a new seller must
 * complete before connecting — issue the Coupang WING Open API key (access key / secret key / vendor
 * code), confirm the key has order-API access, and register the deployment's calling IP — then hosts
 * credential entry and the connection test.
 *
 * <p>Honest by construction:
 * <ul>
 *   <li>The advertised calling IP comes ONLY from the backend setup endpoint; an empty value shows
 *       generic guidance, never a fabricated IP (see {@link AdvertisedCallIpPanel}).</li>
 *   <li>Secrets flow straight from {@link SecureCredentialForm} to the backend Vault via
 *       {@code storeCredential} — never into local storage, a log, or an event.</li>
 *   <li>A successful test verifies the credential but does NOT claim a completed connection: Coupang
 *       (like NAVER) connects on a two-signal path — the first collected order sync completes it.</li>
 * </ul>
 *
 * <p>A page load is a 0-write operation: the seller account is created lazily only on an explicit
 * credential submit.
 */
export function ConnectCoupang() {
  const navigate = useNavigate();
  const [phase, setPhase] = useState<"loading" | "ready" | "unavailable">("loading");
  const [template, setTemplate] = useState<CredentialTemplateView | null>(null);
  const [coupangChannelId, setCoupangChannelId] = useState<string | null>(null);
  const [advertisedEgressIps, setAdvertisedEgressIps] = useState<readonly string[]>([]);
  const [busy, setBusy] = useState(false);
  const [testResult, setTestResult] = useState<ConnectionTestResultView | null>(null);
  const accountIdRef = useRef<string | null>(null);
  const inFlightRef = useRef(false);

  // Deployment-global setup (advertised calling IP). Isolated + fail-safe: a failure here must never
  // break the page — it then shows generic guidance, never a fabricated IP.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const setup = await api.getCoupangSetup();
        if (alive) setAdvertisedEgressIps(setup.advertisedEgressIps ?? []);
      } catch {
        if (alive) setAdvertisedEgressIps([]);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  // Resolve context — reads ONLY (Coupang channel + existing account + credential template). Never
  // creates an account, so a page load/refresh writes nothing.
  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const [channels, accounts, tmpl] = await Promise.all([
          api.getChannelsStrict(),
          api.getSellerAccountsStrict(),
          api.getCredentialTemplateStrict("COUPANG"),
        ]);
        if (!alive) return;
        const coupang = channels.find((c) => c.code === "COUPANG") ?? null;
        setCoupangChannelId(coupang?.id ?? null);
        const existing = coupang ? selectChannelAccount(accounts, coupang.id) : null;
        accountIdRef.current = existing?.id ?? null;
        setTemplate(tmpl);
        setPhase(tmpl && coupang ? "ready" : "unavailable");
      } catch {
        if (alive) setPhase("unavailable");
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onSubmit = useCallback(
    async (secrets: Record<string, string>) => {
      if (!template || inFlightRef.current) return;
      inFlightRef.current = true;
      setBusy(true);
      setTestResult(null);
      try {
        // Create the seller account lazily HERE — the first and only DB write, on an explicit action.
        let id = accountIdRef.current;
        if (!id) {
          if (!coupangChannelId) throw new Error("no COUPANG channel");
          const created = await api.createApiChannelAccount(coupangChannelId);
          id = created.id;
          accountIdRef.current = id;
        }
        await api.storeCredential(id, {
          connectorClass: template.connectorClass,
          authType: template.authType,
          secrets,
        });
        setTestResult(await api.testConnection(id));
      } catch {
        // A transport/store failure — a safe generic message; never echo the secret or a raw error.
        setTestResult({
          sellerAccountId: accountIdRef.current ?? "",
          status: "FAILED",
          checkedAt: "",
          message: "연결 정보를 저장하지 못했습니다. 잠시 후 다시 시도해 주세요.",
          reasonCode: null,
        });
      } finally {
        inFlightRef.current = false;
        setBusy(false);
      }
    },
    [template, coupangChannelId],
  );

  if (phase === "loading") {
    return (
      <div className="mx-auto max-w-2xl px-5 py-10">
        <p className="text-base text-muted">쿠팡 연결 준비 정보를 불러오는 중…</p>
      </div>
    );
  }

  if (phase === "unavailable") {
    return (
      <div className="mx-auto max-w-2xl px-5 py-10">
        <h1 className="text-xl font-bold text-ink">쿠팡 연결</h1>
        <p className="mt-3 text-base text-muted">
          지금은 쿠팡 API 연결을 준비할 수 없습니다. 잠시 후 다시 시도해 주세요.
        </p>
        <button type="button" className="btn-secondary mt-5" onClick={() => navigate("/connect")}>
          채널 목록으로
        </button>
      </div>
    );
  }

  const success = testResult?.status === "SUCCESS";

  return (
    <div className="mx-auto max-w-2xl px-5 py-8" data-testid="connect-coupang">
      <h1 className="text-xl font-bold text-ink">쿠팡 연결</h1>
      <p className="mt-2 text-base text-muted">
        쿠팡 판매자센터(쿠팡 윙)에서 발급한 Open API 키로 주문을 연동합니다. 아래 준비사항을 먼저 확인해 주세요.
      </p>

      <section className="mt-6" data-testid="coupang-prereqs" aria-label="쿠팡 연결 준비사항">
        <h2 className="text-base font-bold text-ink">연결 전 준비사항</h2>
        <ol className="mt-3 space-y-4">
          <li className="rounded-xl border border-line bg-canvas/40 p-4">
            <p className="font-semibold text-ink">1. 쿠팡 윙에서 Open API 키 발급</p>
            <p className="mt-1 text-sm text-muted">
              액세스 키(access key), 시크릿 키(secret key), 업체 코드(vendor ID) 세 가지가 필요합니다.
            </p>
          </li>
          <li className="rounded-xl border border-line bg-canvas/40 p-4">
            <p className="font-semibold text-ink">2. 주문 API 접근 권한 확인</p>
            <p className="mt-1 text-sm text-muted">
              발급한 키에 주문(발주서) 조회 권한이 포함되어 있어야 첫 주문 수집이 가능합니다.
            </p>
          </li>
          <li className="rounded-xl border border-line bg-canvas/40 p-4">
            <p className="font-semibold text-ink">3. API 호출 IP 등록</p>
            <p className="mt-1 text-sm text-muted">
              쿠팡은 등록된 호출 IP에서만 API 요청을 허용합니다. 아래 IP를 쿠팡 앱의 호출 IP에 등록해 주세요.
            </p>
            <div className="mt-3">
              <AdvertisedCallIpPanel ips={advertisedEgressIps} />
            </div>
          </li>
        </ol>
      </section>

      <section className="mt-8" aria-label="쿠팡 연결 정보 입력">
        <h2 className="text-base font-bold text-ink">연결 정보 입력</h2>
        <p className="mt-1 text-sm text-muted">
          입력한 키는 암호화되어 저장되고, 즉시 연결 확인(테스트)만 수행합니다. 주문 상태를 바꾸거나 어떤 것도 전송하지 않습니다.
        </p>
        <div className="mt-3">
          <SecureCredentialForm template={template!} onSubmit={onSubmit} submitting={busy} />
        </div>
      </section>

      {testResult && (
        <section className="mt-6">
          {success ? (
            <div
              className="rounded-xl border border-brand/40 bg-brand/5 p-4 text-base text-ink"
              data-testid="coupang-test-success"
            >
              <p className="font-semibold">연결 정보가 확인되었습니다.</p>
              <p className="mt-1 text-sm text-muted">
                첫 주문 수집이 완료되면 연결이 완료됩니다. (연결 확인만으로는 아직 완료 상태가 아닙니다.)
              </p>
              <button type="button" className="btn-primary mt-4" onClick={() => navigate("/connect")}>
                채널 목록으로
              </button>
            </div>
          ) : (
            <div
              className="rounded-xl border border-danger/40 bg-danger/5 p-4 text-base text-ink"
              data-testid="coupang-test-failed"
              role="alert"
            >
              <p className="font-semibold">연결을 확인하지 못했습니다.</p>
              <p className="mt-1 text-sm text-muted">{testResult.message}</p>
            </div>
          )}
        </section>
      )}
    </div>
  );
}
