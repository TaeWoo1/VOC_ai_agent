# Coupang Connection UX v2 — 두 가지 방법, 그뿐

**2026-09-14 · `11ff6cfd` · `frontend/` 전용**(backend · collector · contracts · acquisition 계약 변경 0 ·
마이그레이션 0). 선행: `docs/catalogue_independent_review_ingest_v1.md`(카탈로그 독립 ingest) ·
`docs/local_helper_pilot_packaging_v1.md`(도우미) · `docs/sellerops_live_approval_contract.md`.

## 0. 왜 다시 그렸나 — 실측 먼저

코드를 고치기 전에 실제 org로 `/connect/channels/{account}`를 렌더해서 쟀다(1440×900@2×, 쿠팡 계정 1개):

| | |
|---|---|
| 문서 높이 | **3,796px** (뷰포트 900 → 4.2 화면) |
| 제목 · 컨트롤 · 입력칸 · 둥근 컨테이너 | **13 · 25 · 5 · 44** |
| 첫 화면 solid CTA | **3** — 상품평 보기(y=35) · 도우미 연결(y=551) · **지금 동기화(y=671, disabled)** |
| 「리뷰」를 말하는 곳 | **5곳** |

그리고 같은 페이지가 **같은 채널을 두 곳에서 반대로 설명**했다 — y≈779 「이 채널은 자동 수집을 지원하지
않습니다. 파일 업로드를 이용해 주세요」 ↔ y≈1489 「쿠팡 문의와 주문은 API로 자동 수집합니다」. 앞의 것은
**배포 사실**(`autoCollectSupported` = dedicated 커넥터가 해석되는가, 이 스택에서 커넥터 OFF)이고 뒤의 것은
**제품 사실**인데, 화면은 어느 질문에 답하는지 말하지 않았다. 같은 모양이 하나 더: 「다음 조치 · 아직 수집
이력이 없습니다」(API 연결 상태)가 「수집 이력 · 리뷰 · 실패 · 15분 전」(화면 수집 run) 위에 서 있었다.

**정상 흐름의 모든 안내가 placeholder였다.** 취득 run이 내보내는 copy key 넷
(`actionWindow.reviewAcquisition.{run,openList,confirmPage,handoff}`)은 `frontend/src` 전체에 **0회**
등장했다 → `resolveCopy` fallback 「안내를 준비하고 있어요」. 체크포인트 카드는 그 문자열을 20px 굵은
지시문으로 올리고 그 아래 [확인 완료]를 놓았다. 판매자가 수집 내내 읽은 것은 안내가 아니라 안내가 없다는 말.

그 밖에: 커넥터의 영문 `notes`가 판매자 문장으로 노출(「No review-retrieval endpoint in the official seller
API.」) · 기간 수집이 기본값 `["REVIEW","INQUIRY"]`로 **쿠팡에 없는 리뷰 경로**를 ✓로 켠 채 제공 · 커넥터가
꺼진 배포에서도 API 자격 폼 3칸이 그대로.

## 1. 판매자가 이해해야 하는 것은 둘이다

**리뷰 수집**(브라우저 · API 키 불필요)과 **문의·주문 자동 수집**(API). 카드마다 상태 한 단어 · 설명 한
문단 · 사실 한 줄 · **다음 걸음 하나**, 그 뒤에 접힌 설정. 파생은 한 곳(`lib/connect/coupangCapabilities.ts`)
— 두 카드가 각자 자기 사실을 재도출하면 언젠가 어긋나고, 어긋난 쪽이 어느 쪽인지 말할 사람이 없다.

**한 시점에 가장 강한 컨트롤은 하나다.** 끝나지 않은 연결이 있으면 그것이 이 화면의 다음 걸음이고, 없으면
이 화면이 존재하는 이유(상품평 가져오기)가 그 자리를 갖는다. 나머지는 보조.

**배포에서 돌지 않는 capability는 설정하게 하지 않는다**(product-owner decision). `autoCollectSupported`가
false이거나 **읽지 못했으면** 문의·주문 카드도 자격 폼도 **존재하지 않는다**(fail closed).

## 2. 수집 한 번 = 한 화면, 다섯 걸음

`/connect/channels/:accountId/review-collection`. **셋업이자 수집**이라 「리뷰 수집 연결하기」와 「지금
가져오기」가 같은 곳에 도착한다. 걸음은 `lib/connect/reviewCollection.ts`가 네 사실(계정 readiness · 도우미
한 단어 · run view · 도우미의 store bootstrap)에서 **하나**로 접는다.

```
S1 브라우저 수집 준비 → S2 쿠팡 판매자 화면 → S3 스토어 확인 → S4 가져오는 중 → S5 완료
```

**S3은 `readiness=READY`에서 렌더되지 않고 진행 표시의 칸도 없다** — 판매자가 답하는 질문이 1회인 것이
문구가 아니라 구조다.

**press는 남기고 기술어를 없앴다.** 취득 엔진은 대상 해석 뒤 반드시 멈추고 사람의 press를 기다린다
(`review-acquisition-engine.ts`: *"the seller's press is what lifts the barrier — every time"*). 그 장벽은
「reviewnary가 대신 클릭하지 않는다」를 강제하는 장치이므로 유지하고, 그 press를 판매자가 실제로 한 일로
부른다 — 「상품평 목록을 열었습니다」 · 「로그인했습니다」. 커맨드는 그대로 `REQUEST_STEP_RECHECK`.
「확인 완료」 · 「직접 진행」 · 「안내를 준비하고 있어요」는 이 lane에서 사라지고 소스 스캔 테스트가 고정한다.

**완료 문장은 이 걸음이 남긴 기록에서만 온다.** 시작 전 마지막 화면 수집 기록을 기억해 두고 새 기록이
생겼을 때만 그 수를 말한다. `CollectionReceipt` 셋 — `STORED`(그 기록의 수) · `NONE`(읽었고 새 기록 없음 →
「새로 가져올 상품평이 없었습니다」) · `UNKNOWN`(읽지 못함 → 수를 말하지 않는다). 읽지 못한 것은 「없었다」가
아니다.

## 3. 지운 것 (쿠팡 화면 한정 · NAVER·Cafe24 IA 무변경)

요약 KPI 블록 · 수집 가능 데이터 · 수집된 리뷰·문의 · 페이지 바닥의 범용 기간 지정 수집 · 다음 조치 패널 ·
정상 상태의 도우미 줄. 기간 수집은 capability 안으로 옮기고 **쿠팡 리뷰를 그 목록에서 뺐다**.
「리뷰 수집」이라는 이름은 쿠팡 카드가 갖고, 네이버 lane은 **「네이버 리뷰 기간별 가져오기」**가 된다.

## 4. after — 실측 (1440 · 1366 · 1152 동일)

| | before | after (커넥터 on) | after (커넥터 off) |
|---|---|---|---|
| 문서 높이 | 3,796px | **900px**(뷰포트 안) | **900px** |
| 제목 / 컨트롤 / 입력 / 컨테이너 | 13 / 25 / 5 / 44 | **3 / 3 / 0 / 2** | **2 / 2 / 0 / 1** |
| 첫 화면 solid | 3 (하나 disabled) | **1** | **1** |
| axe 위반 · 가로 스크롤 · off-host | 0 · 0 · 0 | **0 · 0 · 0** | **0 · 0 · 0** |

frontend **247 files / 2,971 tests / 실패 0** · typecheck clean. 계약이 바뀌어 다시 쓴 테스트 1건
(`OperationsHome`의 제목), 안전 테스트 약화 0.

## 5. LIVE PASS — 2026-09-14

승인 `apr-cp-catfree-77412f` / `wt-1da50f37` / `11ff6cfd`, mode `READ_ONLY`.
org `d7ff6ab6…`(상품 0 · 리뷰 0 · 자격 0 · `store_identity` 저장됨).

판매자 press **2회**로:

```
aw_coupang_review_aside_read  verdict=MATCH readReason=OK rows=10 pagerHasNext=true llmCalls=0
aw_coupang_review_acquisition_page  accepted=true fresh=9 known=1 stop=PAGE_LIMIT_REACHED pages=1
aw_coupang_review_handoff  received=9 stored=9 skipped=0 failed=0 unlinked=9
```

- **canonical product 없이 drop 0** — 9행 전부 `product_id IS NULL`, `source_product_ref`·
  `source_product_name` 보존(고유 ref 7), `data_origin=REAL`, `sync_jobs` **PARTIAL**(`successRows=9`).
- **denominator 안전** — `/api/products/catalog` **total 0**. unresolved 행은 상품처럼 세지지 않는다.
- **화면** — Review Core 9건(채널이 준 상품명 표시, `productId` null), 홈 리뷰 KPI **4**(7일 창) ·
  `reviewState=OBSERVED_FRESHNESS_UNPROVEN` · `countedInReviews=true`.
- **금지 동작 0** — click/fill/download/pagination 로그 0(`pagerHasNext:true`인데 `pages:1`) ·
  `llmCalls:0` · OpenAPI 0 · 자격 읽기 0 · 마켓플레이스 WRITE 0. backend ERROR 0.

## 6. 고치지 않고 보고한 것

1. **S2 문구가 제품이 이미 하는 일을 판매자에게 시킨다.** ASIDE 실행기는 `openTab(entryUrl)`으로
   **상품평 목록 URL을 스스로 연다**(`COUPANG_WING_REVIEW_LIST_URL`). 그런데 S2는 「쿠팡 창에서 상품평
   목록을 열어 주세요」라고 말한다 — 옛 장벽 문구를 그대로 옮긴 결과다. 그 press가 실제로 뜻하는 것은
   **「내 판매자센터를 열어 읽어도 된다」는 승낙**이고, 남는 사람의 일은 **로그인**뿐이다
   (`authScript` → `signedIn` false면 `AUTH_REQUIRED`로 fail closed). 문구 한 줄의 문제가 아니라 press의
   **의미**를 다시 이름 붙이는 일이라 product-owner 결정으로 올린다.
2. **자동 로그인은 하지 않는다.** 쿠팡 비밀번호는 저장하지 않고(도우미는 device token만 보유,
   `HELPER_ENV_KEYS`에서 EMAIL/PASSWORD 삭제됨), OpenAPI access/secret은 **API 인증**이라 WING 웹 세션을
   만들 수 없다. 다만 도우미 브라우저 프로필은 영속이라 **로그인은 보통 1회**다.
3. **error/recovery 라이브 미관측** — 라이브 blocker를 만들려면 마켓플레이스 run이 한 번 더 필요하다.
   테스트로 고정(`STORE_MISMATCH`가 스토어 걸음의 실패로 붙고, 정상 걸음에는 복구 UI가 **없다**).
4. **dedup 안정성 라이브 미관측** — 같은 페이지 재수집이 중복을 만들지 않는다는 것은
   `CatalogueIndependentReviewIngestTest`가 고정하고, 라이브에서는 run 1회만 썼다.
5. NAVER·Cafe24 채널 화면은 옛 레이아웃 그대로(product-owner decision: 공통화는 파일럿 증거 후).
