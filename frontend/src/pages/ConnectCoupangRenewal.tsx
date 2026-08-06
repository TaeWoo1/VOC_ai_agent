import { useCallback, useEffect, useState } from "react";
import { useNavigate, useParams } from "react-router-dom";
import { api } from "../lib/apiClient";
import { COUPANG_RENEWAL_COPY as R } from "../lib/coupangRenewal";
import { CoupangRenewalFlow, type RenewalReplaceOutcome } from "../components/coupang/CoupangRenewalFlow";
import type { CredentialTemplateView } from "../lib/types";

/**
 * Guided Coupang credential renewal — the page entered from the "WING에서 API 키 갱신하기" CTA on an
 * already-CONNECTED, expiring account. It loads the credential template (read-only) and wires the pure
 * {@link CoupangRenewalFlow} to the backend atomic replace endpoint. It creates NO account and starts NO
 * sync: the existing account / orders / cursor are kept; only the credential row is replaced.
 *
 * Secrets flow straight from the masked form through {@link CoupangRenewalFlow} to `api.replaceCredential`;
 * they never enter this page's state, an event, or storage.
 */
export function ConnectCoupangRenewal() {
  const navigate = useNavigate();
  const { accountId } = useParams<{ accountId: string }>();

  const [template, setTemplate] = useState<CredentialTemplateView | null>(null);
  const [loading, setLoading] = useState(true);
  const [loadError, setLoadError] = useState(false);

  useEffect(() => {
    let alive = true;
    (async () => {
      try {
        const tmpl = await api.getCredentialTemplateStrict("COUPANG");
        if (!alive) return;
        setTemplate(tmpl);
        setLoadError(tmpl == null);
      } catch {
        if (alive) setLoadError(true);
      } finally {
        if (alive) setLoading(false);
      }
    })();
    return () => {
      alive = false;
    };
  }, []);

  const onReplace = useCallback(
    async (secrets: Record<string, string>, tokenExpiresAt: string | undefined): Promise<RenewalReplaceOutcome> => {
      if (!accountId || !template) return { status: "FAILED", reasonCode: null };
      const result = await api.replaceCredential(accountId, {
        connectorClass: template.connectorClass,
        authType: template.authType,
        secrets,
        ...(tokenExpiresAt ? { tokenExpiresAt } : {}),
      });
      return { status: result.status === "SUCCESS" ? "SUCCESS" : "FAILED", reasonCode: result.reasonCode };
    },
    [accountId, template],
  );

  const onDone = useCallback(() => {
    if (accountId) navigate(`/connect/channels/${accountId}`);
    else navigate("/connect");
  }, [navigate, accountId]);

  return (
    <div className="mx-auto max-w-2xl px-5 py-8">
      <h1 className="text-xl font-bold text-ink">{R.pageTitle}</h1>
      <p className="mt-2 text-base text-muted break-keep">{R.pageIntro}</p>

      <div className="mt-6">
        {loading ? (
          <p className="text-base text-muted" role="status">
            {R.pageTitle} 준비 중…
          </p>
        ) : loadError || !accountId ? (
          <>
            <p className="text-base text-bad" role="alert">
              {R.loadError}
            </p>
            <button type="button" className="btn-secondary mt-5" onClick={() => navigate("/connect")}>
              {R.back}
            </button>
          </>
        ) : (
          <CoupangRenewalFlow template={template} onReplace={onReplace} onDone={onDone} />
        )}
      </div>
    </div>
  );
}
