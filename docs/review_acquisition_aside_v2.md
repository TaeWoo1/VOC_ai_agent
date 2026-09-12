# Review Acquisition — Aside v2 — TARGET DESIGN

> **문서 성격.** Aside Acquisition Track의 **목표 구조**다. 여기 적힌 것은 **아직 구현되지 않았다**. 현행 구현은
> `docs/review_acquisition_baseline_v1.md`(CURRENT FACT)가 소유하고, 이 문서는 그 위에서 무엇을 어떻게 바꾸려
> 하는지를 적는다. 모든 절은 **TARGET DESIGN**이며, 검증되지 않은 가정은 **HYPOTHESIS / OPEN QUESTION**으로
> 따로 표시한다. 제품·정책·운영 결정이 필요한 항목은 **PRODUCT_DECISION_NEEDED**로 번호를 붙인다.
>
> 작성 조건: 코드 수정 0 · branch/worktree/tag 0 · Aside MCP 호출 0 · NAVER UI 조작 0. Aside 자체의 내부 동작은
> 이 저장소에서 확인할 수 없으므로 **Aside에 대한 문장은 전부 HYPOTHESIS**다.
>
> Astra 관련 논의는 이 문서에서 제외한다.
>
> **v2.1 (2026-09-12) — product-owner 결정 반영.** PD-1 ~ PD-8이 결정됐다(§17). 각 절의 TARGET DESIGN은 그 결정을
> 따르며, 결정 이전의 대안은 지웠거나 「기각」으로 남겼다. Q-1은 여전히 OPEN이다. 코드·enum·schema는 **하나도 바뀌지 않았다**.

---

## 0. 목적 (변하지 않는 것과 검증하려는 것)

**변하지 않는 것 — Reviewnary Core.** canonical commerce/review data · Review Attention · Seller Knowledge/RAG ·
Seller Decision/Decision History · Workflow State · Repeated Issue · Product Intelligence. 이들은 `reviews`와
`sync_jobs`만 읽으며 취득 방식을 모른다(baseline §15). Aside 도입은 이 층을 **한 줄도** 바꾸지 않는 것을 성공
조건으로 둔다.

**검증하려는 것.** Reviewnary가 직접 소유할 가치가 낮고 운영 부담이 큰 다음 층을 **교체 가능한 infrastructure**로
분리할 수 있는가:
- authenticated browser session
- login/session handling
- seller center UI navigation
- official export interaction
- download handling

baseline §5·§6·§7이 보여주듯 이 다섯은 오늘 전부 판매자 PC의 도우미(collector)가 Playwright persistent
profile 위에서 든다.

## 1. 목표 architecture principle

1. **Reviewnary owns state.** plan · segment · launch ticket · attempt · `sync_jobs` · `reviews` · provenance ·
   readiness — 전부 백엔드 DB. 실행 provider는 상태를 소유하지 않는다.
2. **Aside owns authenticated execution.** 브라우저 세션·로그인 상태·판매자센터 navigation·export 클릭·download는
   Aside가 수행한다.
3. **Execution is replaceable.** Aside는 `ExecutionProvider` 구현체 **중 하나**다. 오늘의 Local Helper가 다른
   하나이고, 수동 업로드가 세 번째다. 셋은 같은 ingestion 계약에 착지한다.
4. **Every sync is observable and idempotent.** 한 run = `sync_jobs` 1행 + attempt 1행 + 실행 로그; 같은 run을 두 번
   실행해도 `reviews`는 한 번만 늘어난다.
5. **Ambiguous automation fails closed.** 스토어 불일치 · 기간 불일치 · 파일 판별 실패 · 세션 불명은 전부 정지.
   추측으로 진행하지 않는다.

## 2. 책임 분할: Reviewnary / Runner / Aside

| 층 | 소유 | 소유하지 않음 |
|---|---|---|
| **Reviewnary (backend + FE)** | plan/segment/launch(기존 V27/V28 그대로) · `ExecutionProvider` 선택 · run 발급·소진 · scope 해석 · 파일 수신 · parser/normalization/dedup/ingest(기존) · provenance(`sync_jobs.method`, `acquisition_sync_job_id`) · freshness · 실패 taxonomy 저장 · 수동 fallback UI | 브라우저 · cookie · 판매자센터 URL 탐색 · 클릭 |
| **Runner** | Reviewnary가 발급한 run 하나를 받아 Aside에 **실행 요청**을 내고, Aside가 만든 **파일**을 받아 Reviewnary ingest endpoint에 올리며, 실행 결과를 run에 기록하는 얇은 adapter. 상태 없음(run token만 일시 보유) | 세션 · 파일 장기 보관 · 스케줄 결정 · dedup |
| **Aside** | 판매자가 접근 권한을 가진 Seller Center의 **공식 UI** 위에서: 로그인 상태 유지·복구 · 올바른 SmartStore 선택 · 공식 Review Management 진입 · 기간 설정 · 공식 Excel Export 실행 · download 완료 → Runner에 파일 전달 · 관측한 스토어 identity·세션 상태 보고 | Reviewnary 상태 · 파싱 · dedup · 리뷰 저장 · 회신/삭제/신고 등 어떤 WRITE |

**DECIDED PD-1 (2026-09-12).** 초기 PoC 배치:
```
Reviewnary Cloud   → Sync Job / state (plan · segment · launch · attempt · sync_jobs · reviews · provenance)
Seller PC          → Reviewnary Runner → Aside invocation → temporary export → existing parse/normalize/upload
```
credential/session은 **Reviewnary Cloud로 이동시키지 않는다.** Runner는 판매자 PC에서 돌며, baseline의 도우미가 서 있던
자리(loopback·device token·gitignored 로컬 상태)를 그대로 물려받는다. Cloud가 얻는 것은 상태와 결과뿐이다.

## 3. NAVER Review Export target pipeline (첫 PoC 범위)

```
one explicit run
  ├─ [Reviewnary] 판매자가 FE에서 「이번 한 번 실행」을 명시적으로 승인 → run 발급 (launch_ref 재사용, kind=SEGMENT)
  ├─ [Runner]     GET /launches/{ref}/scope → {accountSlot, required:{start,end}, expected store identity ref}
  ├─ [Aside]      correct SmartStore   — 관측된 스토어 identity를 보고(§6), Runner/Reviewnary가 대조, 불일치 → STOP
  ├─ [Aside]      official Review Management — 공식 UI 라우트로 진입
  ├─ [Aside]      correct period     — required 범위를 설정하고 **설정된 값을 읽어 되돌려 보고**(scope read-back)
  ├─ [Aside]      official Excel Export — 공식 export 컨트롤 실행, 동의 dialog 처리
  ├─ [Aside→Runner] local file       — download 완료 바이트 (+ 파일 sha256 · size · 관측 파일명 category)
  ├─ [Runner]     existing parser/normalization — POST /api/imports/reviews/launches/{ref}/ingest (바이트, scopeEvidence)
  ├─ [Reviewnary] existing ingestion — UploadFormat → FileParser → ReviewRowMapper → IngestionService (변경 0)
  └─ [Reviewnary] canonical Review    — reviews INSERT, acquisition_sync_job_id, attempt SUCCEEDED, segment COVERED
```
- **scheduler / unattended automation은 PoC 범위가 아니다.** 「one explicit run」은 판매자(또는 운영자)가 매 run을
  명시적으로 시작한다는 뜻이다.
- 재사용 대상(변경 0): `review_import_plan/segment/launch/attempt`, `ReviewImportLaunchService`,
  `ReviewImportRunService`, `FileUploadConnector`, `UploadFormat`, `FileParser`, `ReviewRowMapper`,
  `IngestionService`, `ReviewDedupKey`, `IngestFollowUp`, `ReviewImportIdentityFence`.
- 새로 필요한 것의 최소 후보: (a) run이 어느 provider로 실행됐는지 기록할 자리, (b) Aside 실행 요청/응답 adapter
  (Runner), (c) provider별 실패 코드의 공통 taxonomy(§8). 각각의 구체 형태는 PoC 전 결정.

## 4. credential / session ownership

| 비밀 | baseline(CURRENT FACT) | TARGET |
|---|---|---|
| NAVER 판매자센터 로그인 세션(cookie·storage) | 판매자 PC Chrome profile 파일. Reviewnary 서버 0 | **Aside가 소유.** Reviewnary·Runner는 cookie·비밀번호·세션 토큰을 **받지도 저장하지도 로깅하지도 않는다** |
| 로그인 행위 | 판매자가 직접 타이핑 | Aside 세션 안에서 이루어진다. **Reviewnary는 로그인 자동화를 구현하지 않는다**(있다면 Aside 측 사실이며 이 저장소 밖) |
| Reviewnary ↔ Runner | (도우미) device token `rvh_` | 같은 종류의 **scoped·revocable run 자격** — 값·유효기간·allow-list 경로는 기존 device token 모델을 따른다 |
| Runner ↔ Aside | 없음 | Aside 측 인증. **Reviewnary 저장소에 Aside 자격을 커밋하지 않는다** |
| run 권한 | `launch_ref` 16-hex 단일 사용 | 동일. Aside에게는 ref가 아니라 **범위 사실(기간·스토어 기대치)**만 전달한다(ref는 ingest 권한이므로 provider에 주지 않는다) |

**DECIDED PD-2 (2026-09-12).** 정상적으로 로그인된 Aside/browser session을 **쓰는 것**은 허용 목표다. 그러나 login
interaction · MFA · CAPTCHA · re-authentication이 필요한 순간에는 **자동 우회하지 않는다** — run은 `AUTH_REQUIRED`로
fail closed하고, 사람이 정상 인증을 완료한 뒤 새 run으로 진행한다. CLAUDE.md fence(CAPTCHA/2FA 우회 금지)는 provider가
누구든 유지된다.

**HYPOTHESIS H-2 (잔여).** Aside가 세션을 어디에 어떤 형태로 보관하는지, 인증 필요 상태를 어떤 신호로 노출하는지는 PoC에서
확인한다. 그 신호가 없으면 `AUTH_REQUIRED`와 `UNSUPPORTED_STATE`를 가를 수 없고, 둘 다 정지이므로 안전은 유지되나 안내
문장은 약해진다.

## 5. SyncRun ownership

- run identity·수명·결과는 **Reviewnary**가 소유한다: `sync_jobs` 1행(`method`, `data_type=REVIEW`, counts, status)
  + `review_import_segment_attempt` 1행 + `review_import_launch` 소진. baseline과 동일한 표.
- provider는 run을 만들 수 없고, 이미 발급된 run에 **결과를 붙일 수만** 있다(ingest endpoint 1회, 실패 보고 1회).
- **DECIDED PD-3 (2026-09-12).** `CollectionMethod`는 **acquisition provenance의 의미**를 나타내고, Aside 경로도
  `SELLER_CENTER_EXPORT` semantic을 **유지**한다(판매자센터가 만든 공식 export 파일이라는 사실은 실행 주체와 무관하다). 실행
  구현은 **별도 axis `ExecutionProvider`**(예상 값 `LOCAL_HELPER · ASIDE · future provider`)로 분리한다. 그 결과
  `observesChannel()` · `ExecutableIdentityResolver` · coverage는 **변경 없이** Aside run을 기존 export와 같게 취급한다.
  `ExecutionProvider`의 저장 위치(`sync_jobs` 컬럼 vs attempt 컬럼)·enum·schema는 **아직 수정하지 않는다** — 구현 단계 결정.
- 실행 로그(Aside가 무엇을 했는가)는 run에 **sanitized enum/count**로만 붙인다. baseline의 wire 금지 필드
  (selector·URL·path·credential·page content)는 provider 응답에도 그대로 적용.

## 6. multiple store identity verification

baseline §14의 공백 — guided import는 slot별 profile 격리에만 의존하고 run 시점 스토어 대조가 없다 — 을 Aside
경로에서는 **구조로** 닫는다.

- Reviewnary는 연결 시 계정에 대해 **expected store identity fingerprint**(salted one-way hash; baseline의
  `account-fingerprint.ts` 계약과 같은 모양)를 저장한다. `[현재 `seller_accounts`/`account_session_slot`에 그 컬럼이
  있는지 미확인 — 없으면 추가 대상]`
- Aside는 run마다 **로그인된 스토어의 stable identity token을 관측해 보고**한다(raw는 Runner에서 즉시 hash, 서버에는
  hash만).
- 일치 ⇒ 진행. 불일치·미관측·복수 후보 ⇒ `STORE_MISMATCH` / `STORE_UNRESOLVED`로 **정지, 파일 미수신, ingest 0**.
- 계정 2개 이상이 같은 채널에 연결된 org에서 이 규칙이 첫 라이브 검증 대상이다(baseline: 계정 1곳만 검증).

**DECIDED PD-4 (2026-09-12).** Aside 실행 결과는 **ingest 전에** expected store와 observed store를 대조해야 한다.
**display name 단독은 충분한 증명이 아니다** — 채널이 UI/export에서 제공하는 **stable channel-native store/account
identifier**를 우선한다. 충분한 identity proof를 얻지 못하면 잘못된 store를 성공 처리하지 않고 **fail closed**한다
(`STORE_UNRESOLVED`).

**HYPOTHESIS H-3 (잔여, PoC 확인 항목).** 현재 NAVER workflow에서 실제로 어떤 machine-verifiable identifier를 얻을 수
있는지는 미확인이다. baseline의 `account-fingerprint.ts`는 `FingerprintSourceCategory`(commerce-id / store-url-path /
account-scope)를 후보로 두고 있어 그 어휘를 재사용할 수 있으나, Aside 경로에서 같은 값을 관측할 수 있는지는 PoC의 첫
측정 대상이다.

## 7. file lifecycle

**DECIDED PD-5 · PD-6 · PD-8 (2026-09-12).** 목표 기본값(PD-8 = option (a)로 확정된 순서):
```
Seller PC / Runner
  → official XLSX download
  → local SHA-256
  → existing Reviewnary ingestion endpoint로 raw bytes 전송
  → backend: 기존 UploadFormat / FileParser / ReviewRowMapper로 memory parse / normalize / dedup / ingest
  → server ACK
  → Runner가 local raw file 삭제
```
다섯 가지를 명시한다:
1. **raw bytes transit** — raw 바이트는 Cloud를 **통과한다**. 「Cloud에 raw XLSX를 저장하지 않는다」는 「raw bytes가 Cloud를
   통과하지 않는다」는 뜻이 **아니다**.
2. **backend memory parse** — 파싱은 요청 스트림 위에서만 일어나고 파일 핸들·임시 파일·blob 저장을 만들지 않는다.
3. **no persistent raw cloud storage** — Cloud에 raw XLSX 영속 저장 0(CURRENT FACT와 동일; 유지가 목표).
4. **ACK 후 local delete** — Runner는 attempt 결과(ACK)를 받은 뒤에만 raw를 지운다. 실패면 local quarantine(TTL 미정).
5. **canonical parser single-source** — PoC에서 Runner-side parser·normalized-row endpoint는 **만들지 않는다**. 헤더 alias·dedup
   규칙·`ReviewDedupKey`의 두 번째 사본이 생기지 않게 하는 것이 우선이다. privacy / offline / bandwidth 요구가 **실제로
   확인될 때만** 재검토한다.
- Reviewnary Cloud에는 **raw XLSX를 기본 저장하지 않는다.** (CURRENT FACT 확인: 오늘의 ingest endpoint도 `MultipartFile`
  스트림을 메모리에서 파싱하며 파일을 디스크·DB에 남기지 않는다 — `FileUploadConnector` · `ReviewImportPlanController`에
  `transferTo`/파일 저장 코드 없음. 즉 “Cloud에 raw 없음”은 이미 성립하고, 목표는 그것을 **유지**하는 것이다.)
- 실패한 artifact는 **local quarantine 가능**(baseline `.aw-quarantine/`와 같은 자리). failure retention **TTL은 구현 결정**으로
  남긴다.
- **판매자용 raw export copy는 초기 PoC에서 자동 보존하지 않는다**(PD-6). baseline의 `saveManagedCopy`(`downloads/`)는
  Aside 경로에서는 **켜지 않는다**. 향후 explicit user option은 별도 검토.
- 파일명은 category(확장자 유무)만 — NAVER export는 확장자 없는 UUID명(baseline §2.4).

| 단계 | 소유 | TARGET |
|---|---|---|
| download 완료 | Aside | 하나의 run에 묶인 임시 산출물 |
| SHA-256 · validate | Runner | sha256는 idempotency key 재료(§8); validate는 바이트 sniff(OOXML/CSV) — `UNKNOWN`이면 `ARTIFACT_INVALID`, 업로드 0 |
| parse / normalize | **Reviewnary backend** (DECIDED PD-8 = option a) | 기존 `UploadFormat`·`FileParser`·`ReviewRowMapper`가 **메모리에서** parse/normalize/dedup/ingest. Runner에 파서 0 |
| upload | Runner → Reviewnary | 기존 `/api/imports/reviews/launches/{ref}/ingest`로 **raw bytes 전송**(multipart). normalized-row endpoint는 만들지 않는다 |
| ACK | Reviewnary | attempt SUCCEEDED/FAILED + counts |
| local raw delete | Runner | ACK 즉시. 실패 시 quarantine(TTL 미정) |

## 8. at-least-once + idempotent ingestion

- 전달은 **at-least-once**로 설계한다: Runner는 ingest 응답을 못 받으면 같은 바이트를 **같은 idempotency key**로 재전송할 수 있다.
- idempotency는 세 층에서 이미 존재한다(baseline §12): `launch_ref` 단일 사용(같은 ref 2회 → 409) · `uq_reviews_external`
  (리뷰글번호) · `uq_reviews_hash`. 그래서 **재전송의 최악 결과는 409이지 중복 리뷰가 아니다.**
- 남는 문제는 **attempt 카운트의 이중 계상**(Coupang handoff가 재시도를 금지한 이유). TARGET: Runner 재전송은
  `Idempotency-Key = sha256(launch_ref ‖ file_sha256)`를 싣고, 서버는 같은 키의 두 번째 요청에 **첫 응답을 그대로**
  돌려준다(attempt 추가 0). `[서버에 idempotency-key 저장소가 없음 — 추가 대상]`
- 파일이 다른 sha256이면 다른 attempt(재export). 같은 sha256이면 같은 attempt.

## 9. fail-closed behavior

정지(파일 미수신·ingest 0)해야 하는 조건 — 어느 것도 provider가 “대충 진행”할 수 없다:
- 세션 불명(`UNKNOWN`) · 로그인 필요 · 2FA/CAPTCHA 도달 · 계정 선택 화면
- 스토어 identity 불일치·미관측(§6)
- 기간 read-back `MISMATCH` 또는 읽기 불가(read-back 없는 실행은 `OPERATOR_CONFIRMED`로만 인정 — 사람이 확인하지 않은
  Aside 실행을 `MACHINE_MATCHED`로 올리지 않는다)
- export 컨트롤 0개 또는 2개 이상이고 규칙으로 하나를 고를 수 없음
- download 미발생/타임아웃 · 파일이 OOXML/CSV로 판별되지 않음
- 공식 UI 밖의 경로(내부 endpoint·네트워크 가로채기)를 써야만 진행 가능한 상황 — **금지**(§12)

## 10. failure taxonomy (provider-neutral)

baseline의 엔진 코드를 상위 집합으로 유지하고 provider 축을 더한다:

| 군 | 코드(기존 재사용) | Aside 경로에서 추가 |
|---|---|---|
| 세션 | `LOGIN_REQUIRED` · `SESSION_EXPIRED` · `UNSUPPORTED_STATE` | **`AUTH_REQUIRED`**(PD-2: login/MFA/CAPTCHA/re-auth 어느 것이든 — 사람이 정상 인증) · `TWO_FACTOR_REQUIRED`(readiness 계약에 이미 있음, `AUTH_REQUIRED`의 세부) |
| 대상 | `TARGET_NOT_FOUND` · `TARGET_AMBIGUOUS` | — |
| 범위 | `SCOPE_MISMATCH` | `SCOPE_UNREADABLE` |
| identity | (없음) | `STORE_MISMATCH` · `STORE_UNRESOLVED` |
| 산출물 | `DOWNLOAD_TIMEOUT` · `ARTIFACT_INVALID` | `TRANSFER_FAILED`(Aside→Runner) |
| ingest | `INGEST_FAILED` | `INGEST_DUPLICATE_REQUEST`(idempotency 재응답, 실패 아님) |
| provider | `RUNTIME_FAULT` | `PROVIDER_UNAVAILABLE` · `PROVIDER_REFUSED`(정책·권한) · `PROVIDER_TIMEOUT` |

각 코드는 `recoverable` boolean과 **한 가지 권장 행동**(재시도 / 판매자 로그인 / 수동 업로드 / 운영자 확인)을 갖는다.
raw 메시지·URL·selector는 코드에 실리지 않는다.

## 11. freshness

- baseline: coverage는 `sync_jobs` 중 `method.observesChannel()`이고 `data_type=REVIEW`인 최신 SUCCESS로 결정.
- TARGET: Aside run이 성공하면 같은 규칙으로 **채널을 관측한 시각**이 된다(그 순간 판매자센터에 있던 것을 export했으므로).
  §5의 PD-3 결정에 따라 `observesChannel()` 분기만 맞추면 coverage/`ChannelDataState` 변경 0.
- freshness는 **run 성공 시각**이지 파일 download 시각도, Aside 세션 시각도 아니다(baseline `sync-state.ts` 원칙 유지).

## 12. 정책 경계 (허용/제외)

허용: 판매자가 접근 권한을 가진 Seller Center · 공식 UI · 공식 Review Management · 공식 Excel Export · local download.
제외(이 track에서 만들지 않는다): private/internal endpoint discovery · network reverse engineering · hidden endpoint
invocation · bot protection bypass · arbitrary crawling · seller reply/write/delete/report · unrelated seller data.

**OPEN QUESTION Q-1.** scheduled unattended execution의 정책 적합성은 CURRENT FACT가 아니다. 이 문서는 그것을
**결정하지 않는다.** PoC는 explicit run만.

**DECIDED PD-7 (2026-09-12) — explicit human checkpoint.** 사용자가 Reviewnary에서 명시적으로 **「지금 동기화」**를
요청한 **한 번의 실행**은 bounded browser export workflow에 대한 human checkpoint로 **인정한다**. 따라서 CLAUDE.md fence
(「No automatic export / download / submit as product behavior — only through an explicit, approved human checkpoint」)는
**제거하지 않으며**, Aside workflow는 그 fence **안에서** 동작하도록 설계한다.

승인은 **run-scoped**여야 한다. 최소 scope:
```
organization · channel · store account · requested source period · workflow/version · single-use execution
```
이 승인은 다음으로 **확장되지 않는다**: scheduled unattended execution · perpetual browser permission ·
reply/write/delete/report action · 다른 store/account · 다른 기간/목적.

CURRENT FACT와의 대응: baseline의 `review_import_launch`(org · seller_account · channel · segment 기간 · kind · 단일 사용,
V28)가 이미 그 scope의 다섯 축을 들고 있다. 빠진 축은 **workflow/version**뿐이며, 이것이 §5의 `ExecutionProvider` axis와
함께 저장될 후보다(구현 단계 결정). 즉 PD-7의 승인 객체는 새 표가 아니라 **기존 launch ticket의 의미 확장**으로 표현될
수 있다 — 단, 이는 TARGET이지 결정된 스키마가 아니다.

Q-2는 PD-7로 닫혔다.

## 13. manual fallback

- 기존 수동 경로(`ReviewImportRunService.importSegment(..., OPERATOR_CONFIRMED)` + FE 파일 업로드 + `/api/uploads`)는
  **그대로** 유지된다. provider가 무엇이든 실패의 마지막 출구는 판매자의 파일 업로드다.
- 기존 Local Helper 경로도 PoC 동안 **삭제하지 않는다**(§14). Aside 실패 시 helper로 돌아갈 수 있어야 “교체 가능”이
  증명된다.

## 14. provider replaceability

**seam 후보 (CURRENT FACT에서 도출).** baseline §0의 첫 coupling 지점 — `ImportProbeDriver`(15 메서드, 클릭 없음) —
는 이미 “브라우저를 어떻게 다루는가”를 엔진에서 분리해 둔 인터페이스다. 그러나 그 메서드 어휘(`highlightTarget` ·
`armTargetObserve` · `waitForTargetAction` · `renderGuidance`)는 **판매자가 누르고 런타임이 관찰한다**는 모양에 묶여
있다. Aside는 관찰이 아니라 실행이므로 이 인터페이스를 그대로 구현하면 절반이 no-op이 된다.

TARGET: 한 단계 위의 더 작은 계약 —

```
ExecutionProvider (TARGET — PD-3로 axis 이름은 채택, 계약 모양은 가안)
  kind: LOCAL_HELPER | ASIDE | future provider  (MANUAL은 provider가 아니라 fallback 경로 — 관측값 0)
  execute(run: {expectedStoreRef, required:{start,end}, deadline}) ->
    | { ok: true,  artifact: {bytes, sha256, size, nameCategory}, observed: {storeIdHash, scope: MATCH|MISMATCH|UNREADABLE, readiness} }
    | { ok: false, code: FailureCode, recoverable: boolean, observed?: {...} }
```
- `LOCAL_HELPER`는 오늘의 ImportSegmentEngine+driver 전체를 이 계약 뒤에 **감싼다**(WRAP; 내부 변경 0).
- `ASIDE`는 Runner가 구현한다.
- `MANUAL`은 FE 업로드가 구현한다(관측값 없음 → `OPERATOR_CONFIRMED`).
- 계약 밖으로 나오는 값은 sanitized enum·count·hash·바이트뿐. baseline의 `findProhibitedFields` gate를 provider
  응답에도 적용한다.

**HYPOTHESIS H-4.** 이 계약이 Aside의 실제 실행 모델(동기/비동기, 콜백/폴링)과 맞는지는 Aside capability를 확인해야
안다. PoC 전 read-only capability 조사가 선행 단계다(§16).

**IMPLEMENTED EXPERIMENT (2026-09-12, `experiment/aside-executor`, `docs/aside_execution_provider_v1.md`).** H-4는
답했다: Aside의 `repl`은 요청-응답 동기이고, 계약은 위 가안과 **모양이 다르게** 코드가 됐다. 공유 계약은
`SegmentExecutionProvider.start(request, ctx) → HostedSegmentRun`(ImportSegmentHost의 `HOST_SEGMENT` 결정 뒤,
outcome은 ingest 이후)이다 — `execute(run) → {artifact bytes}`는 LOCAL_HELPER가 구현할 수 없기 때문이다(그 run은
세션·판매자 클릭·in-session ingest·delete-after-validate와 분리되지 않는다). "파일을 돌려주는" 계약은 ASIDE 내부의
executor 층에만 있다. `LOCAL_HELPER`는 WRAP(내부 변경 0, 기존 스위트 무수정 green), `ASIDE`는 로컬 fixture에서
실제 Aside 브라우저로 download → host path → SHA-256 → validate → delete → (simulated) ingest까지 증명됐다.
NAVER workflow·실제 export·FE wire는 M3.

## 15. 첫 PoC 성공 기준 (측정 가능한 것만)

1. explicit run 1회로 `review_import_segment_attempt` 1행 `SUCCEEDED`, `scope_evidence` 기록.
2. `reviews` 증가분 == `rows_new`, `rows_duplicate`가 기존 보유분과 일치(2026-09-02 라이브와 같은 검사).
3. 같은 파일 재전송 → attempt 추가 0, `reviews` 증가 0.
4. Reviewnary 서버·Runner 로그·DB 어디에도 cookie/비밀번호/세션 토큰/URL/selector **0**(기존 no-leak 테스트 방식).
5. 스토어 불일치 fixture에서 파일 미수신·ingest 0(PD-4); 인증 필요 fixture에서 `AUTH_REQUIRED` 정지·우회 0(PD-2).
6. 마켓플레이스 WRITE 0 · 공식 UI 밖 요청 0(Aside 측 관측 가능 범위 내에서).
7. Local Helper 경로 회귀 green(교체 가능성의 증거).
8. 승인 1건 = run 1건: 같은 승인으로 두 번째 실행 불가, 다른 store/기간으로 실행 불가(PD-7).

## 15-A. 실행 상태 (2026-09-12 갱신 — 이 절만 갱신, 나머지 재작성 0)

- **M1+M2 — DONE.** Execution provider seam + Aside adapter, 로컬 fixture E2E green
  (`docs/aside_execution_provider_v1.md`).
- **NAVER one-explicit-run PoC — `DEFERRED_BY_ENVIRONMENT`** (operator 환경, 2026-09-12). Seller Center 접근
  **0**(tab·click·login·observation·export·download 전부 0). 준비했던 manifest `apr-nv-aside-obs-r1`은
  **미승인 종료**. 따라서 **§6 H-3(NAVER store identity)은 OPEN/DEFERRED** — 이 날짜의 어떤 관측도 H-3의
  근거가 아니다.
- **M3-C Coupang WING — Phase A(read-only observation) DONE**(승인 `apr-cp-aside-obs-64cdf0`).
  **C-H3 = `C_H3_CONFIRMED`**: 채널 고유 식별자 **업체코드**가 리뷰 목록 화면 자체에서 관측되고, 같은 값이
  이미 `vendor_id`로 봉인돼 있어 expected/observed 비교가 성립한다. §6이 요구한 「expected store identity
  fingerprint」는 **새 컬럼 없이** 기존 credential에서 파생된다.
  **Phase B 실행됨 · `LIVE PASS`**(승인 `apr-cp-aside-acq-128151`, 1페이지 bounded read): identity MATCH ·
  `llmCalls 0` · 마켓플레이스 클릭 0 · 기존 handoff → ingestion → **dedup(received 9 · stored 0 · skipped 9)**
  → canonical reviews → Review Core 읽기까지 확인. COUPANG `REAL` 23 → 32.
  증거: `docs/coupang_aside_review_acquisition_poc_v1.md`, `docs/evidence/INDEX.md` 2026-09-12 행.
- **§7 file lifecycle은 Coupang lane에 해당 없음**: WING에는 공식 export가 없어 이 lane의 산출물은 파일이
  아니라 **정규화된 row**이고, 기존 `POST /api/agent/review-handoff` 1회 · `SELLER_CENTER_READ` ·
  content-based dedup(v2)을 그대로 쓴다. NAVER의 file contract를 Coupang에 재사용하지 않았다.

## 16. 다음 단계 (제안 — 실행은 product-owner 확인 후)

1. ~~PD-1 ~ PD-7 답변~~ — **2026-09-12 결정됨(§17)**. 남은 것: Q-1뿐(PD-8도 2026-09-12 결정됨).
1-a. pre-Aside baseline commit 확정(`docs/review_acquisition_baseline_v1.md` 부록 B).
2. Aside capability **read-only 조사**(무엇을 관측·보고할 수 있는가; 세션·identity·파일 전달 모양). NAVER 접촉 0.
3. `ExecutionProvider` 계약 초안을 계약(`contracts/`)으로 먼저 고정하고, `LOCAL_HELPER` wrap이 기존 테스트를 그대로
   통과하는지 확인.
4. 그 다음에야 baseline tag · experiment branch · PoC.

---

## 17. Product decisions (2026-09-12 반영) 및 남은 결정

| # | 결정 | 상태 | 반영 절 |
|---|---|---|---|
| PD-1 | Runner = **Seller PC**; Cloud = Sync Job/state; credential/session은 Cloud로 이동 안 함 | **DECIDED** | §2 |
| PD-2 | 정상 로그인 세션 사용 허용; login/MFA/CAPTCHA/re-auth는 **`AUTH_REQUIRED` fail closed**, 우회 0 | **DECIDED** | §4 · §10 |
| PD-3 | `CollectionMethod = SELLER_CENTER_EXPORT` semantic 유지; 실행 구현은 별도 axis **`ExecutionProvider`**(`LOCAL_HELPER · ASIDE · future`); enum/schema/code 미수정 | **DECIDED** | §5 · §11 · §14 |
| PD-4 | ingest 전 expected/observed store 대조; display name 단독 불충분; channel-native stable id 우선; 증명 부족 시 fail closed | **DECIDED** (실제 identifier는 PoC 확인) | §6 |
| PD-5 | download → SHA-256 → validate → parse/normalize → upload normalized → ACK → local raw delete; Cloud에 raw XLSX 기본 미저장; 실패 artifact local quarantine 가능; TTL은 구현 결정 | **DECIDED** | §7 |
| PD-6 | seller용 raw export copy 자동 보존 안 함(초기 PoC) | **DECIDED** | §7 |
| PD-7 | 「지금 동기화」 1회 실행 = human checkpoint; run-scoped 승인(org · channel · store account · period · workflow/version · single-use); scheduled/perpetual/write/다른 store·기간으로 확장 안 함; CLAUDE.md fence 유지 | **DECIDED** | §12 · §15 |
| Q-1 | scheduled unattended browser execution의 marketplace policy 적합성 | **OPEN** — 첫 PoC 밖 | §12 |
| PD-8 | **parse/normalize 위치 = option (a).** Runner는 raw bytes를 기존 ingest endpoint로 전송, backend가 메모리에서 parse/normalize/dedup/ingest(canonical parser single-source). Cloud raw 영속 저장 0, raw bytes transit은 허용. Runner-side parser·normalized-row endpoint는 만들지 않는다(privacy/offline/bandwidth 요구가 실제 확인될 때만 재검토) | **DECIDED** | §7 |

---

## 부록 A. KEEP / WRAP / REPLACE / REMOVE 후보 (proposal — 코드 변경 0)

분류는 baseline의 실제 구현을 우선했다. 브리프의 초기 후보와 다른 곳은 이유를 적었다.

| 분류 | 컴포넌트 | 근거 |
|---|---|---|
| **KEEP** | official API connectors (`Cafe24ApiConnector` · `NaverApiConnector` · `CoupangApiConnector`) | 리뷰 export와 무관, 변경 이유 없음 |
| KEEP | parser · normalization (`UploadFormat` · `FileParser` · `ReviewRowMapper` · `HeaderAliases`) | 두 경로가 같은 바이트를 낸다 |
| KEEP | dedup / idempotency (`IngestionService` · `ReviewDedupKey` · `ContentHash` · `uq_reviews_*` · launch ticket 단일 사용) | Aside 경로의 at-least-once가 이것 위에 선다 |
| KEEP | plan/segment/launch/attempt (V27/V28) · `ReviewImportLaunchService` · `ReviewImportRunService` · `ReviewImportIdentityFence` · `ScopeEvidence` | run 상태의 소유자 = Reviewnary 원칙 그대로 |
| KEEP | Review Attention · RAG / Seller Knowledge · Decision state · Repeated Issue · Product Intelligence · `IngestFollowUp` | 취득 방식을 모른다(baseline §15) |
| KEEP | `sync_jobs` · `CollectionRunService` · `ChannelCoverageService` · `ExecutableIdentityResolver` · `account_session_slot`/readiness 표 | provider 표기(PD-3)만 결정 필요 |
| KEEP | 수동 fallback(`/api/uploads` · 세그먼트 수동 업로드) | 마지막 출구 |
| **WRAP** | Local Agent import carrier 전체(`ImportSegmentEngine` + `ImportSegmentSession` + `ImportProbeDriver` 구현 + `NaverLiveProbeDriver`/`NaverLiveImportDriver`) | `ExecutionProvider.LOCAL_HELPER`로 감싼다. 내부 변경 0, 교체 가능성의 대조군 |
| WRAP | 브리지(`bridge-server` · pairing · origin policy · on-demand carrier host) | Aside 경로가 판매자 PC를 거치지 않으면(PD-1) 리뷰 import에는 불필요하나, issuance/locate/renewal/acquire/reply 6개 carrier가 여전히 이 위에 있어 **제거 불가** |
| WRAP | downloader/uploader(`quarantine.ts` · `ingest-handoff.ts` · `upload.ts#uploadSegmentReviewBytes`) | Runner가 같은 endpoint를 부른다; 바이트 판별은 백엔드가 이미 소유 |
| WRAP | scheduler | 브리프는 WRAP 후보로 봤으나 **NAVER 리뷰에 대한 스케줄러는 존재하지 않는다**(baseline §8). 감쌀 대상이 없고, unattended는 PoC 밖(Q-1). 백엔드 `SyncScheduler`는 API 채널용으로 KEEP |
| **REPLACE** | direct Chrome/session ownership(`profile.ts#launchNaverContext` · 계정 slot profile 디렉터리) | Aside가 세션을 소유하는 것이 track의 목적 |
| REPLACE | seller-center UI navigation·export 관찰 규칙(in-page tagger · 동의 dialog 문맥 · 날짜 locate · iframe 해석 · download listener) | Aside가 실행 주체가 되면 Reviewnary 코드에서 나간다(LOCAL_HELPER wrap 안에는 남는다) |
| REPLACE(해당 없음) | cookie/session recovery · browser login automation | 브리프는 REPLACE 후보로 들었으나 **NAVER 경로에 로그인 자동화·cookie 복구 코드가 없다**(baseline §7). 판매자가 직접 로그인. Aside가 그 역할을 맡는 것은 “교체”가 아니라 “신규 위임”이며 PD-2의 수용 기준을 따른다 |
| **REMOVE 후보** | legacy 클릭 계측 경로(`review-export.ts#runExport` · `review-usage-confirm.ts` · `export-click-diagnose.ts` · `account-store-continue.ts`·`instruments/calibration/{discover-export,capture-export-same-session}.ts`) | product path에서 이미 미참조. 다만 라이브 진단용 계측이므로 삭제는 **별도 결정**; 이 track이 지우지 않는다 |
| REMOVE 후보 | `--connections` orchestrator boot의 NAVER `BROWSER/AVAILABLE` 선언(`channel-registry.ts`) 및 Progressive Reconnect의 NAVER 적용 가정 | 실제 browser port는 ESM 전제, 리뷰 product path 아님. 정리 여부는 ESM track 소유자 결정 |
| REMOVE 아님 | Local Helper 자체 | Coupang READ · issuance · locate · renewal · reply carrier의 유일한 host. Aside PoC가 성공해도 NAVER import carrier 하나만 provider로 옮겨진다 |
