import { Link } from "react-router-dom";
import { PageHead } from "../../components/ui/PageHead";
import { Section } from "../../components/ui/Section";
import { Disclosure } from "../../components/ui/Disclosure";
import { BtnLink } from "../../components/ui/Btn";

/**
 * 「reviewnary 도우미」 — install, start, update, remove (Local Helper Pilot Packaging v1).
 *
 * The pilot ships one thing: a macOS folder the operator hands the seller. This page says what it is,
 * what it does and does not do, and the four moments a seller meets it. It names no port, token,
 * carrier or profile; the only technical word on it is "macOS", because that is the support boundary and
 * hiding a boundary is how a Windows seller ends up downloading something that cannot run.
 */
export function ConnectHelper() {
  return (
    <div className="space-y-6">
      <PageHead
        title="reviewnary 도우미"
        description="판매자센터 화면과 함께 일할 때 필요한, 내 PC에서 조용히 돌아가는 작은 프로그램입니다."
        action={
          <BtnLink to="/connect" size="sm" variant="outline">
            채널 연결로
          </BtnLink>
        }
      />

      <Section title="무엇을 하나요">
        <ul className="space-y-1.5 text-ink">
          <li className="break-keep">판매자센터 화면을 내 PC에서 열고, 눌러야 할 곳을 표시하고, 내가 누른 결과를 확인합니다.</li>
          <li className="break-keep">네이버 로그인은 내가 직접 합니다. 한 번 로그인하면 이후 작업에서는 유지됩니다.</li>
          <li className="break-keep">
            대신 등록하거나 대신 보내지 않습니다 — 답변 등록 같은 마지막 단계는 언제나 내가 누릅니다.
          </li>
        </ul>
      </Section>

      <Section title="설치" hint="macOS 13 이상 · 이 파일럿은 Mac만 지원합니다">
        <ol className="space-y-2 text-ink">
          {[
            "담당자에게 받은 「reviewnary 도우미」 폴더를 엽니다.",
            "「reviewnary 도우미 설치.command」를 더블클릭합니다. 처음 열 때 Mac이 막으면 파일을 마우스 오른쪽 클릭 → 열기 → 열기.",
            // 비밀번호를 묻는 단계는 없습니다. 설치 파일은 그것을 묻지 않고(Helper Device Authentication v1이
            // 그 모델을 없앴습니다), 이 문장은 판매자가 뜨지 않는 창을 기다리게 만들던 안내였습니다.
            "이 화면(채널 연결)이 저절로 열립니다. 「도우미 연결」을 누르고, Mac에 뜨는 창에서 「허용」을 누릅니다.",
            "「이 기기 연결」을 누르면 끝입니다. 도우미에 비밀번호를 입력하지 않습니다 — 이 브라우저에서 이미 로그인한 계정에 이 Mac이 연결됩니다.",
          ].map((step, index) => (
            <li key={step} className="flex gap-2 break-keep">
              <span className="tabular-nums text-brand-700">{index + 1}.</span>
              {step}
            </li>
          ))}
        </ol>
        <p className="mt-3 break-keep text-sm text-muted">
          설치 뒤에는 Mac에 로그인할 때마다 저절로 시작됩니다. 따로 실행할 것이 없습니다.
        </p>
      </Section>

      <Section title="실행 필요라고 나올 때">
        <p className="break-keep text-ink">
          도우미가 꺼져 있다는 뜻입니다. Mac을 다시 시작했거나 로그아웃했다면 다시 로그인하면 시작됩니다. 그래도 그대로면
          설치 파일을 한 번 더 실행해 주세요 — 기기 연결과 네이버 로그인 상태는 그대로 유지됩니다.
        </p>
      </Section>

      <Section title="업데이트 필요라고 나올 때">
        <p className="break-keep text-ink">
          설치된 도우미가 이 화면보다 오래된 버전입니다. 담당자에게 새 버전 폴더를 받아 같은 「설치.command」를 다시 실행하면
          됩니다. 다시 연결할 필요는 없습니다.
        </p>
      </Section>

      <Section title="기기 연결 필요라고 나올 때">
        <p className="break-keep text-ink">
          도우미는 켜져 있지만 아직 이 계정에 연결되지 않았다는 뜻입니다. 채널 연결 화면에서 「이 기기 연결」을 한 번
          누르면 됩니다. 설정 › 연결된 기기에서 해제했거나, 다른 계정으로 로그인했을 때 나옵니다.
        </p>
      </Section>

      <Disclosure label="제거하려면">
        <p className="mt-2 break-keep text-sm text-muted">
          받은 폴더의 「reviewnary 도우미 제거.command」를 더블클릭합니다. 네이버 로그인 정보는 남겨 두므로 다시 설치하면
          이어서 쓸 수 있습니다.
        </p>
      </Disclosure>

      <p className="text-sm text-muted">
        연결 상태는 <Link to="/connect" className="text-brand-700 underline-offset-2 hover:underline">채널 연결</Link>에서 확인할 수 있습니다.
      </p>
    </div>
  );
}
