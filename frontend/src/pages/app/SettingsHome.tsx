import { PageHead } from "../../components/ui/PageHead";
import { Panel } from "../../components/ui/Panel";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { useAuth } from "../../lib/auth";

/**
 * 설정 — workspace, alerts, and the account action.
 *
 * Deliberately small. Every row here is either a fact already in the session or a link to a screen
 * that exists; there are no toggles, because a switch that flips nothing is a promise the product
 * does not keep. New settings arrive when the capability behind them does.
 */
export function SettingsHome() {
  const { user, logout } = useAuth();
  const onDemoData = import.meta.env.VITE_USE_MOCKS === "true";

  return (
    <>
      <PageHead title="설정" description="워크스페이스와 연결 알림을 관리합니다." />

      <div className="grid gap-4 md:grid-cols-2">
        <Panel title="워크스페이스">
          <dl className="space-y-3">
            <div>
              <dt className="text-sm text-muted">스토어</dt>
              <dd className="mt-0.5 break-keep font-medium text-ink">
                {user?.orgName ?? "내 스토어"}
              </dd>
            </div>
            <div>
              <dt className="text-sm text-muted">사용 중인 계정</dt>
              <dd className="mt-0.5 break-keep font-medium text-ink">{user?.name ?? "운영자"}</dd>
            </div>
            {user?.email ? (
              <div>
                <dt className="text-sm text-muted">이메일</dt>
                <dd className="mt-0.5 break-all font-medium text-ink">{user.email}</dd>
              </div>
            ) : null}
            <div>
              <dt className="text-sm text-muted">표시 중인 자료</dt>
              <dd className="mt-0.5 break-keep font-medium text-ink">
                {onDemoData ? "데모 데이터" : "연결된 자료"}
              </dd>
            </div>
          </dl>
        </Panel>

        <Panel
          title="연결 알림"
          description="연결이 끊기거나 확인이 필요할 때 알려드립니다."
          action={
            <BtnLink to="/settings/alerts" size="sm" variant="outline">
              알림 보기
            </BtnLink>
          }
        >
          <p className="break-keep leading-relaxed text-muted">
            확인이 필요한 알림이 있을 때만 상단에 표시됩니다. 표시가 없다고 해서 모든 연결이
            정상이라는 뜻은 아니므로, 목록에서 직접 확인하실 수 있습니다.
          </p>
        </Panel>

        <Panel
          title="더 보기"
          description="주 메뉴에 두지 않은 화면입니다. 홈의 신호 카드에서도 열립니다."
        >
          <ul className="space-y-2">
            <li>
              <BtnLink to="/memory" size="sm" variant="outline">
                고객운영 메모리
              </BtnLink>
              <span className="ml-3 break-keep text-sm text-muted">반복되는 고객 문제와 그 근거</span>
            </li>
            <li>
              <BtnLink to="/reports" size="sm" variant="outline">
                리포트
              </BtnLink>
              <span className="ml-3 break-keep text-sm text-muted">수집된 자료로 만든 기간 요약</span>
            </li>
          </ul>
        </Panel>

        <Panel title="계정">
          <p className="break-keep leading-relaxed text-muted">
            이 브라우저에서 로그아웃합니다. 수집된 자료는 그대로 남습니다.
          </p>
          <div className="mt-4">
            <Btn variant="outline" size="sm" onClick={logout}>
              로그아웃
            </Btn>
          </div>
        </Panel>
      </div>
    </>
  );
}
