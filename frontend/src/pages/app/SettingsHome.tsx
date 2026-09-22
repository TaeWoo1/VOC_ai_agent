import { PageHead } from "../../components/ui/PageHead";
import { ListBox } from "../../components/ui/Section";
import { ObjectRow } from "../../components/ui/ObjectRow";
import { Btn, BtnLink } from "../../components/ui/Btn";
import { useAuth } from "../../lib/auth";
import { KNOWLEDGE_NOUN } from "../../lib/knowledgeWords";

/**
 * 설정 — a grouped list, not a card wall (docs/reviewnary_design.md §7).
 *
 * Every row is a fact already in the session or a link to a screen that exists; there are no
 * toggles, because a switch that flips nothing is a promise the product does not keep. The difference
 * between AI 답변 스타일 and 운영 기준 is said in one line each: Knowledge decides WHAT is answered,
 * Style decides HOW.
 *
 * <b>The names come from `lib/knowledgeWords.ts`.</b> This screen was still calling one row
 * 「운영 정책 / 답변 기준」 after the screen it opens had become 「운영 기준」 — the same rows under two
 * names, with neither saying the other existed.
 */
export function SettingsHome() {
  const { user, logout } = useAuth();
  const onDemoData = import.meta.env.VITE_USE_MOCKS === "true";

  return (
    <div className="space-y-6">
      <PageHead title="설정" />

      <ListBox ariaLabel="워크스페이스">
        <dl className="grid gap-x-8 gap-y-3 px-4 py-4 sm:grid-cols-2">
          <Fact label="스토어" value={user?.orgName ?? "내 스토어"} />
          <Fact label="사용 중인 계정" value={user?.name ?? "운영자"} />
          {user?.email ? <Fact label="이메일" value={user.email} /> : null}
          <Fact label="표시 중인 자료" value={onDemoData ? "데모 데이터" : "연결된 자료"} />
        </dl>
      </ListBox>

      <ListBox ariaLabel="AI 답변과 운영 정책">
        <ul className="divide-y divide-line/70">
          <li>
            <ObjectRow
              name="회사 정보"
              facets={<span className="break-keep">어떤 회사인지 — AI가 답변 표현을 고를 때 참고합니다. 배송·환불·규격의 근거는 아닙니다</span>}
              action={<BtnLink to="/settings/company" size="sm" variant="outline">회사 소개 적기</BtnLink>}
            />
          </li>
          <li>
            <ObjectRow
              name={KNOWLEDGE_NOUN.operatingRules}
              facets={<span className="break-keep">무엇을 안내할지 — 배송·취소·교환·증빙처럼 상품과 무관한 답변의 근거</span>}
              action={<BtnLink to="/settings/policies" size="sm" variant="outline">기준 관리</BtnLink>}
            />
          </li>
          <li>
            <ObjectRow
              name="AI 답변 스타일"
              facets={<span className="break-keep">어떻게 말할지 — 말투·길이·인사·호칭. 답변 내용은 바꾸지 않습니다</span>}
              action={<BtnLink to="/settings/style" size="sm" variant="outline">스타일 설정</BtnLink>}
            />
          </li>
          <li>
            <ObjectRow
              name="리뷰 답변 문구"
              facets={<span className="break-keep">리뷰에 답변할 때 처음 채워지는 문구 — 칭찬·배송·불량 등 유형별로 회사 말투를 정합니다</span>}
              action={<BtnLink to="/settings/review-templates" size="sm" variant="outline">문구 설정</BtnLink>}
            />
          </li>
          <li>
            <ObjectRow
              name="연결 알림"
              facets={<span className="break-keep">연결이 끊기거나 확인이 필요할 때. 표시가 없다고 모든 연결이 정상은 아닙니다</span>}
              action={<BtnLink to="/settings/alerts" size="sm" variant="outline">알림 보기</BtnLink>}
            />
          </li>
        </ul>
      </ListBox>

      {/* 반복 문제 and 리포트 lived here as 「더 보기」 until the menu held them (Phase 4) — a second door to a menu
          entry is a second name for one place. What this screen gained instead is the one control the menu does not
          carry: the handed-over job itself — start, pause, stop — which until now only 오늘's status pill reached. */}
      <ListBox ariaLabel="자동 운영">
        <ul className="divide-y divide-line/70">
          <li>
            <ObjectRow
              name="고객 운영 관리"
              facets={<span className="break-keep">reviewnary가 주기적으로 확인하는 일 — 확인 대상·주기, 시작·일시정지·중지</span>}
              action={<BtnLink to="/customer-operations" size="sm" variant="outline">관리</BtnLink>}
            />
          </li>
        </ul>
      </ListBox>

      <ListBox ariaLabel="계정">
        <ul className="divide-y divide-line/70">
          <li>
            <ObjectRow
              name="연결된 기기"
              facets="이 계정에 연결된 reviewnary 도우미 — 비밀번호 대신 쓰는 연결이고, 여기서 해제할 수 있습니다"
              action={<BtnLink to="/settings/devices" size="sm" variant="outline">기기 보기</BtnLink>}
            />
          </li>
          <li>
            <ObjectRow
              name="계정"
              facets="이 브라우저에서 로그아웃합니다. 수집된 자료는 그대로 남습니다."
              action={<Btn variant="outline" size="sm" onClick={logout}>로그아웃</Btn>}
            />
          </li>
        </ul>
      </ListBox>
    </div>
  );
}

function Fact({ label, value }: { label: string; value: string }) {
  return (
    <div>
      <dt className="text-sm text-muted">{label}</dt>
      <dd className="mt-0.5 break-all font-medium text-ink">{value}</dd>
    </div>
  );
}
