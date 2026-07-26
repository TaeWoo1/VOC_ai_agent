# Product Scope v1.7 — Drift Guard

SellerOps 제품 범위를 **하나의 합의된 정의로 고정**하기 위한 문서. 목적은 "무엇을 만드는가"보다
**"무엇을 지금 만들지 않는가"를 못 박는 것**이다. 멀티채널 확장(`docs/multi-channel-connector-roadmap.md`)이
구체화되면서 범위가 넓어지는 자연스러운 drift를 막는다.

> Status: SCOPE LOCK **v1.7** (planning only). 본 문서는 코드를 바꾸지 않으며, 라이브 접속/브라우저/업로드/
> DB 변경을 지시하지 않는다. 범위 변경은 이 문서를 고쳐 합의한 뒤에만 이뤄진다.
>
> v1.7 변경 (2026-07-26, 제품 오너 결정 반영): **Agent-first / pull-first 제품 정본 갱신.** 최신 제품 결정을
> 범위 계약에 반영한다. 아래 결정은 이전 서술 중 상충하는 부분을 **명시적으로 대체**한다(대체 대상은 삭제하지
> 않고 supersede로 표기). 능력·라이브 **비승격 규율(운영 지원 = 파일 업로드뿐, `honest_capability_wording`)은
> 불변**이며, 이 갱신은 어떤 채널 capability도 승격하지 않는다.
> ① **멀티채널 고객운영 Agent 재확인** — SellerOps는 NAVER 전용 리뷰 도구가 아니라 NAVER·Coupang·Cafe24·
>   ESM+·11번가·오늘의집 등으로 확장되는 멀티채널 고객운영 Agent다. 채널 집합은 **열려 있다**(§1.2 재확인,
>   canonical §1). NAVER는 wedge이지 제품의 경계가 아니다.
> ② **기본 UX = pull-first / exception-push** (§1.8 신설) — 사용자는 **필요할 때 다시 확인**한다. 일반 처리
>   결과는 재접속 시 또는 일일 요약으로 보고, **즉시 알림은 정해진 예외 트리거에만** 발생한다. **"대시보드를
>   매일 여는 1차 내비게이션으로" 두던 §1.1·§5·§8 서술은 pull-first + minimal Control Center로 대체된다**
>   (§1.1·§5 supersede 표기). Control Center는 **확인할 일·진행 중·완료 결과·연결 상태**만 갖는다.
> ③ **Session Readiness** (§1.8) — 채널별 세션 살아있음(로그인/2FA/만료)을 확인해, 정상 시 사용자는 **하루 한
>   번 로그인 상태만 확인**하고 나머지는 개입하지 않는다. §1.2 "예외에만 개입" 원칙에 이름과 **1순위**를 준다.
> ④ **답변 초안 = Company Voice 기반 AI, 발송 = 승인 후 Capability 기반** (§1.6·§5.2 갱신) — 리뷰·문의 답변
>   초안을 **기업별 말투(Company Voice)로 AI 생성**한다. **v1.4의 "결정론적 RULE_BASED·AI 없음" 잠금은 이
>   결정으로 대체된다.** MVP 기본은 **사용자 승인 후 발송**이고, 실제 발송은 **채널별 Capability(공식 API)가
>   지원할 때만** 수행하며 이때 **승인이 곧 human-checkpoint**다. 미지원 채널은 초안 또는 Action Window 최종
>   플랫폼 행동(운영자 수행)만 제공한다. **제한적 무승인 자동 발송은 후속 범위.** 발송 경계·"등록/발송 지원"
>   금지·검증 불가 채널 `UNVERIFIED`·별도 라이브 게이트(G3/G6)는 **그대로 유지**된다(§9, canonical §6). AI-voice
>   대체는 **초안 생성 메커니즘만** 바꾸며, R4 답변-제출 증거(abort-only·`UNVERIFIED`·gate-lock)를 승격하지 않는다.
> ⑤ **Product Knowledge Pack + Company Voice Profile** (§5.2 신설) — 상품명·옵션·설명·규격·사용/설치·주의·
>   상세페이지 텍스트/이미지·FAQ·매뉴얼·교환/환불/CS 정책·사용자 확인 지식을 입력으로 받는다. **상세 이미지에서
>   추출한 정보는 출처·신뢰도를 기록하고 확인 전에는 확정 사실로 쓰지 않는다.** Company Voice는 **사실 정보와
>   문체를 분리**한다.
> ⑥ **Issue Operations disclosure 대조** (§5.2) — 고객 불만과 상품 정보를 대조해 `NOT_DISCLOSED` /
>   `DISCLOSED_BUT_WEAK` / `DISCLOSED_AND_CLEAR` / `FAILURE_DESPITE_CORRECT_USE` / `UNKNOWN` 후보를 구분한다.
>   **이 결과로 고객 책임을 단정하거나 불만을 자동 기각하지 않는다.**
> ⑦ **stale 정정** — §1.5·§6.1·§7-15의 Action Window "미구현" 표기는 §4.1(NAVER 리뷰 Run 4 라이브 검증)에
>   맞춰 **"NAVER 리뷰 한정 라이브 검증됨(1계정·disposable·운영 지원 아님), 그 외 채널 미구현"**으로 정정한다
>   (canonical drift D6 해소). 운영 지원 = 파일 업로드뿐이라는 판정은 불변.
> ⑧ **FE 경계** — FE는 **Agent Control Plane projection/command adapter**이며 실행 순서·Journey 상태를 소유하지
>   않는다. 기존 FE 신규 기능은 **동결**하고 임시 호환 어댑터로만 유지한다(정본:
>   `docs/action-window-runtime/agent-first-ui-light-adr.md`, Frontend Spec 2026-07-26 갱신). 미래엔 공통
>   OperationView + HumanCheckpoint의 minimal Control Center로 교체한다.
>
> v1.6 변경 (2026-07-18, 제품 오너 결정 반영): **리뷰 답변 제출(Review Response Completion) — 가이드형
> Action Window 실행 v1 허용**(§5·§9, NAVER 전용). 승인된 답변에 한해 SellerOps가 판매자센터 창을
> **앞으로 가져오고 답변 입력란을 하이라이트하고 판매자의 제출을 관찰**하며, **로컬·운영자 보고·명시적
> 미검증(UNVERIFIED)** 결과를 기록한다. 경계(범위 밖으로 유지):
> ① **SellerOps는 쓰지·입력하지·제출하지 않는다** — 모든 마켓 행동은 운영자가 수행한다(감독형·관찰 전용).
> **무인/스케줄 자동화는 여전히 범위 밖.**
> ② **검증 없음.** NAVER REVIEW 공식 API가 없고 export에 답변 상태가 없어 게시 여부를 확인할 수 없다 —
> 제품은 이를 **암시하지 않는다**(`honest_capability_wording`). 결과는 **절대 "완료"/채널 주장 아님** —
> 운영자 자신의 행동에 대한 감사 기록일 뿐이다. **보고(`OPERATOR_REPORTED_SUBMITTED`/`SUBMISSION_ABORTED`)와
> 검증(`UNVERIFIED`)은 분리된 두 사실**로 항상 함께 표기하며 `UNVERIFIED` 단독 표기는 금지.
> ③ **좁은 예외 명시(§9):** 이 실행은 **사람이 수행하고 SellerOps는 관찰만** 한다. 제출은 **멱등이 아니므로**
> 바인딩 `submissionRef`는 **1회용**이고 재시도는 승인 head를 재확인하는 새 발급을 요구한다 — 런타임은
> 제출을 **자동 재구동하지 않는다**(중단 시 운영자에게 park).
> ④ **v1.4의 "답변은 클립보드로만"은 좁게 대체**된다: 답변은 여전히 운영자의 복사·붙여넣기로만 나가고,
> v1.6이 더하는 것은 그 수동 행위 **주변의 가이드와 미검증 로컬 기록**일 뿐 SellerOps가 구동하는 outbound
> 경로가 아니다.
> ⑤ 계약은 **`contracts/action-window/v2/` 병렬 신설**(protocol 2); v1은 **불변**이고 기존 v1 export 실행
> 기록은 마이그레이션 없이 유효하다. R4 §4 안전 경계와 ADR §4는 **가이드형 변형 행동**을 위해 개정한다
> (사람 수행/관찰 전용 예외 + 이중 게시 위험을 §4 자체에 기록). 라이브 실행은 **여전히 게이트 잠금** —
> 6번째 G3 스코프 `reply submission`과 1회용 G6가 필요하며 이 문서는 아무 게이트도 부여하지 않는다.
> (참고: 중간 단계였던 "로컬 전용 결과 기록"만의 v1.5는 잠기지 않았고, 이 가이드형 실행 결정으로 대체됨.)
>
> v1.4 변경 (2026-07-17, 제품 오너 결정 반영): **리뷰 답변 준비(Review Response Preparation) v1 허용**
> (§5) — `RESPONSE_NEEDED`로 기록된 리뷰에 한해 운영자가 **규칙 기반 추천 초안에서 시작해 직접 편집하고,
> 승인하고, 복사**한다. **마켓플레이스 쓰기는 여전히 범위 밖**(§2·§7-2·§9): 발송·게시·상태 변경 경로가
> 없고, 승인은 텍스트를 고정할 뿐 전송하지 않으며, 답변은 **운영자의 클립보드로만** 나간다. §1.6의
> "답변은 **초안·유형 제안까지**"를 리뷰에 적용한 것이며, §5 리뷰 트리아지 항목의 "초안 작성이 아니다"는
> **트리아지 자체**에 대한 규정으로 유지된다 — `RESPONSE_NEEDED`는 여전히 아무것도 약속하지 않고,
> 준비는 운영자가 명시적으로 시작할 때만 일어난다(트리아지가 초안을 유발하지 않는다).
> ② **AI 미포함**: 제공자는 결정론적 규칙 기반(`providerKind=RULE_BASED`)이며 `sellerops.reply.review.provider`
> 플래그로 게이트한다. `ai`는 예약·미구현이고, 라이브 LLM은 **별도 승인** 전까지 열리지 않는다(roadmap §9.2).
> ③ **§9 drift guard의 범위 확정 + 좁은 예외**: "출력은 enum/coarse bucket/boolean/16-hex 해시만"은
> **collector sanitized-output 계약**(Connector Roadmap §9)에 대한 규정이며, 판매자 대면 운영 화면에
> 대한 전면 금지가 아니다(현행 `InquiryDetail`이 이미 판매자 소유 원문을 노출). 답변 준비 화면은
> **redacted 본문**(`VocPreviewSanitizer` 전체 길이 적용 — 60자 미리보기 아님)을 노출할 수 있다. 예외는
> §9에 함께 기록한다. 현재 **NAVER 전용**.
>
> v1.3 변경 (2026-07-17, 제품 오너 결정 반영): **NAVER 리뷰 기반 attention 항목에 로컬 트리아지 허용**
> (§5) — 운영자가 `RESPONSE_NEEDED`/`MONITOR`/`NO_ACTION` 중 자신의 판단을 기록한다. 상태는 신호가 아니라
> **리뷰에 귀속**되고, **attention 카운트·심각도를 바꾸지 않으며**, **마켓플레이스 부수효과가 없다**
> — 로컬 기록일 뿐 초안 작성·발송·해결 처리가 아니므로 §5 "채널로의 쓰기 액션" 범위 밖 규정과 상충하지
> 않는다. 현재 NAVER 전용, Cafe24는 읽기 전용.
>
> v1.2 변경 (2026-07-08, 제품 오너 결정 반영): ① **SellerOps를 "SME 멀티채널 커머스 운영 에이전트"로
> 재정의**(§1.2) — 통합 셀러센터는 그 표면, 운영 루프 `OBSERVE→ACQUIRE→NORMALIZE→UNDERSTAND→PRIORITIZE→
> ACT→ESCALATE→RESUME`(§1.6)가 엔진 모델. agentic 가치는 무클릭 수집이 아니라 **사람 체크포인트 앞뒤에서
> 제거된 운영 작업 총량**으로 측정. ② **사업자·플랫폼 등록 결정**(§1.3) — 개인사업자 등록 진행, 등록 문의는
> 개발과 병행, 등록 대기로 개발 중단 없음, NAVER 솔루션 마켓은 장기·비선결. ③ **사용자 대면 자율 모드 4종**
> (§1.4: AUTOMATIC_OPERATION/ACTION_WINDOW/FILE_IMPORT/INTEGRATION_PENDING) — 마켓 전체가 아니라 (채널×
> DataType×조작) 단위 배정. ④ **기본 production 리뷰 수집 모드 = ACTION_WINDOW**(§1.5, 실제 창 직접 행동;
> Projection은 비-기본 렌더러로 유지). ⑤ **OperationRun 도메인 방향 기록**(§1.7, 구현 금지). 신규 정본
> 파생 문서: `docs/channel-capability-registration-matrix.md`, `docs/slices/action-window-v1.md`.
>
> v1.1 변경 (2026-07-07, 제품 결정 반영): ① 통합 셀러센터 정의·frontstage/backstage 구분 신설,
> ② Seller Track을 현재 우선순위로 확정하고 대상 사용자 갱신, ③ Manufacturer Track을 장기 방향으로
> 경계 지정(현 리디자인 혼입 금지), ④ 셀프서비스 온보딩을 목표 여정으로 명시(파일럿은 assisted 허용),
> ⑤ 낡은 채널 검증 서술 제거 — capability 현행은 Connector Roadmap §4.1로 전면 위임,
> ⑥ standalone AI 검색 제외·mock 분리·모바일 1급 범위 반영. 프론트 화면·IA의 정본은
> `docs/sellerops_frontend_spec.md`.

관련 문서: 수집 방식·채널별 전략·capability 현행표는 `docs/multi-channel-connector-roadmap.md`(이하
"Connector Roadmap")가 정본이다. 프론트 IA·화면·여정은 `docs/sellerops_frontend_spec.md`(이하 "Frontend
Spec")가 정본이다. 본 문서는 그 위의 **제품 범위 계약**이며, 용어(method/status/canonical record 등)는
Connector Roadmap 부록 A를 따른다.

---

## 1. SellerOps 최종 제품 정의

> **여러 커머스 플랫폼(NAVER·Cafe24·ESM+·SSG·오늘의집·Coupang·11번가)을 하나로 합친 것처럼 느껴지는
> 통합 셀러센터.** 채널별 최선의 수집 방식(Connector Roadmap §5)으로 주문·문의·리뷰·상품 데이터를
> 하나의 canonical 모델에 모아, 판매 운영자가 채널마다 로그인하지 않고 **한 화면에서 하루 운영을
> 보고 대응**할 수 있게 하는 multi-commerce 운영 플랫폼.

핵심 데이터(범위 내): **주문 / 문의 / 리뷰 / 상품 / 운영 리포트**. 이 다섯 외 데이터(광고·정산·물류
트래킹 등)는 v1 범위 밖.

SellerOps는 **수집 + 통합 + 운영 보조** 제품이다. 다음이 아니다:
- 광고/마케팅 자동화 도구가 아니다.
- ERP/정산/세금 시스템이 아니다.
- 채널 자체를 대체하는 판매 채널이 아니다(주문 생성·결제 처리 안 함).
- 범용 BI 도구가 아니다(임의 데이터 분석이 아니라, 위 다섯 데이터에 특화).

> **제품 정의(2026-07-08 재확정).** SellerOps는 단순 판매 도구·커넥터 콘솔·브라우저 클릭 봇이 **아니다.**
> SellerOps는 **SME(중소사업자) 멀티채널 커머스 운영 에이전트**로서: ① 채널·운영 상태를 관찰하고,
> ② **가장 안전한 공식 또는 사용자-통제 경로**로 데이터를 획득하고, ③ 채널·상품 전반에서 정규화·연결하고,
> ④ 이슈·반복 VOC·지연 작업·운영 리스크를 이해하고, ⑤ 처리 우선순위를 매기고, ⑥ **허용된 액션**을
> 실행하고, ⑦ **정책·동의·권한·판단이 걸린 순간에만** 사람 개입을 요청하고, ⑧ 그 체크포인트 이후
> **가능한 모든 다운스트림 작업을 이어서 완료**한다. **agentic 가치는 데이터 획득이 무클릭인지가 아니라,
> 사람 체크포인트 앞뒤에서 제거된 end-to-end 운영 작업의 총량으로 측정한다.** "통합 셀러센터"는 이 엔진의
> **표면**이며, 엔진 모델은 운영 루프(§1.6)다.

### 1.1 Frontstage / Backstage (제품 표면의 2층 구조)

- **Frontstage(전면 — 커머스 운영 표면)**: 대시보드, 주문·매출, 고객 응대(문의·리뷰), 상품 이슈,
  리포트. 제품 내비게이션의 1차 위계다.
  > **v1.7 supersede.** "셀러가 **매일 여는** 화면"이라는 프레이밍은 대체된다 — 기본 UX는 **pull-first /
  > exception-push**(§1.8)다. 사용자는 필요할 때 다시 확인하고, 일반 결과는 재접속·일일 요약으로 본다.
  > Frontstage는 "매일 여는 대시보드"가 아니라 **확인할 일·진행 중·완료 결과·연결 상태**만 있는 minimal
  > Control Center로 수렴한다(FE 경계: agent-first-ui-light-adr.md).
- **Backstage(후면 — 연결·수집 관리)**: 채널 연결, 자격증명, 동기화 설정, 수집 이력, 기간 지정 수집,
  파일 업로드, 연결 복구·알림. 온보딩·장애 복구 때 들어가는 관리 영역이며 2차 위계다.
  기존 커넥터·수집 화면(`/channels`, 채널 상세 등)은 이 영역으로 **재배치해 재사용**한다.

제품은 **두 Track**으로 동일 데이터 모델 위에서 갈라진다(§2, §3). 두 Track은 *수집·canonical 모델을
공유*하고, *상위 뷰/리포트만* 다르다. **현재 프론트 리디자인은 Seller Track 전용이다(§2·§3).**

### 1.2 가이드 연결·런타임 방향 (승인 원칙, 2026-07-07)

채널 연결은 비기술 오너·운영자에게 가장 큰 진입 장벽이다. 이를 낮추기 위한 제품 원칙을 범위
계약으로 고정한다. **아래는 방향·원칙이며, 어느 것도 "현재 구현됨"을 뜻하지 않는다** — 구현 현황은
§6(현재/미래 경계)과 Connector Roadmap §4.1을 따른다. 화면·상호작용 정본은 Frontend Spec의
"가이드 연결" 절, 런타임 경계 정본은 `docs/sellerops_local_agent_runtime_adr.md`(이하 Runtime ADR).

- **가이드 연결(Guided Connection)이 핵심 온보딩 원칙**이다. 각 채널 연결은 셀러가 스스로 밟을 수
  있도록 단계별로 안내하며, 목표 경험은 실제 커머스 플랫폼/API 센터 화면을 **SellerOps 안에서**
  게임 튜토리얼처럼 단계별로 보여주는 것이다.
- **최대 안전 자동화(maximum-safe-automation)**: 안전하고 결정적인 "편의 단계"(페이지 열기·이동,
  입력란으로 스크롤, 붙여넣기 위치 안내, 연결 테스트 실행 등)는 SellerOps가 자동화한다.
- **사람 통제 결정 경계(human-controlled boundary)**: 계정 선택, 권한·동의, 법적 의미, 의도가
  불확실한 판단은 **항상 사용자가 결정**한다. 로그인·2FA·CAPTCHA·계정 잠금 등 인증 단계는 **절대
  우회하지 않으며**, 사람이 수행한다. 에이전트는 자격증명을 입력하지 않는다.
- **로컬 에이전트의 독립 백그라운드 실행**: 로컬 에이전트는 SellerOps 브라우저 탭과 독립적으로
  동작한다. PC가 켜져 있는 동안 주기적으로 세션을 점검하고 설정된 수집 작업을 수행한다. 한 대의
  회사 PC가 여러 커머스 채널을 관리하며, 채널마다 연결/프로필이 격리된다.
- **Mac-first 파일럿 / Windows-target 배포**: 최초 개발·assisted 파일럿은 macOS, **예상 고객 배포
  대상은 Windows 회사 PC**다. 이는 *Mac-first 구현*이지 *Mac-only 제품 설계*가 아니다. OS 의존
  관심사(브라우저 런타임·자격증명 저장소·에이전트 수명/자동시작·로컬 설치)는 명시적 포트/어댑터
  뒤에 둔다(Runtime ADR).
- **런타임 티어**: **로컬 모드가 현재 방향**이고, 클라우드 관리형 모드는 **이후 제품 티어**다.
  공유 인터페이스·flow 정의는 클라우드 실행을 막지 않도록 설계하되, 클라우드 런타임은 지금 구현하지
  않는다.
- **인증·세션(선호 모드)**: 자동 로그인 동의를 1회 명시적으로 받고 → OS 자격증명 저장소에 안전 저장
  → 채널이 안전하게 지원할 때 자동 재로그인 시도. **폴백**: 전용 브라우저 세션/프로필을 보존하고,
  자동 로그인이 불가/실패하면 사용자에게 재로그인을 요청. 최초 설정 후에는 세션 만료·2FA·CAPTCHA·
  비밀번호 변경·신규 권한 동의·모호한 계정 선택 같은 예외에만 사용자 개입이 필요하도록 한다.
  **자동 로그인 동의 · 자격증명 저장 동의 · 마켓 권한 동의는 서로 분리된 명시적 동의**다.
  > **정직성 경계**: Device Vault(OS 자격증명 저장)·자동 자격증명 입력·자동 재로그인·Windows 지원·
  > 클라우드 런타임은 **아직 구현되지 않았다**. 브라우저 프로젝션은 **채널-중립 V0로 구현·커밋됨**
  > (`a0e4f6f`, 로컬 픽스처 전용)이나 **마켓 사용 미승인**이며 **라이브 리뷰 수집의 기본 모드가 아니다**
  > (기본은 Action Window, §1.5). 문서·UI에서 미구현·미승인을 구현·승인으로 표기하지 않는다
  > (§6·§6.1, Connector Roadmap §10).

### 1.3 사업자·플랫폼 등록 결정 (2026-07-08)

방향·결정을 범위 계약으로 기록한다(구현 지시 아님):
- 제품 오너는 **한국 개인사업자(sole-proprietor) 등록**을 진행한다.
- 공식 **셀러툴·API 파트너·플랫폼 등록 문의는 제품 개발과 병행**한다. **등록 대기 중 개발을 멈추지 않는다.**
- **NAVER 커머스 솔루션 마켓은 장기 옵션**으로 유지하며, **첫 유료 파일럿의 즉시 선결이 아니다.**
- **어떤 마켓도 실제 승인·검증 전에는 "공식 승인됨"으로 기술하지 않는다**(`honest_capability_wording`).
- 공식 등록은 온보딩·API 인가를 개선할 수 있으나, **공식 리뷰 API가 없는 채널에 리뷰 API를 자동으로
  제공하지 않는다** — 그런 채널의 리뷰는 여전히 ACTION_WINDOW 또는 FILE_IMPORT다(§1.4·§6).

### 1.4 사용자 대면 자율 모드 (User-facing autonomy modes)

각 **(채널 × DataType × 조작)** capability를 아래 4개 모드 중 하나로 셀러에게 표기한다. **마켓 전체에 한
자율 수준을 배정하지 않는다** — 같은 채널이 주문=AUTOMATIC, 리뷰=ACTION_WINDOW, 문의=INTEGRATION_PENDING
처럼 갈릴 수 있다. 모드 배정 진실은 `docs/channel-capability-registration-matrix.md`(§4.1 파생)를 따른다.

1. **AUTOMATIC_OPERATION** — 공식 API/웹훅/승인된 파트너 경로. 반복 사용자 조작 0. 백그라운드·스케줄 실행 허용.
2. **ACTION_WINDOW** — SellerOps가 실제 마켓 페이지 + 튜토리얼 오버레이를 준비, **사용자가 실제 마켓에서
   필요한 행동을 직접 수행**, 이후 다운스트림 자동(§1.5).
3. **FILE_IMPORT** — 사용자가 공식 export 파일 선택, 검증·다운스트림 자동.
4. **INTEGRATION_PENDING** — 공식 권한/정책/API 범위/기술 동작이 아직 미검증(약속 금지, 표기는 "미지원/확인 중").

> 이 모드는 셀러 대면 **표현 계층**이며, 수집 방식(method: API/EXPORT/MANUAL)·상태 4단계(연결 가능/구현됨/
> 라이브 검증/운영 지원)의 진실 원천은 Connector Roadmap §4.1이다. §11의 연결 모드(AUTOMATED/GUIDED/
> ASSISTED/MANUAL)와도 직교한다.

### 1.5 기본 production 리뷰 수집 모드 = ACTION_WINDOW

- **모든 마켓 채널의 기본 production 리뷰 수집 모드는 ACTION_WINDOW**다(계약: `docs/slices/action-window-v1.md`,
  Connector Roadmap §5.1). **v1.7 정정(drift D6):** Action Window는 **NAVER 리뷰 한정으로 라이브 검증됐다**
  (§4.1, Run 4 등 — **1계정·disposable dev backend, 운영 지원 아님**); **그 외 모든 채널·범용 렌더러는 여전히
  미구현**이다. 현재 운영 검증된(운영 지원) 수집은 여전히 §4.1 현행표가 말하는 것(**파일 업로드**)뿐이고,
  **어떤 문서·UI도 Action Window가 이미 셀러에게 상시 제공된다고 암시하지 않는다.** 설계상 실제 전용 Chrome 창을 열거나 앞으로 가져와, **실제 마켓 페이지를 사용자가 직접
  제어**하고, SellerOps는 그 위에 **선택적 게임-튜토리얼 오버레이**(다음 요소 하이라이트·다음 행동 설명·의미
  진행 추적)를 얹는다. **사용자가 실제 마켓 요소를 직접 클릭**하며, **SellerOps는 한 사용자 행동을 몰래
  마켓 클릭 시퀀스로 번역하지 않는다.** 안내는 켜고 끌 수 있고, 신뢰 부족 시 fail-closed로 사용자가 수동
  진행한다. **공식 다운로드가 시작된 뒤** SellerOps가 자동으로 감지·검증·임포트·dedup·매핑·분석·리포트한다.
- **Browser Projection 관계**: Browser Projection V0(`a0e4f6f`)은 **제거·폐기되지 않으며** 채널-중립 로컬
  뷰/입력 인프라로 유지된다. 단 **라이브 마켓 리뷰 수집의 기본 production 모드가 아니다.** "Projected
  Direct Action"(투사 화면 위 직접 행동)은 **채널별 정책·제품 리뷰 후 이후에 활성화될 수 있다.** **같은
  가이드 상태 엔진이 Action Window·Projection 두 렌더러를 지탱**하며 마켓 로직을 중복하지 않는다.
- **실제 마켓 Action Window 사용은 정책 게이트 뒤**에 유지된다(마켓 약관상 셀러-통제 오버레이·다운로드 감지
  허용 범위 해명 + 제품 오너 승인 선결 — Action Window 계약 §17, §7-16).

### 1.6 운영 루프 (Operating loop)

제품 운영 모델은 아래 루프다. **획득(ACQUIRE)은 한 레이어일 뿐**이다:

`OBSERVE → ACQUIRE → NORMALIZE → UNDERSTAND → PRIORITIZE → ACT → ESCALATE → RESUME`

SellerOps는 획득 외에도 아래를 **계속 자동화**한다: 중복 제거 · 상품 매핑 · 채널 귀속 · 이슈 분류 · 반복
VOC 감지 · 긴급/위험 점수 · **답변 초안(draft) 제안** · 지연 작업 감지 · 배정·후속 관리 · 일간·주간 리포트 ·
실패/부분 수집 후 복구.
- **사람 체크포인트는 전체 워크플로를 사용자에게 되돌리지 않는다.** 막힌 **그 조작만** 멈추고, 완료 후
  다운스트림 실행을 이어서 재개한다(ESCALATE→RESUME).
- **outbound 경계(정직, v1.7 갱신)**: ACT는 **허용된 액션**(획득·정규화·분류·점수·리포트·**Company Voice 기반
  답변 초안**)에 더해, **사용자 승인 후 발송**을 포함한다 — 단 **실제 발송은 채널별 Capability(공식 API)가 지원할
  때만** 수행하고, 그때 **승인이 곧 human-checkpoint**다(§5.2·§1.7 block ④). **미지원 채널은 초안 또는 Action
  Window 최종 플랫폼 행동(운영자 수행)**만 제공한다. **무승인 자동 발송은 여전히 범위 밖**이며(제한적 무승인
  자동 발송은 후속 범위), 운영 루프의 ACT를 무승인 outbound 자동 발송으로 확대 해석하지 않는다. 주문 상태 변경
  등 그 외 쓰기는 v1 범위 밖 유지(§2·§7). ~~"답변은 초안·유형 제안까지이고 발송은 escalation/미래"~~는 이 갱신으로
  대체된다.

### 1.7 Operation Run 도메인 방향 (기록만 — 구현 금지)

차기 제품-레벨 도메인 방향을 **구현 없이** 기록한다:
- `OperationRun` · `OperationTask` · `HumanCheckpoint` · `ExecutionMode` · `CapabilityPolicy` · `ResumeState`.
- 예시(배정): NAVER 주문 sync → automatic; NAVER 문의 sync → automatic; NAVER 리뷰 import → Action Window;
  ESM+ Gmarket 리뷰 import → Action Window; ESM+ Auction 리뷰 import → Action Window; 리뷰 정규화·분석 →
  의존성 완료 후 automatic.
- **이 방향을 이번에 코드로 확장하지 않는다.** 착수는 실행 모드·체크포인트가 안정된 뒤 별도 킥오프(§8 개발 순서).
- **carve-out (2026-07-26, 제품 오너 승인):** Acquisition Supervisor의 **순수 resolver/decide seam**은 이 lock의
  예외로 허용한다 — `ExecutionMode`(기존 Action Window enum) 재사용 + `(channel × capability) → mode` 해석 +
  Session Readiness 게이트 결정(DISPATCH / ASK_SELLER / HOLD)에 한한다. **무-live·무-durable·무-FE**: live
  dispatch 배선, backend 지속화, 신규 FE, `OperationRun`/`CapabilityPolicy` 본체는 **여전히 lock**이며 별도
  승인 대상이다. 구현: `contracts/acquisition/v1` + `collector/.../acquisition-supervisor.ts`(관찰 전용, 미배선).

### 1.8 기본 일상 경험 · 알림 · Session Readiness (v1.7 신설)

기본 UX를 **pull-first / exception-push**로 고정한다. 이는 §1.1의 "매일 여는 대시보드" 프레이밍을 대체한다.

- **pull-first**: 사용자는 **필요할 때 SellerOps를 다시 확인**한다. 일반 처리 결과(수집·정규화·분석 완료 등)는
  **재접속했을 때 또는 일일 요약**으로 본다. 제품은 상시 응시를 요구하지 않는다.
- **exception-push (즉시 알림 트리거, 명시)**: 아래에만 즉시 알림한다 — ① **새 문의**, ② **심각한 부정 리뷰**,
  ③ **급증(spike)**, ④ **안전·환불·법적 위험**, ⑤ **답변 지연**, ⑥ **중요한 수집 중단**. 그 외는 push하지 않는다.
  이는 기존 "사용자 설정 cadence prompting" 모델을 **대체**하는 정본 트리거 집합이다.
- **Session Readiness (하루 시작)**: 채널별 세션이 살아있는지(로그인/2FA/만료)를 확인하는 **per-channel readiness**.
  정상 시 사용자는 **하루 한 번 로그인 상태만 확인**하고 나머지는 개입하지 않는다. 예외(세션 만료·2FA·CAPTCHA·
  비밀번호 변경·신규 권한 동의·모호한 계정 선택)에만 개입한다(§1.2 "예외에만 개입" 원칙의 명명·1순위화).
- **minimal Control Center 방향**: 미래 FE는 **확인할 일 · 진행 중 · 완료 결과 · 연결 상태**만 있는 최소 화면으로
  수렴한다. 방향은 `docs/action-window-runtime/agent-first-ui-light-adr.md`(공통 OperationView + HumanCheckpoint).
  본 절은 방향을 고정하며 화면 산출은 별도 슬라이스다(구현 지시 아님).

---

## 2. 온라인 판매자 Track (Seller Track) — **현재 우선순위**

**현재 프론트 리디자인과 단기 로드맵은 이 Track 전용이다.**

**대상 사용자·역할**:
- **오너(대표)** — 중소 제조사/브랜드의 대표. 하루 현황과 "확인이 필요한 것"을 빠르게 보고,
  가벼운 확인·승인(모바일 포함)을 수행한다.
- **온라인 판매 운영 담당자** — 여러 판매자센터(NAVER 스마트스토어, Cafe24, ESM+ 등)를 동시에
  운영하는 실무자. 문의·리뷰 응대, 주문·매출 확인, 채널 연결·복구를 수행한다.

**해결 문제**: 채널마다 따로 로그인해 주문·문의·리뷰를 확인·대응하는 분산 운영을, 한 곳으로 통합.

**핵심 가치**: *운영(operations)* — "지금 내가 대응해야 할 것"의 통합 인박스.

**목표 온보딩(셀프서비스)**: 가입 → 워크스페이스/회사 설정 → 채널 연결 → 첫 동기화 →
스케줄·알림 설정 → 대시보드. **첫 파일럿은 assisted 온보딩(운영자가 대신 설정)을 허용**하되,
목표 사용자 여정은 셀프서비스이며 assisted 절차가 제품 요구사항으로 굳지 않게 한다
(여정 상세는 Frontend Spec §4).

범위 내(v1):
- 채널 통합 **주문** 목록/상태 조회.
- 채널 통합 **문의(CS)** 조회 — 응답 필요 항목 식별.
- 채널 통합 **리뷰** 조회 — 부정/주의 리뷰 식별(기존 attention/priority 체인 재사용).
- org 단위 멀티채널 연결(한 org이 여러 채널 계정 보유) + 셀프서비스 온보딩 표면.
- 운영 대시보드(§5): 채널 횡단 "할 일/주의" 뷰.

범위 밖(v1, Seller Track):
- 채널로의 **쓰기**(문의 답변 전송, 주문 상태 변경 등 outbound). v1은 **읽기·식별·우선순위**까지.
- 자동 응답/자동 매크로.
- 재고/가격 동기화.

---

## 3. 제조사 Track (Manufacturer Track) — **장기 방향 (현 리디자인 범위 밖)**

> **경계 규칙 (v1.1).** Manufacturer VOC Track은 장기 제품 방향으로 유지하되, **현재 Seller Track
> 프론트 리디자인에 혼입하지 않는다.** Seller Track의 IA·내비게이션·화면에 제조사 모니터링
> 뷰를 끼워 넣지 않으며, Track 2 착수는 별도 킥오프로만 한다. 아래 v1 서술은 그 장기 범위의
> 기록이다.

**대상**: 자사 제품이 여러 채널·여러 판매처에서 팔리는 제조사/브랜드.

**해결 문제**: 자사 제품이 채널 전반에서 **어떻게 평가받는지**를 한눈에 모니터링.

**핵심 가치**: *인텔리전스(intelligence)* — "내 제품이 시장에서 어떻게 보이는가"의 통합 모니터링.

범위 내(v1):
- 제품(또는 제품군) 단위 **리뷰 모니터링** — 채널 횡단 집계.
- 시계열 평판 추적(리뷰 추세·주의 신호) — 기존 recency/attention 체인 위에.
- 부정/반복 불만 클러스터의 식별(운영자 surface; 소비자-facing 아님 — `consumer_safety_contract` 준수).

범위 밖(v1, Manufacturer Track):
- 경쟁사 제품 모니터링(자사 제품에 한정).
- 소비자-facing 발행물 자동 생성(별도 Instagram/cardnews 트랙이 이미 있음 — 혼입 금지).
- 채널별 매출/정산 분석.

> **두 Track 공통 원칙**: 둘 다 **같은 canonical review/inquiry/order 모델**을 읽는다. Track 차이는
> *집계 단위와 뷰*뿐이다(Seller=채널/주문 중심, Manufacturer=제품/평판 중심). 두 Track을 위해 수집
> 코어를 분기시키지 않는다.

---

## 4. 공통 데이터 모델 방향

원칙: **채널이 늘어도, Track이 둘이어도, canonical 스키마와 dedup 규칙은 불변.**

- canonical 적재 단위는 기존 `CanonicalReview` / `CanonicalInquiry` / `CanonicalOrderSummary`를 유지.
  상품(product)·운영 리포트는 이 위의 **파생/집계**이며 새 raw 스키마를 함부로 늘리지 않는다.
- 새 채널 = **새 어댑터 + 새 매핑**, 코어(`IngestionService` dedup/per-row 트랜잭션/`SyncJob`) 무변경
  (Connector Roadmap §2·§3.2).
- 두 Track은 **읽기 모델(뷰)에서만** 갈라진다. 수집·dedup·canonical 저장은 단일 경로.
- 식별 축:
  - **org** — 테넌시 경계(둘 다 공통).
  - **channel × sellerAccount** — Seller Track의 주 축(어느 판매자센터의 데이터인가).
  - **product(브랜드 제품 식별)** — Manufacturer Track의 주 축(채널 횡단 같은 제품 묶기).
- product 식별(채널 횡단 동일 제품 매칭)은 **새로 필요한 부분**이며, raw 스키마가 아니라 매핑/링크
  레이어로 둔다. v1에서는 *수동/명시 매핑*부터(자동 제품 매칭은 범위 밖, §7).
- 시간 처리: 기존 recency chain 규칙 그대로(`eventTimeMs` 내부 전용, sanitized는 `recencyBucket`만,
  `Date.now`/`new Date`/`Date.parse` 금지). Track이 늘어도 동일.

---

## 5. 판매자센터형 운영 표면 범위

Seller Track의 1차 surface. **"판매자센터를 대체"가 아니라 "여러 판매자센터를 한 곳으로"**가 범위다.
화면·IA·여정 상세는 Frontend Spec이 정본이며, 본 절은 범위 경계만 고정한다.
> **v1.7 supersede.** 이 표면은 "매일 여는 대시보드"가 아니라 **pull-first / exception-push**(§1.8)로 운영된다 —
> 일반 결과는 재접속·일일 요약, 즉시 알림은 §1.8의 6개 트리거에만. 미래 FE는 minimal Control Center로 수렴한다.

범위 내(v1):
- **Frontstage(§1.1)**: 대시보드, 주문·매출, 고객 응대(문의·리뷰 통합), 상품 이슈, 리포트.
  - **채널 횡단 통합 뷰**: 주문/문의/리뷰를 채널 무관하게 한 목록으로.
  - **주의(attention) 뷰**: 기존 attention signal → priority score → ranking 체인을 채널 횡단으로 노출.
    - **리뷰 트리아지(로컬 기록)**: 드릴다운의 리뷰 행에 운영자가 자신의 판단을 기록한다 —
      `RESPONSE_NEEDED` · `MONITOR` · `NO_ACTION`. **초안 작성·발송·해결 처리가 아니다**:
      `RESPONSE_NEEDED`는 판단의 진술일 뿐 답변을 약속하지 않는다. **마켓플레이스 부수효과 없음** —
      로컬 기록이므로 아래 "채널로의 쓰기 액션" 범위 밖 규정과 상충하지 않는다.
    - 상태는 **신호가 아니라 리뷰에 귀속**된다: 신호 구간은 설계상 겹치므로(2점 리뷰는
      `LOW_RATING_REVIEW`이자 `NEW_REVIEW`) 어느 카드로 들어와도 같은 상태를 본다. **attention
      카운트·심각도는 바뀌지 않는다** — 트리아지는 기록이지 필터가 아니다(`NO_ACTION`이라고 해서
      낮은 평점 리뷰가 아니게 되지 않는다). 미기록(null)과 `NO_ACTION`("보고 나서 조치 불필요")은 다르다.
    - 행 참조 `actionRef`는 **클라이언트 불투명 주소이며 권한이 아니다**: 소지만으로 아무것도 허가하지
      않고, 서버가 매 호출 org·계정·채널 범위를 재인가한다.
    - 현재 **NAVER 전용**(수집된 리뷰 저장소가 트리아지 앵커). **Cafe24는 읽기 전용** — 커뮤니티 게시글은
      앵커가 없어 기록 대상이 아니며, 이는 역량 한계이지 행의 부재가 아니다.
    - **리뷰 답변 준비(Review Response Preparation)**: `RESPONSE_NEEDED`로 기록된 리뷰에 한해 운영자가
      답변을 준비한다 — **redacted 리뷰 본문 → 규칙 기반 추천 초안 → 운영자 편집 → 승인 → 복사**.
      **마켓플레이스 부수효과 없음**: 발송·게시 경로가 없고, 승인은 텍스트를 **고정**할 뿐 전송하지
      않으며, 답변은 **운영자의 클립보드로만** 나간다. "발송처럼 보이는" 표현·버튼 금지(Frontend Spec §10.2).
      - **`RESPONSE_NEEDED`는 여전히 아무것도 약속하지 않는다.** 그것은 준비를 **제안(offer)** 하는
        게이트일 뿐 **유발(cause)** 하지 않는다 — 트리아지 기록 시점에 초안은 만들어지지 않고, 운영자가
        명시적으로 시작할 때만 시작된다. 위 트리아지 항목의 "초안 작성이 아니다"는 트리아지 자체에 대한
        규정으로 그대로 유지된다.
      - **게이트는 비대칭이다**: `RESPONSE_NEEDED`를 벗어나면 저장·승인·복사는 막히지만 **승인 해제는
        항상 허용**된다. 승인은 초안을 고정하므로, 해제까지 막으면 리뷰가 APPROVED에 갇혀 나올 수 없다.
        **기존 초안은 트리아지 변경에도 보존·열람 가능**하다 — 트리아지는 기록이지 필터가 아니며, 운영자의
        작업을 지우지 않는다.
      - **복사는 승인된 head 버전·지문만** 사용한다(서버가 해당 버전 본문을 제공). 편집 중인 버퍼는
        복사 대상이 아니다 — 아무도 승인하지 않은 문장이 공개 답변으로 붙여넣어지지 않게 하기 위함이다.
      - **초안 생성(v1.7 갱신)**: 추천 초안은 **Company Voice 기반 AI 생성**이다(§5.2). ~~"AI 아님·결정론적
        규칙 기반"~~ 잠금은 v1.7으로 대체된다. 안전 규율은 **유지**: 어떤 초안도 환불·교환·보상·배송일을 약속하지
        않고 고객을 탓하지 않으며(사실은 Product Knowledge·운영자 확인에서만 옴), 초안은 **approval-gated**이고,
        승인은 텍스트를 고정할 뿐이며, 실제 발송은 §1.7 block ④(Capability 지원 + 승인)를 따른다.
      - 현재 **NAVER 전용**(트리아지 앵커와 동일).
- **Backstage(§1.1)**: 채널 연결·자격증명·동기화 설정·수집 이력·기간 지정 수집·업로드·복구.
  - **연결 상태(connection health) 뷰**: 각 (채널×수집방식)의 마지막 수집 상태/건강성. method와
    검증 상태를 **정직하게** 표기(Connector Roadmap §4.1·§10·부록 A의 4단계 모델).
  - **수집 트리거 진입점**: manual upload, (승인된 채널) 감독형 캡처 시작 버튼 — 단, 실제 라이브 실행은
    §7·Connector Roadmap §8 승인 규칙을 따른다.
- **모바일 1급 범위**: 하루 개요(대시보드), 알림, 문의·리뷰 확인, 가벼운 검토/승인. 밀도 높은
  설정·복구 도구(Backstage)는 데스크톱 우선을 허용.
- **데모/개발 모드 분리**: mock 데이터는 **명시적으로 분리된 데모/개발 모드에서만** 허용.
  production을 향하는 읽기는 fail-closed(가짜 데이터로 강등 금지).

범위 밖(v1, Dashboard):
- 채널로의 쓰기 액션(답변 전송/상태 변경) — 읽기·식별까지(§2).
- **standalone "AI 검색" 페이지** — 1차 내비게이션에서 제외. 향후 RAG는 각 화면에 맥락으로 붙는
  **"운영 메모리" 패널**로만 설계한다(별도 승인 전 구현 금지).
- 실시간 스트리밍 업데이트(배치/새로고침 기반 유지).
- 임의 차트 빌더/커스텀 리포트 디자이너.
- 권한/역할 세분화(멀티 유저 RBAC) — v1은 org 단위 단순 모델.

UI 정직성: "다음 단계 제공" 류 로드맵 문구 금지. **현재 사용 가능한 채널 capability만 "지원"으로
표기**하며, 그 판정은 Connector Roadmap §4.1 현행표(운영 지원 열)를 따른다. 없는 채널·없는
method는 "미지원"으로 표기하거나 숨김(`no_roadmap_language_in_ui`, `honest_capability_wording` 준수).

### 5.2 Company Voice · Product Knowledge · Issue Operations (v1.7 신설)

응답 운영을 뒷받침하는 세 입력·판정을 범위 정본으로 고정한다. **모두 설계 방향이며 구현 지시가 아니다**;
착수·순서는 §8 개발 순서와 별도 슬라이스를 따른다.

- **Company Voice Profile** — 리뷰·문의 답변 **초안을 기업별 말투로 AI 생성**하기 위한 입력: Company Voice
  Profile + **브랜드·채널·상황별 정책** + **승인된 최종 답변 검색** + **사용자 수정 이력**. **사실 정보와 문체를
  분리**한다 — 말투는 Voice에서, 사실은 Product Knowledge·운영자 확인에서 온다. v1.4의 "결정론적 RULE_BASED·
  AI 없음" 잠금을 대체한다(§1.7 block ④). 초안은 approval-gated, 발송 경계는 §1.6·§1.7 block ④.
- **Product Knowledge Pack** — 입력으로 받을 수 있어야 하는 것: 상품명·옵션·설명·규격 / 사용·설치 방법과
  주의사항 / 상세페이지 텍스트·이미지 / FAQ·매뉴얼 / 교환·환불·CS 정책 / **사용자 확인 지식**. **상세 이미지에서
  추출한 정보는 출처·신뢰도를 기록하고, 확인 전에는 확정 사실로 사용하지 않는다.**
- **Issue Operations (disclosure 대조)** — 고객 불만과 상품 정보를 대조해 다음 후보를 구분한다:
  `NOT_DISCLOSED` / `DISCLOSED_BUT_WEAK` / `DISCLOSED_AND_CLEAR` / `FAILURE_DESPITE_CORRECT_USE` / `UNKNOWN`.
  **이 결과는 고객 책임을 단정하거나 불만을 자동 기각하는 데 사용하지 않는다** — 운영자 판단을 돕는 후보 분류일 뿐이다.

---

## 6. 채널별 연동 범위 (v1 경계)

**채널 × DataType의 방식·상태·검증·표기 문구는 전부 Connector Roadmap §4.1 현행표가 정본이다.**
본 문서는 채널별 사실을 중복 서술하지 않는다(v1.1에서 기존 중복 서술 제거 — 낡은 검증 문장이
드리프트의 원인이었다).

본 절이 고정하는 것은 **약속의 규칙**뿐이다:

- v1에서 셀러에게 "지원"으로 약속하는 것은 현행표의 **운영 지원(production-supported)** 열이 ✅인
  것뿐이다. 라이브 검증 단계는 파일럿/감독 하 기능으로만 다룬다.
- 모든 채널은 **manual upload 경로부터** 정직하게 시작할 수 있다(기존 `/api/uploads` + 매핑).
- 한 채널이 DataType마다 다른 method를 가질 수 있다. 현행표에 없는 (채널×DataType×method)는
  약속하지 않는다.
- 상태 상향(구현→라이브 검증→운영 지원)은 증거 문서를 링크하며 현행표를 갱신하는 것으로만 한다.

### 6.1 가이드 연결·런타임의 현재 범위 vs 미래 범위

§1.2 원칙의 구현 경계를 못 박는다. **왼쪽만 지금 범위이며, 오른쪽은 방향으로만 문서화하고 지금
구현하지 않는다.** 구현 현황의 단일 진실은 Connector Roadmap §4.1 + Runtime ADR이다.

| 현재 범위 (지금) | 미래 범위 (방향, 미구현) |
|---|---|
| 로컬 모드(사용자 PC), macOS 파일럿 | Windows 회사 PC 배포, 클라우드 관리형 런타임 |
| 감독형 브라우저 세션 + 전용 프로필(실제 Chrome+CDP) | — |
| **Action Window = 기본 리뷰 수집 모드**(실제 창 직접 행동 + 오버레이; **NAVER 리뷰 라이브 검증됨 — 1계정·disposable·운영 지원 아님(§4.1); 그 외 채널·범용 렌더러 미구현**) | 채널별 라이브 Action Window 보정(별도 승인·정책 게이트) |
| **채널-중립 브라우저 프로젝션 V0**(커밋 `a0e4f6f`, 로컬 픽스처, **마켓 미승인**, **비-기본 렌더러**) | Projected Direct Action(채널별 정책·제품 리뷰 후 활성화 가능) |
| 전용 프로필 세션 보존 + 사람 재로그인 | OS 자격증명 저장소(Device Vault) + 자동 재로그인 |
| 자격증명은 백엔드 Vault(API 키) / 브라우저 세션은 기기 로컬 | 자동 자격증명 입력 |
| 파일럿: 셀러 소유 NAVER 앱 발급 가이드(§Frontend Spec) | SellerOps 솔루션-제공자 OAuth 연동 모델(NAVER 솔루션 마켓 — 장기·비선결 §1.3) |

> **이 표의 오른쪽 항목을 "지원/제공"으로 표기하는 것을 금한다.** 최초 프로토타입(NAVER)은
> **셀러 소유 앱 발급 파일럿 경로**이며, 미래의 SellerOps 솔루션-제공자 연동 모델로 문서화하지 않는다.
> 브라우저 프로젝션 V0은 **구현됐으나 마켓 사용 미승인·비-기본 렌더러**이며, 라이브 리뷰 수집의 기본은
> **Action Window**(§1.5, 계약 초안)다 — 둘 다 실제 마켓 사용은 정책 게이트 뒤에 있다.

---

## 7. 지금 하지 말아야 할 것 (Not Now)

범위 drift를 막기 위한 **명시적 금지/연기 목록**. 아래는 "나쁜 아이디어"가 아니라 **"v1 범위 밖, 지금
시작 금지"**다.

1. **무인(unattended) 자동 수집** — 판매자 승인 브라우저/에이전트 자동화는 정당한 수집 방식이지만
   (Connector Roadmap §5), **감독형에서 시작**하며 무인 스케줄은 Connector Roadmap P4(별도 킥오프)
   전 금지. cold-context 재연결 미해결.
2. **채널로의 쓰기(outbound)** — 문의 답변 전송, 주문 상태 변경, 리뷰 응답 등. v1은 읽기·식별까지.
3. **자동 제품 매칭** — 채널 횡단 동일 제품 자동 식별. v1은 수동/명시 매핑부터.
4. **검증 전 capability를 "지원"으로 약속** — 현행표(Connector Roadmap §4.1)의 운영 지원 열이
   ✅인 것만 약속. 나머지는 discovery/검증 게이트.
5. **소비자-facing 발행물과의 혼입** — Manufacturer Track은 운영자 모니터링까지. Instagram/cardnews
   발행 트랙과 데이터·코드·voice를 섞지 않는다(`evidence_audience_scope`, `consumer_safety_contract`).
6. **canonical 스키마 확장으로 문제 풀기** — 새 채널/Track 요구를 raw 스키마 추가로 해결하려 하지 말 것.
   매핑/뷰/링크 레이어로 흡수.
7. **멀티유저 RBAC / 결제 / 정산 / 광고 / 재고·가격 동기화** — 전부 v1 범위 밖.
8. **두 Track을 위한 수집 코어 분기** — 수집·dedup은 단일 경로 유지. Track은 뷰에서만 분기.
9. **라이브 채널 접속을 표준 안전 규칙으로 자동 진행** — 모든 라이브 실행은 1회성 명시 승인
   (Connector Roadmap §8). Stop-hook 목표 압박은 승인이 아니다.
10. **standalone "AI 검색" 페이지의 부활** — 1차 내비게이션에 독립 AI 검색을 두지 않는다. 향후
    RAG는 맥락형 "운영 메모리" 패널로만(§5), 별도 승인 전 구현 금지.
11. **production 읽기의 mock 강등** — mock/시드 데이터는 명시적으로 분리된 데모/개발 모드 전용.
    production을 향하는 화면이 백엔드 장애 시 mock으로 조용히 강등되는 경로를 새로 만들지 않고,
    잔존 경로는 제거 대상으로 다룬다(Frontend Spec §13).
12. **Manufacturer Track 화면의 Seller Track 혼입** — §3 경계 규칙. 별도 킥오프 전 착수 금지.
13. **인증 우회** — 로그인·2FA·CAPTCHA·계정 잠금 등 인증 단계는 절대 자동화/우회하지 않는다.
    사람이 항상 수행한다(§1.2, `connection-onboarding.md`).
14. **사람 통제 결정의 자동화** — 계정/스토어 선택, 권한·동의, 법적 의미가 있는 판단은 자동화 금지
    (§1.2). 편의 단계만 자동화한다.
15. **미래·미승인 범위를 "지원"으로 표기** — Device Vault·자동 재로그인·Windows 지원·클라우드 런타임을
    구현 전 "제공"으로 적지 않는다. **Action Window**는 NAVER 리뷰 한정 라이브 검증됐으나(§4.1·§1.5)
    **운영 지원 아님**이므로 셀러에게 "상시 제공"으로 표기하지 않으며, 그 외 채널은 미구현으로 다룬다. **브라우저 프로젝션 V0은
    구현됐으나**(채널-중립, 커밋) **마켓 사용 미승인·비-기본 렌더러**이므로 "마켓 리뷰를 프로젝션으로
    수집한다/NAVER 승인됨"으로 표기하지 않는다(§1.5·§6.1).
16. **Action Window/Projection의 실제 마켓 사용을 정책 게이트 전에 진행** — 실제 마켓 대상 Action Window·
    Projected Direct Action은 마켓 약관 허용 범위 해명 + 제품 오너 승인 전 금지(§1.5, `action-window-v1.md` §17).
17. **한 사용자 행동을 마켓 클릭 시퀀스로 확장** — Action Window는 사용자 직접 클릭이 기본이며, SellerOps가
    한 행동을 몰래 여러 마켓 클릭으로 번역하지 않는다(§1.5). 감독형 단일 클릭 원칙(정확히 1개, 서명 일치 시)만 예외.
18. **OperationRun 도메인의 조기 구현** — §1.7은 방향 기록이며, 실행 모드·체크포인트 안정 전 코드 착수 금지.

---

## 8. PR 우선순위

범위를 고정한 상태에서의 권장 순서. 각 PR은 작고 독립 머지 가능, 문서/오프라인 PR과 라이브 PR을 분리
(Connector Roadmap §6과 정합). 라이브 검증은 별도 승인.

1. **P-scope(이 PR)** — 본 범위 문서. 구현 없음.
2. **공통 토대(Connector Roadmap P0)** — `ConnectorResult` sanitized 계약(P0.2), collector EXPORT를
   백엔드 `SyncJob`/connection-health로 브리지(P0.3). 두 Track 공통 관측 토대.
3. **Manual upload 일반화(Connector Roadmap P2.2)** — `HeaderAliases`/`*RowMapper` 채널별 별칭 + 골든
   픽스처. → 모든 채널 "manual 지원"을 가장 먼저, 정직하게 달성(§6 최소선).
4. **Seller Track 통합 뷰(읽기)** — 채널 횡단 주문/문의/리뷰 + attention 뷰 + connection-health 표기(§5).
   기존 attention/priority 체인 재사용, 신규 raw 스키마 없음.
5. **Manufacturer Track 모니터링 뷰(읽기)** — product 단위 리뷰 집계 + 시계열 평판. product 식별은 수동
   매핑부터(§4). 수집 코어 무변경.
6. **감독형 캡처 코어 추출(Connector Roadmap P1)** — NAVER DOM 어댑터 분리, 검증 블록 보존, default flip
   없음. 타 채널 감독형 캡처의 토대.
7. **채널별 도입(Connector Roadmap P3.x)** — discovery 게이트 통과 채널부터. manual → export → API 상향.

> 순서 원칙: **관측 토대 → manual로 전 채널 정직 지원 → Seller Track 읽기 뷰 → 그다음에야 채널별 자동화.**
> "채널 자동화부터" 거꾸로 가지 않는다.
>
> **프론트 리디자인 슬라이스(v1.1 신설)**: 프론트 IA 재편·화면 이동·온보딩 표면의 슬라이스 순서와
> FE/BE 의존성은 Frontend Spec §17이 정본이다. 본 절의 수집 측 우선순위와 병렬로 진행하되,
> 각 슬라이스는 동일하게 작은 PR 규율을 따른다.

---

## 9. Drift Guard 문장

새 기능/요청이 들어올 때 **아래 문장에 비춰 범위를 판정**한다. 어긋나면 코드가 아니라 이 문서를 먼저
고쳐 합의한다.

- SellerOps는 **다섯 데이터(주문·문의·리뷰·상품·운영 리포트)의 수집·통합·운영 보조**다. 그 밖이면 범위 밖.
- **현재 작업은 Seller Track**이다. Manufacturer Track 요구가 Seller 프론트에 섞이면 멈추고 §3 경계를
  확인한다. 두 Track은 **같은 canonical 모델을 공유**하며, 수집 코어를 Track별로 분기시키는 요청은
  거절한다.
- **Frontstage(운영 표면) 1차, Backstage(연결·수집 관리) 2차**의 위계를 흔드는 IA 요청은 Frontend
  Spec을 먼저 고쳐 합의한다. 단 기본 UX는 **pull-first / exception-push**(§1.8)이고 FE는 **Agent Control Plane
  projection/command adapter**이며 신규 기능은 동결이다 — 새 화면/카드/훅을 능력마다 추가하는 요청은 멈추고
  ADR(`agent-first-ui-light-adr.md`)·§1.8을 확인한다.
- 새 채널/Track은 **어댑터·매핑·뷰**로 흡수한다. canonical raw 스키마 확장으로 푸는 요청은 멈추고 검토.
- v1은 **읽기·식별·우선순위 + Company Voice 답변 초안 + 승인 후 Capability 기반 발송**까지다(v1.7, §1.6·§5.2).
  **무승인 자동 발송·무인 자동화·자동 제품 매칭·그 외 채널 쓰기(주문 상태 변경 등)는 v1 범위 밖.** 실제 발송은
  채널별 Capability(공식 API)가 지원할 때만, 승인을 human-checkpoint로 하여 수행한다.
  - **좁은 예외 (v1.6, NAVER 리뷰 답변 제출만 — 공식 API 부재 채널):** SellerOps가 **직접 쓰는 것은 여전히 금지**다. 허용되는
    것은 **가이드형·사람 수행·관찰 전용** 실행뿐 — 창을 앞으로 가져오고 답변란을 하이라이트하고 판매자의
    제출을 관찰한다. SellerOps는 입력·제출·클릭을 하지 않고, 무인/스케줄 실행도 없다. 결과는 **운영자 보고 +
    명시적 UNVERIFIED**로만 기록되며 게시 여부를 **검증하지 않는다**(NAVER REVIEW API 부재). 제출은 멱등이
    아니므로 `submissionRef`는 1회용이고 자동 재구동 금지. 예외의 경계, 명시: 이 예외는 **답변 제출 실행 하나**에만
    해당하며 collector 계약·다른 채널·다른 데이터에 아무 권한도 주지 않는다.
- 채널 capability는 **Connector Roadmap §4.1 현행표에 선언된 것만 약속**한다. 운영 지원 열이 ✅가
  아니면 "지원" 표기는 금지(`honest_capability_wording`). 채널 사실을 이 문서나 UI 카피에 중복
  선언하지 않는다.
- mock/시드 데이터는 **분리된 데모/개발 모드 전용**이다. production 읽기는 fail-closed.
- 모든 라이브 채널 접속은 **1회성 명시 승인**을 요구한다. 표준 안전 규칙은 라이브 승인이 아니다.
- 출력은 **enum / coarse bucket / boolean / 16-hex 해시**만. raw 식별자·본문·카운트·타임스탬프 금지
  (Connector Roadmap §9). **이 규정의 대상은 collector sanitized-output 계약**이다 — 수집 경계를 넘어
  나가는 출력에 대한 규칙이지, 판매자 대면 운영 화면 전반에 대한 금지가 아니다(v1.4에서 확정).
  - **좁은 예외 (v1.4)**: 판매자 대면 **운영자 화면**은 자신이 소유한 VOC 본문을 **redacted 형태로**
    노출할 수 있다. 근거: 판매자는 자기 스토어의 리뷰·문의를 이미 소유하며, 현행 `InquiryDetail`이
    같은 이유로 판매자 소유 원문을 노출한다. 적용 대상은 **답변 준비 화면 하나**이고, 반드시
    `VocPreviewSanitizer`를 통과한 **redacted 본문**이어야 한다(원문 컬럼 직접 노출 금지).
  - 예외의 경계, 명시: **collector 계약은 그대로**이며 이 예외는 거기에 아무 권한도 주지 않는다.
    attention **목록**은 계속 metadata-only(60자 `safePreview`)다 — 예외는 목록이 아니라 본문을 읽어야
    답변할 수 있는 화면에만 해당한다. 고객 신원·주문/상품 식별자·채널측 id는 여전히 금지.
- **확신이 없으면 멈추고 보고한다.** 범위를 넓혀 추정 구현하지 않는다.
