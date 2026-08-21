import { useEffect, useState } from "react";
import { api } from "../../lib/apiClient";
import type { CredentialDiagnosisView } from "../../lib/types";

/**
 * Why this connection is failing — shown only when it IS failing.
 *
 * The panel exists because one sentence was covering three completely different problems. Until now a
 * seller whose collection stopped saw the raw backend message, which for every key problem read
 * "자격 증명 복호화에 실패했습니다" — and the only action that sentence suggests is reconnecting.
 * On the canonical demo org that would have been wrong twice over: 128 consecutive Cafe24 failures
 * whose cause was a server-side key the seller has no access to, and which was fixed by a
 * configuration change with no marketplace action at all.
 *
 * So the split is by WHO can fix it. A server-side cause says so plainly and tells the seller they do
 * not need to do anything; only INVALID_CREDENTIAL and an unknown-cause row ask for the seller's time.
 *
 * Shows nothing at all when the credential opens. A healthy connection with a diagnostic panel
 * attached teaches sellers to read health as a warning.
 */
export function CredentialDiagnosisPanel({ accountId }: { accountId: string }) {
  const [diagnosis, setDiagnosis] = useState<CredentialDiagnosisView | null>(null);

  useEffect(() => {
    let live = true;
    api
      .getCredentialDiagnosis(accountId)
      // Fail quiet: this panel explains a failure, so it must never become one. If the diagnosis
      // itself cannot be read, the existing error line is still on screen.
      .then((d) => live && setDiagnosis(d))
      .catch(() => live && setDiagnosis(null));
    return () => {
      live = false;
    };
  }, [accountId]);

  if (!diagnosis || diagnosis.status === "OK" || diagnosis.status === "NO_CREDENTIAL") {
    return null;
  }

  // Whose problem it is. Getting this wrong in either direction is costly: telling a seller to
  // reconnect for a server fault wastes their time and fixes nothing, and telling them to wait for an
  // operator when their token really has expired leaves the connection dead.
  const serverSide =
    diagnosis.status === "NO_KEY_CONFIGURED" ||
    diagnosis.status === "KEY_NOT_AVAILABLE" ||
    diagnosis.status === "KEY_MISMATCH";

  return (
    <div
      className={`mt-4 rounded-xl px-4 py-3 text-base ${serverSide ? "bg-warn/10 text-warn" : "bg-bad/5 text-bad"}`}
      role="status"
    >
      <p className="font-semibold">
        {serverSide ? "SellerOps 서버 설정 문제입니다" : "자격 증명을 다시 확인해야 합니다"}
      </p>
      {diagnosis.remedy ? <p className="mt-1 text-sm">{diagnosis.remedy}</p> : null}
      {serverSide ? (
        <p className="mt-2 text-sm">
          판매자가 채널을 다시 연결해도 해결되지 않습니다. 담당자에게 이 화면을 알려 주세요.
        </p>
      ) : null}
    </div>
  );
}
