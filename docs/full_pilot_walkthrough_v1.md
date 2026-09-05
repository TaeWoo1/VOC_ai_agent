# Full Pilot Walkthrough v1 — 처음 쓰는 판매자 한 명으로 제품을 끝까지 통과하기

- 날짜: 2026-09-05 (KST) · HEAD `b7db225e` 위에서 시작
- 성격: 기능 개발 0. 주요 v1 workstream은 **FREEZE**. 실제 walkthrough를 막거나 신뢰를 깨는 결함만 고쳤다.
- 환경: `tools/dev/local-stack.sh up`(backend · agent-runtime · frontend) + 설치된 launchd 도우미 0.2.0. 브라우저는
  Playwright 영속 프로필 둘(1440×900@2×) — **clean seller**(제품 자신의 `/signup`으로 만든 새 org 「파일럿 리빙」)과
  **canonical Demo Org**(실제 Cafe24·NAVER·Coupang 연결). 두 프로필은 세션이 독립이라 org 격리도 함께 관찰됐다.
- 마켓플레이스 WRITE **0** · submit **0** · 다른 org/marketplace/credential binding 변경 **0**.

## 0. 왜 두 org인가

파일럿 판매자가 처음 겪는 것은 **가입 → 첫 연결 → 도우미 → 빈 홈**이고, 그 다음에 겪는 것은 **문의·리뷰·지식·리포트**다.
앞의 넷은 clean org에서만 관찰할 수 있고(Demo Org는 이미 세 채널이 연결돼 있다), 뒤의 것들은 실제 고객 데이터가
있어야 관찰할 수 있다. 쓸 수 있는 Cafe24 mall이 Demo Org의 그것뿐이라(재-OAuth 금지, product-owner 결정) clean
org에는 채널을 붙이지 않았다 — 그래서 **「연결 직후 첫 수집이 화면에 무엇을 만드는가」는 이 walkthrough가 답하지
않는다**(Disconnected Channel Onboarding v1이 남긴 같은 공백).

## 1. 실제 click path

| # | 단계 | 무엇을 눌렀나 | 관측 |
|---|---|---|---|
| 1 | 로그인 | `/login` | Google · 네이버 · 이메일 세 입구 전부 렌더(백엔드 `social/providers` = google·naver true). 「계정 만들기」 링크 |
| 1 | 가입 | `/signup` 상호·이름·이메일·비밀번호·약관 → 계정 만들기 | **`/connect`에 착지**(FIRST_RUN_PATH). 마케팅 동의는 선택 |
| 2 | 첫 연결 화면 | — | 채널 셋 「연결 필요」·연결하기, 도우미 카드, 자료 가져오기. 도우미 카드가 새 판매자에게 **「다시 연결 필요」**(→ §3-2) |
| 2 | 도우미 pairing | 도우미 연결 → Mac 네이티브 창 **[허용]**(사람) | 1.9s에 요청, **9.6s에 페어링**(허용 포함) |
| 2 | 기기 연결 | 이 기기 연결 | **3.3s**에 「연결됨」. `/settings/devices`에 「Mac (arm64) · 방금 전 연결 · 아직 사용 안 함 · 도우미 0.2.0」 |
| 3 | 홈(clean) | `/` | 「판매 채널을 연결하면 시작할 수 있습니다」 + 채널 연결하기 하나. 명령 상자와 예시 칩 4개는 그대로 렌더(→ §4) |
| 3 | 홈(Demo) | `/` | 인사 줄(주문 293 · 부정 리뷰 0 · 최신 수집 확인 필요) → 「지금 처리할 일이 21건」 + 오래 기다린 3행 + 전체 보기. 첫 행이 **「제목 없는 문의」**(→ §3-3) |
| 3 | Chat | 「어제 온 문의 중 내가 답해야 할 거?」 | 5.7s, 「어제 들어온 답변 안 한 문의는 없습니다」(어제 접수 0 — 참). 빈 답 아래 「그중 가장 최근 1개만」 칩(→ §4) |
| 4 | 문의 목록 | `/inquiries` | 지금 처리할 일 21(1년 넘게 지난 문의 20 divider) / 전체 문의 94. 3-pane |
| 4 | exact 문의 | 네이버 「전선 한가닥 2.5 3c…」 행 | 상세: 고객 문장 · 채널·상품·2일째 · 「AI 답변 초안 만들기」 |
| 4 | 초안 | AI 답변 초안 만들기 | **NO_ANSWER_BASIS** — 「등록된 상품 정보에서 「가닥」 관련 근거를 찾지 못했습니다」, 모델 0회·초안 0(설계대로). 「답변 기준 추가」 |
| 6 | Knowledge quick add | 답변 기준 추가 → 주제·내용 → 저장하고 다시 답변 만들기 | 판매자의 **과거 실제 답변**(answer memory에 있던 내경 규격 문장)을 지식으로 등록 → 재초안 |
| 4·6 | 재초안 | — | **NEEDS_CLARIFICATION** 초안, 「AI가 확인한 내용 · 상품 정보」에 방금 넣은 문장 인용. 상태 줄이 **「고객이 어떤 규격·옵션인지 밝히지 않았습니다」** — 고객은 2호·5호를 말했다(→ §3-1) |
| 4 | seller 확인 | 수정 → 문장 고침 → 초안 저장 | v2 `SELLER` 저장, 새로고침 유지 |
| 5 | 리뷰 | `/reviews` → 네이버 계정 기록 | 「내 답변 작업」(승인 대기 2 · 승인됨 1)이 목록 위, 기록 4,432건 222페이지 |
| 5 | 리뷰 선택 | 2026-03-25 ★2 「접착력이 안좋아요…」 행 → `/reviews/reply/{id}` | 「판단 전」 → **대응 필요** → 답변 준비 |
| 5 | grounded draft ① | AI 초안 준비 | **기본 문구**(근거 없음) — 이 상품에 「부착이 잘 떨어질 때 안내」 지식이 있는데도(→ §3-4) |
| 5 | grounded draft ② | (retrieval v2 ON 뒤) 다시 준비 | **근거 있음 · 근거 2**, 초안이 판매자의 부착 안내를 그대로 쓴다. 4.2s + 벤더 ~11s |
| 5 | 승인 | 승인 | 승인됨 → 「승인 해제 · 복사 · 직접 답변하고 기록하기」. 안내문이 여전히 「직접 고쳐 주세요」(→ §3-6) |
| 5 | NAVER Guided Reply | — | §5 |
| 7 | 상품 | `/products` → 선바로 상세 | 리뷰 1,761 · 문의 9 · 미답변 2 전부 문. 반복되는 문제 13 · 개선 기회 5 · 상품 지식 3(내가 넣은 것 포함) · 「확인이 필요한 항목 1건」 |
| 8 | 이슈 근거 | 접착 부족 · 근거 18건 → `/memory/{issue}` | 근거 인용 3건 전부 진짜 접착 불만(가짜 0). 개선 기회 둘 + 준비된 행동 버튼(초안 준비 / 보류) |
| 9 | 리포트 | `/reports` | 주간 2026-08-24~30 · 2번째 판. FACT(주문 163 ↑59 · 리뷰 81 ↑16 · 문의 4 ↑3) / 해석(「확인할 필요」) / 한계(「원인은 리뷰가 말하지 않습니다」). 지금 수치는 「기간과 무관」 라벨. 다음에 할 일 6개 전부 기존 객체로의 문 |
| 10 | 재시작 | `local-stack.sh down/up`(셋 다) | 도우미 launchd 무접촉. clean org: 도우미 **연결됨 유지**, 기기 행 「24분 전 연결 · 방금 전 마지막 사용」. Demo: 문의 v2 초안·리뷰 승인·홈 브리핑 전부 그대로 |

## 2. 사람이 개입해야 했던 지점

1. 도우미 pairing의 Mac 네이티브 **[허용]** — 브라우저 프로필당 한 번. (Demo Org 브라우저를 위해 한 번 더 필요했다.)
2. NAVER Guided Reply — 설치된 도우미의 브라우저 프로필에는 네이버 세션이 없으므로 **네이버 로그인**은 사람이 한다.
3. 라이브 composer fill의 **단회 승인**(§5).

그 외 전부 — 가입·기기 연결·초안·지식·승인·리포트 — 는 판매자가 화면만으로 끝낸다. **developer 도움이 필요한
지점은 하나도 없었다**(설치는 직전 패키지의 `설치.command`).

## 3. 발견하고 고친 blocker

### 3-1. 「고객이 어떤 규격·옵션인지 밝히지 않았습니다」 — 대조를 안 했으면서 고객이 말하지 않았다고 썼다

`SpecApplicability.classify`는 상품에 저장된 옵션이 **0개**일 때도 `VARIANT_UNRESOLVED`를 돌려주고, 그 verdict의
seller-facing 문장은 하나뿐이었다. 이 문의의 상품(`선바로 일체형 전선몰딩 열고 닫기 편한 전선몰드`)은 채널 옵션이
저장돼 있지 않아(`product_variants` 0행) 고객이 「한가닥은 2호 두가닥은 5호」라고 써도 비교 대상이 없었다 — 즉
「밝히지 않았다」는 아무도 확인하지 않은 고객에 대한 주장이었다. `Verdict.optionsRegistered`를 더하고 문장을 셋으로
갈랐다: 옵션이 있고 하나도 안 맞음 ⇒ 기존 문장 · **옵션 없음 ⇒ 「이 상품에 등록된 규격 목록이 없어 고객이 말한
규격을 확인하지 못했습니다. 아래 초안은 규격을 되묻습니다.」** · reload(분류 안 함) ⇒ 「규격이 확정되지 않아 아래
초안은 그 내용을 되묻습니다.」 (`AnswerBasisState`, `InquiryDraftComposer` 세 call site; 테스트는 옵션 없는 fixture의
기대 문장을 바꾸고 옵션 있는 case를 추가.) 프롬프트·retrieval·enum 무변경.

### 3-2. 첫 판매자에게 「다시 연결 필요」

한 번도 페어링한 적 없는 도우미가 `unpaired`일 때도 라벨이 「다시 연결 필요」였다. `pairedBefore`가 false이고 응답
없음 hint도 아니면 **「연결 필요」**(key·action 동일). `helperStatus.ts` + 테스트.

### 3-3. 홈 첫 행이 「제목 없는 문의」

홈 브리핑이 행에 `snippet: null`을 **일부러** 넣었는데(「제목·상점·대기가 행을 위로 올리는 이유」), 네이버 상품
문의는 제목이 없어 홈에서 가장 큰 글자가 「제목 없는 문의」였다 — 한 클릭 아래 문의 화면은 같은 행을 고객 문장으로
보여준다. **제목이 없을 때만** rows 읽기가 이미 싣고 있는 마스킹된 preview로 대체(`AgentHome.tsx`). 라이브에서
「전선 한가닥 2.5 3c…」와 오늘 들어온 「소재는 난연소재인가요?…」가 홈 첫 두 행이 됐다.

### 3-4. 판매자가 등록한 접착 안내를 리뷰 초안이 못 찾았다 — 코드가 아니라 배포 형상

★2 「접착력이 안좋아요. 중간에 계속 뜨고…」에 상품 지식 「부착이 잘 떨어질 때 안내」가 있는데 초안은 **기본 문구**
였고, 같은 화면 옆 상품 페이지는 「'접착' 관련 내용이 상품 지식에는 있습니다」라고 말한다 — 같은 사실에 두 답. 원인은
retrieval v2 capability 셋(`knowledge.embedding · intent · eligibility`)이 **기본값 OFF**이고 이 로컬 스택도 꺼져
있었다는 것(v1 문서가 「자꾸 들떠요」로 적어 둔 바로 그 lexical miss). 켜고(QA override: 같은 벤더 키, Demo Org
한정) 다시 준비하자 **근거 2로 GROUNDED**. ⇒ **파일럿 배포는 세 capability를 켜야 한다**(§6). 코드 변경 0.

### 3-5. 날짜가 UTC였다

지식 행·자료·운영 기준·이슈 기록·Agent 답변의 `iso.slice(0, 10)`이 UTC 날짜라 09-05 01시(KST)에 저장한 지식이
「2026-09-04」로 보였다. `kstDate()`(Asia/Seoul, 백엔드 리뷰 import 달력과 같은 규칙) 하나로 6곳 교체. 문의 접수일
`receivedDateLabel`도 같은 규칙.

### 3-6. 문장 둘

- 「**이 환경에서는** reviewnary가 답변을 대신 등록하지 않습니다」 → 「**지금은** …」 (판매자에게 「환경」은 없다).
- 승인된 리뷰 초안 위에 「내용을 확인하고 직접 고쳐 주세요」와 「승인된 초안은 수정할 수 없습니다」가 함께 있었다 → 승인
  뒤에는 앞 문장을 지운다.

### 3-7. 회귀 아님, 타입 오류 하나

`HelperDevices.test.tsx`의 `vi.fn<[], …>` 두 인자 제네릭이 이 vitest에서 `tsc` 오류였다(직전 패키지 착지분). 한 줄.

## 4. 남은 friction (고치지 않고 보고)

1. **파일럿 빌드에는 NAVER Guided Reply 실행 경로가 없다.** 브라우저 쪽 reply runtime은 `import.meta.env.DEV &&
   VITE_AW_BRIDGE=1`에서만 만들어지고(`useReplyRuntime`, `devMode.ts`) production은 null ⇒ 리뷰 작업 화면은 「직접
   답변하고 기록하기」(수동 복사), 대화의 「입력하기」 카드는 6초 뒤 「안내할 수 없음 + 복사」로 떨어진다. Phase 2 라이브
   증거는 dev bridge 모드에서 얻은 것이다. 파일럿에서 composer fill을 주려면 **product-owner 결정**(그 gate를 production
   에도 여는가).
2. **Guided Reply 대상은 취득 계보가 있는 리뷰뿐**(`executableIdentity=MARKETPLACE`). Demo Org에서 그 조건을 만족하는
   리뷰는 2026-09-02 guided import가 가져온 115건이고, 그 밖의 4,300여 건(파일 업로드 유래)은 영원히 복사 경로다.
   설계대로이지만 판매자에게는 「어떤 리뷰는 되고 어떤 리뷰는 안 되는」 이유가 화면에 없다.
3. 첫 홈(clean org)의 명령 상자와 예시 칩 4개 — 연결 전에는 무엇을 쳐도 「판매 채널을 연결하시면…」이다. 칩은 연결 뒤에
   보이는 편이 정직하다.
4. Chat의 빈 답변 아래 「그중 가장 최근 1개만」·「첫 번째 거 답변 준비해줘」 칩 — 집합이 0인데 「그중」.
5. 「3821일째 대기」(홈) vs 「1년 넘음」(문의 목록) — 같은 사실의 두 표현. 홈 쪽은 정직하나 10년짜리 숫자는 판매자가
   읽을 이유가 없다.
6. Knowledge quick add에 제목 칸이 없어 제목 = 본문 앞부분 ⇒ 인용 카드에 같은 문장이 두 줄(제목 + 발췌).
7. 리뷰 gap ask가 **리뷰 전문**을 따옴표로 인용한다(「'리뷰에서 많이 언급했던대로 접착력이…'에 대해 … 공식 기준이
   있나요?」) — 문의 lane은 명사(「가닥」)를 인용한다. 같은 규칙으로.
8. 승인 뒤 「근거 있음 / AI가 확인한 내용」 카드가 사라진다(문의도 seller 버전 저장 뒤 인용이 사라진다) — 보낼 문장의
   근거를 보내기 직전에 못 본다.
9. 리포트·이슈 화면의 「인용 단위」·「심각도 보통」·「관찰 중 · reviewnary · 08-21 · 아직 근거가 모이지 않았어요」(근거
   18건 옆) — 내부 단어와 낡은 기록.
10. `/inquiries` 문서 높이 6,925px(목록이 곧 선택 rail; IA 결정, 이전 패키지와 동일).
11. Guided Reply가 로그인(10분)·기간(5분)을 기다리는 동안 **판매자 화면은 아무 말도 하지 않는다** — 이유는 종료 후에만
    나온다(§5-5). reply engine에 park/recheck 상태가 없어서이고, 이 sitting에서 만들지 않았다.
12. **오래된 리뷰에 답하려면 판매자가 판매자센터에서 조회 기간을 직접 넓혀야 한다**(§5-7). 목록 기본값이 최근 7일이고
    그 화면에 숫자 페이저가 없어서(`pagerNumberCount 0`), 안전 fence를 지키는 한 이 한 걸음은 판매자의 것이다.

## 5. NAVER Guided Reply — composer fill까지

대상은 승인된 그대로 `471cf8ef`(★4 · 2026-08-28 · 선바로 일체형 전선몰딩 · 승인된 초안). 대상을 바꾸지 않았다 —
바꾸면 이 sitting이 찾아낸 것이 defect가 아니라 acceptance 실패로 기록된다.

### 5-1. 첫 두 번의 실행이 남긴 것 (2026-09-04 20:02 / 20:13 UTC)

1회차는 FE 클라이언트가 먼저 끊겨(`all_clients_detached`) 로그인 대기 중 종료됐다. 2회차는 판매자가 로그인해
`aw_naver_reply_surface_ready {rowsOnPage:22}`까지 갔고, 거기서 **15 스윕 · `fingerprintHits` 0 · `atBottom:true`**로
끝났다. 실행된 라이브 동작은 **0** — 상세 열기·composer·fill 어느 것도 소진되지 않았다.

### 5-2. root cause — 「찾지 못했다」가 아니라 「그 기간을 보고 있지 않았다」

2026-09-03 LIVE PASS(`0f9b4187`)는 **같은 08-28 날짜의 리뷰**(`c329471c`)를 `locate_sweep step 9`에서 찾았다.
그때 그 리뷰는 6일 전이었고 오늘 대상은 **8일 전**이다. 스윕 로그가 나머지를 말한다:

- 행 수가 22 → 25 → 29 → 32 → 33으로 늘다가 **32 → 30 → 27 → 23 → 22로 줄어든다** — DOM을 재활용하는 가상 그리드다.
- 15번째 화면에서 **`atBottom: true`** — 목록이 끝났다.
- 15개 화면 전부 `recencySpread`가 `TODAY`/`THIS_WEEK`뿐 — **일주일보다 오래된 행이 단 하나도 없었다.**

수천 건의 리뷰를 가진 판매자의 목록이 「일주일치만 있고 끝」일 수는 없다. 즉 화면은 자기 기본 조회 기간을 보여주고
있었고, **스크롤은 필터 바깥에 닿을 수 없다.** locate는 기간을 한 번도 정하지 않았고 화면이 주는 대로 받았다. 그것을
`TARGET_NOT_FOUND`로 보고한 것은 판매자에게 **거짓**이다(리뷰는 거기 있다) — 게다가 그 문장이 암시하는 복구(다시 찾기)는
원리적으로 성공할 수 없다.

### 5-3. 고친 것 — 기존 UI 경로, 새 클릭 0

- **범위 census**(`review-list-range-inpage.ts`): 목록 자신의 기간·페이지 컨트롤을 읽는다. 나가는 것은 **정수뿐**
  (활성 날짜 입력 수, 파싱된 값 수, 시작·끝의 **as-of 기준 일수 차**, 페이지 번호 수, 최대 페이지 번호) — 날짜 문자열도
  선택자도 페이지 텍스트도 넘지 않는다. 날짜 술어는 acquisition lane이 라이브에서 쓰던 것(`input[type=date]` +
  date/calendar/picker 클래스)을 그대로 쓴다.
- **스윕이 본 것의 합집합**: 재활용 그리드에서는 한 번의 스캔이 목록 전체를 볼 수 없으므로 화면마다의 recency bucket을
  누적한다. 그 합집합이 세 판정을 가른다 — `OUT_OF_LISTED_RANGE`(바닥까지 갔고 대상의 bucket을 **한 번도** 못 봤다) ·
  `NOT_ON_SURFACE`(그 bucket을 보고도 없었다) · `NOT_ESTABLISHED`(step cap에 걸려 아무것도 증명하지 못했다).
- **`OUT_OF_LISTED_RANGE`이면 기다린다** — 로그인을 기다리는 것과 **같은 모양**으로, 읽기 전용 5분. 판매자가 그 화면의
  기간을 바꾸고 화면 자신의 [조회]를 누르면, census가 창이 바뀐 것을 보고 **목록을 첫 행으로 되감은 뒤**(재조회된 그리드는
  1행부터 그려지므로 이전 스크롤 위치에서 이어 읽으면 그 위의 행들을 「없다」고 말하게 된다) 다시 스윕한다.
  기간 컨트롤이 **없는** 화면에서는 기다리지 않는다 — 판매자가 바꿀 것이 없는데 기다리는 것은 아무에게도 부탁하지 않은
  일을 기다리는 것이다.
- **페이지네이션 자동 클릭은 하지 않았다.** `.click(`은 여전히 `reply-composer-open.ts` 한 파일에서 정확히 한 번,
  `.fill(`은 `reply-composer-fill.ts` 한 파일뿐이다. 기간을 넓히는 것은 판매자의 클릭이고 우리는 결과를 감지한다 —
  Action Window 계약 그대로. census는 pager 유무·최대 페이지 번호를 **기록만** 한다(다음에 다른 경로가 필요해지면
  그때 근거가 있도록).

### 5-4. 사라지던 실패도 함께 닫았다

- 도우미 로그: `aw_naver_reply_terminal {event, code, recoverable, stage}` — 세션의 단일 publish choke point에
  latch한다(acquisition이 `aw_acquisition_terminal`로 닫은 것과 같은 모양). **라이브로 확인**:
  `{"event":"RUN_BLOCKED","code":"LOGIN_REQUIRED","recoverable":true,"stage":"FAILED"}`.
- 리뷰 답변 작업 화면: 이제 run을 **구독한다**(`ReplySignal`에 닫힌 어휘의 `code`·`recoverable` 추가 — 페이지에서 온
  값은 절대 싣지 않는다). 멈춘 run은 **이유를 문장으로** 말하고(우리 코드명은 화면에 나오지 않는다) 「답변함으로 기록」·
  「답변 안 함으로 기록」 대신 **[다시 시도]**를 보인다 — 끝난 run에 대고 보고할 것은 없다. 그리고 물기 전에 전제를
  말한다: 「네이버 리뷰 목록의 조회 기간에 이 리뷰의 작성일(2026-08-28)이 포함돼 있어야 찾을 수 있어요.」
  **라이브로 확인**(21:04 UTC): 로그인 대기가 만료되자 화면이 「네이버 로그인이 필요해요. 열린 창에서 로그인한 뒤 다시
  시도해 주세요.」 + [다시 시도]로 바뀌었다 — 직전 sitting에서 같은 상황이 만든 것은 **침묵**이었다.

### 5-5. 고친 뒤의 실행 — 세션이 만료돼 있었고, 그것도 이제는 보인다 (21:05 / 21:16 UTC)

수정한 도우미 번들을 실제 설치 위치에 다시 빌드해 넣고(`app/helper.mjs`, launchd 재기동, pairing 3건 복원) 같은 대상으로
두 번 실행했다. 두 번 다 **판매자센터 NAVER 세션이 만료돼 있었고**, 사람이 그 창에 로그인하지 않아 10분 뒤 종료됐다.

그 종료가 이 패키지 전에는 **침묵**이었고 지금은 셋 다 남는다:

- 도우미 로그 `aw_naver_reply_terminal {"event":"RUN_BLOCKED","code":"LOGIN_REQUIRED","recoverable":true,"stage":"FAILED"}`
- 판매자 화면 「네이버 로그인이 필요해요. 열린 창에서 로그인한 뒤 다시 시도해 주세요.」 + **[다시 시도]**
  (「답변함으로 기록」·「답변 안 함으로 기록」은 렌더되지 않는다 — 끝난 run에 보고할 것은 없다)
- 실행 후 상태: `review_reply_execution` **1행**(2026-09-03 proof의 `c329471c`, 변화 없음) · 대상 `471cf8ef`의 승인
  **1건 유지** · 초안 **v1 `27d352c5` 무변경** · 새 execution/outcome **0**.

**승인된 세 동작은 여전히 0회 소진**(`OPEN_EXACT_REVIEW_DETAIL` · `OPEN_COMPOSER` · `FILL_APPROVED_DRAFT`),
마켓플레이스 WRITE **0**, submit **0**. 남은 것은 사람이 그 창에 로그인해 기간을 넓히는 것뿐이고, 그것은 코드가 대신할 수
있는 일이 아니다(그리고 대신해서도 안 된다).

**정직하게 적어 두는 한계**: locate가 기간을 기다리는 5분과 로그인을 기다리는 10분 동안 **판매자 화면은 아무 말도 하지
않는다**. run이 park 상태를 말할 수 있으려면 reply engine에 park/recheck 상태가 필요하고(acquisition lane에는 있다),
그것은 이 sitting이 하지 않기로 한 구조 변경이다. 지금 화면이 말하는 것은 시작 전 전제와 종료 후 이유 둘뿐이다.

### 5-6. LIVE PASS — 같은 대상, 기간을 넓힌 목록에서 composer fill (2026-09-05 14:27~14:29 KST)

대상·계정·채널·초안·승인 전부 그대로. 판매자가 그 창에 로그인한 뒤의 실행 로그가 **가설을 숫자로 확인한다**:

```
14:29:06  surface_ready      rowsOnPage 22 · stablePolls 3
14:29:15  locate_miss        verdict OUT_OF_LISTED_RANGE · targetBucket OLDER · targetBucketRowsSeen 0
                             screensSwept 15 · atBottom true
                             dateInputCount 2 · listStartDaysBefore 6 · listEndDaysBefore 0
                             pagerNumberCount 0 · highestPagerNumber 0
14:29:15  range_wait         waitMs 300000 · targetBucket OLDER
14:29:38  range_resweep      reason WINDOW_CHANGED · listStartDaysBefore 30 · listEndDaysBefore 0
14:29:48  range_resolved     via RESWEEP · screens 14
14:29:48  detail_control     candidates 1
14:29:50  detail_scope       candidates 2 · matched 1 · nested 1
14:29:50  open_composer      via detail · opened true
14:29:50  locate_composer    composersInRow 1
14:29:50  execution_observed COMPOSER_FILLED
```

**census가 두 가지를 확정했다.** 화면의 조회 기간은 `startDaysBefore 6 / endDaysBefore 0` — **최근 7일**
(2026-08-30 ~ 09-05)이고 대상은 8일 전이므로 **구조적으로 목록 밖**이었다. 그리고 **`pagerNumberCount 0`** — 이 화면에는
숫자 페이저가 **없다**. 즉 pagination은 애초에 답이 될 수 없었고, 기간 필터가 유일한 결정론적 경로라는 것이 추론이 아니라
**관측**으로 확정됐다. 판매자가 기간을 1개월로 바꾸자 census가 `startDaysBefore 30`을 읽어 `WINDOW_CHANGED`로 되감고,
새 목록의 **14번째 화면**에서 리뷰 id 지문이 **정확히 한 행**에 매치됐다.

신원 검사 셋은 그대로 서 있었다 — 행 id 지문(ladder) · 컨트롤 id 지문(`detail_control candidates 1`) · **패널 본문 지문**
(`detail_scope`: 후보 2 중 nested 1을 제거하고 `matched 1`). 그 뒤에야 composer가 열렸고, 행 범위 안 composer가 1개임을
확인한 뒤 승인된 초안이 들어갔다.

**DB 사후 상태**(마켓플레이스 WRITE 0 · submit 0):

| 항목 | 값 |
|---|---|
| `review_reply_execution` | **2행** — 09-03 proof(`c329471c`)와 **오늘의 `c7dd246d`(`471cf8ef`)** |
| 오늘 행 | `lane GUIDED` · `status COMPOSER_FILLED` · `verification COMPOSER_FILLED` |
| 승인 바인딩 | `approved_version 1` · `approved_fingerprint 27d352c5` — **승인된 초안 head와 일치** |
| `submission_ref` | `d02de359…`(단일 사용, 소진) |
| `provider_ref` | **비어 있음 — 게시 id가 없다** |
| `review_reply_outcome` | **0** |
| `reviews.reply_state` / `replied_at` | **`PENDING` / null** |
| 초안 | **v1 하나 그대로**(새 버전 0) |

`COMPOSER_FILLED` 뒤로 `submitted`·`SELLER_SUBMISSION_OBSERVED`·`OPERATOR_REPORTED` 마커는 **0**이고 terminal 마커도
없다 — run은 제출 barrier(`WAIT_FOR_SUBMIT`)에 그대로 서 있고, 그 다음 한 걸음은 **판매자의 클릭만** 만들 수 있다.
등록·저장·전송은 **누르지 않았다**.

*(로그 정직성: `aw_naver_reply_fill`은 이 경로에 남지 않는다 — 실제 타이핑은 래퍼 `GuidedFillReplyDriver.fillComposer`가
하고 ladder 드라이버의 동명 메서드를 거치지 않기 때문이다. fill의 로그 증거는 `aw_reply_execution_observed
{state: COMPOSER_FILLED}`이고, 이것은 엔진이 composer를 채웠다고 말했을 때만 세션이 낸다 — 2026-09-03 proof와 같은 기준.)*

### 5-7. 이번에 판매자가 추가로 한 일 — 숨기지 않고 friction으로 적는다

이 LIVE PASS는 **판매자의 추가 수동 동작 1회**에 의존했다: **판매자센터 리뷰 관리에서 조회 기간을 1개월로 바꾸고
[조회]를 누르는 것.** 로그인은 원래 있던 단계지만 이것은 아니다.

- **왜 자동화하지 않았나**: 기간을 바꾸려면 날짜를 입력하거나 [조회]를 눌러야 하고, 그것은 이 lane의 가장 강한 안전
  성질을 깨는 일이다 — `.click(`은 `reply-composer-open.ts` 한 파일에서 정확히 한 번, `.fill(`은
  `reply-composer-fill.ts` 한 파일뿐이며 그 밖의 마켓플레이스 클릭·타이핑은 **소스 스캔이 빌드에서 막는다**. 「숨은 연쇄
  클릭 금지」는 이 제품의 규칙이고, 판매자가 누르는 것을 우리가 감지·검증한다는 Action Window 계약 그대로다.
- **그래서 이것은 결함이 아니라 비용이다**: 파일럿 판매자는 오래된 리뷰에 답할 때마다 이 한 걸음을 하게 된다.
  화면이 그것을 **미리 말해 주기는 하지만**(§5-4의 전제 문장), 대기 중에는 아무 말도 하지 않는다(§5-5의 한계).
- **없앨 수 있는 방법과 그 대가**: (a) 목록 URL이 기간을 파라미터로 받는다면 landing navigation만으로 해결된다 — 오늘
  census는 pager·기간 구조를 **기록만** 하고 파라미터 이름을 추측하지 않는다(추측은 이 저장소가 금지한 것이다).
  (b) 기간 컨트롤을 우리가 조작하는 것 — **안 한다**(위). 즉 (a)를 관측으로 확인하기 전까지 이 한 걸음은 남는다.

## 6. 판정

**Guided Reply composer fill: `LIVE PASS`** (§5-6 — 승인된 대상 `471cf8ef`에 대해 exact locate → 상세 신원 재확인 →
composer open → 승인 초안 fill → `WAIT_FOR_SUBMIT`, 마켓플레이스 WRITE 0 · submit 0).

**첫 실제 판매자에게 그대로 넘기기: `BLOCKED`.** 리뷰 답변 lane 자체는 오늘 끝까지 돌았고, 막는 것은 이 sitting에서
새로 생긴 것이 아니라 §5가 이름 붙인 것과 `pilot_runtime_foundation_v1.md`가 이미 올려 둔 것이다.

**파일럿 전에 반드시**
1. **고정 공인 IPv4 + 안정적인 공개 HTTPS 호스트** — 없으면 NAVER 호출 IP 등록도 Cafe24 callback도 성립하지 않는다
   (코드 아님, 프로비저닝; `pilot_readiness_gate_v1.md` P0).
2. **retrieval v2 세 capability를 배포에서 켜기** — 끄면 판매자가 등록한 지식이 있어도 초안이 「기본 문구」로 나온다
   (§3-4에서 라이브로 확인). 코드 변경 0, 배포 결정.
3. ~~**Guided Reply는 dev bridge 전용이 아니어야 한다**~~ — **이 항목은 틀렸다(2026-09-05 정정,
   `pilot_release_closure_v1.md` §0).** 근거로 삼은 것이 코드가 아니라 낡은 주석이었다: DEV 게이트는 앞선
   패키지에서 이미 제거됐고 production 빌드 산출물에 reply carrier 연결 경로가 그대로 있다. 진짜 게이트는
   **빌드가 만드는 CSP**이며(`VITE_ENABLE_AGENT_BRIDGE`), 파일럿에서 그것을 켜는 설정이 없던 것이 실제 결함이다 —
   `pilot_release_closure_v1.md` §2에서 닫혔다.
4. **취득 계보 없는 리뷰는 실행 불가**를 화면이 말해야 한다 — Demo Org 기준 4,455건 중 **115건**만 `MARKETPLACE` identity를
   가진다. 나머지는 이유 없이 복사 경로로 떨어진다.

**나중에 해도 되는 것**: reply engine의 park/recheck(대기 중 화면 문구) · 기간 필터를 URL로 거는 자동 경로(오늘은 census가
pager·기간 구조를 기록만 한다) · §4의 friction 12종.

## 7. 검증

- backend **3,875** tests(skipped 25) · 실패 0 · collector **9,468**(skipped 152) · 실패 0 ·
  frontend **233 files / 2,755** · 실패 0 · `tsc` clean(collector에 HEAD부터 있던 테스트 파일 타입 오류 1건은 이 패키지가
  만든 것이 아니고 고치지 않았다: `reply-session.test.ts:105` `after.currentStep` possibly undefined).
- 새 테스트: locate 범위 판정 **7건**(`ladder-locate-range.test.ts`) · 멈춘 run의 화면 **2건**(`VocItemReplyPrep.test.tsx`).
  `reply-guard`의 소스 스캔은 새 모듈을 등록해 단언 **1,006 → 1,024**로 늘었다 — **완화 0**(등록을 잊으면 빌드가 깨지는
  그 규칙이 실제로 깨졌고, 그래서 등록했다).
- 브라우저: 1440 전 단계 스크린샷(scratchpad, 실제 고객 문장을 담아 저장소 밖), 1366/1152는 홈·문의 상세·리뷰 작업·상품·
  리포트·clean 연결/홈 — 가로 스크롤 0 · off-host 요청 0.
- 마켓플레이스: §5의 판매자센터 READ(로그인·리뷰 목록·상세 모달)와 **composer fill 1회** — **WRITE 0 · submit 0 ·
  등록/저장 0**. DB 변경은 §5-6의 `review_reply_execution` **1행**(승인된 실행의 기록) 하나이고 리뷰·초안·승인·outcome은
  **무변경**. 마이그레이션 0 · 모델 호출: 문의 초안 2 · 리뷰 초안 3 · 플래너 1 · 리포트 0(재열람).
