import { useEffect, useState } from "react";
import { PageHead } from "../../components/ui/PageHead";
import { ListBox } from "../../components/ui/Section";
import { ObjectRow } from "../../components/ui/ObjectRow";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { api } from "../../lib/apiClient";
import { relativeTime } from "../../lib/format";
import type { HelperDeviceView } from "../../lib/types";

/**
 * 설정 › 연결된 기기 (Helper Device Authentication v1).
 *
 * Every reviewnary 도우미 this organisation has linked, and one control per row: 연결 해제. Revoking is
 * immediate — the helper's next request is refused — and it is the seller's alone (a helper cannot reach this
 * list with its own token). No token, hash, port or address is ever shown: a row is a name the helper gave
 * about itself, when it was linked, and when it last worked.
 */
export function HelperDevices() {
  const [devices, setDevices] = useState<HelperDeviceView[] | null>(null);
  const [failed, setFailed] = useState(false);
  const [confirming, setConfirming] = useState<string | null>(null);
  const [busy, setBusy] = useState<string | null>(null);

  async function load() {
    try {
      setDevices(await api.listHelperDevices());
      setFailed(false);
    } catch {
      setFailed(true);
    }
  }

  useEffect(() => {
    void load();
  }, []);

  async function revoke(id: string) {
    setBusy(id);
    try {
      await api.revokeHelperDevice(id);
      setConfirming(null);
      await load();
    } catch {
      setFailed(true);
    } finally {
      setBusy(null);
    }
  }

  return (
    <div className="space-y-6">
      <PageHead
        title="연결된 기기"
        description="이 계정에 연결된 reviewnary 도우미입니다. 도우미는 비밀번호 대신 여기서 해제할 수 있는 연결로 일합니다."
      />
      {failed ? <p className="text-sm text-bad" role="alert">연결된 기기를 불러오지 못했습니다.</p> : null}
      {devices && devices.length === 0 && !failed ? (
        <ListBox ariaLabel="연결된 기기 없음">
          <div className="flex flex-wrap items-center justify-between gap-3 px-4 py-3">
            <p className="break-keep text-sm text-muted">아직 연결된 도우미가 없습니다. 채널 연결 화면에서 도우미를 연결하면 여기에 보입니다.</p>
            <BtnLink to="/connect" size="sm" variant="outline">채널 연결로 가기</BtnLink>
          </div>
        </ListBox>
      ) : null}
      {devices && devices.length > 0 ? (
        <ListBox ariaLabel="연결된 기기">
          <ul className="divide-y divide-line/70">
            {devices.map((d) => (
              <li key={d.id} data-testid="helper-device">
                <ObjectRow
                  name={d.deviceName}
                  facets={
                    <span className="break-keep">
                      {relativeTime(d.linkedAt)} 연결 · {d.lastUsedAt ? `${relativeTime(d.lastUsedAt)} 마지막 사용` : "아직 사용 안 함"}
                      {d.helperVersion ? ` · 도우미 ${d.helperVersion}` : ""}
                    </span>
                  }
                  action={
                    confirming === d.id ? (
                      <div className="flex flex-wrap items-center gap-2">
                        <span className="break-keep text-sm text-muted">해제하면 이 도우미는 바로 일을 멈춥니다.</span>
                        <Btn size="sm" variant="outline" onClick={() => setConfirming(null)} disabled={busy === d.id}>취소</Btn>
                        <Btn size="sm" onClick={() => void revoke(d.id)} disabled={busy === d.id} data-testid="revoke-confirm">해제 확인</Btn>
                      </div>
                    ) : (
                      <Btn size="sm" variant="outline" onClick={() => setConfirming(d.id)} data-testid="revoke">연결 해제</Btn>
                    )
                  }
                />
              </li>
            ))}
          </ul>
        </ListBox>
      ) : null}
    </div>
  );
}
