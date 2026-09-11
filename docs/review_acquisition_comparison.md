# Review Acquisition — Legacy vs Aside — 사실 중심 비교

> **문서 성격.** `docs/review_acquisition_baseline_v1.md`(CURRENT FACT)와 `docs/review_acquisition_aside_v2.md`
> (TARGET DESIGN)를 축별로 나란히 놓는다. **좋다/나쁘다를 결론 내리지 않는다.** Legacy 열은 코드에서 확인된
> 사실, Aside 열은 목표 설계이거나 가정이며 표기로 구분한다: `[FACT]` · `[TARGET]` · `[HYP]`(미확인 가정).
> 범위는 NAVER SmartStore 리뷰 export 경로다(Cafe24 API·Coupang READ·수동 업로드는 어느 쪽에서도 변하지 않는다).
> **v1.1 (2026-09-12)**: product decisions PD-1~PD-8(`review_acquisition_aside_v2.md` §17) 반영. `[DECIDED]`는 결정된 목표.

| 축 | Legacy (Local Helper 경로) | Aside 경로 |
|---|---|---|
| **responsibility** | `[FACT]` 판매자 PC의 collector 프로세스가 브라우저·세션·surface 관찰·download 감지·quarantine·업로드를 전부 든다. 백엔드는 plan/ticket/ingest/provenance. 판매자가 모든 마켓플레이스 클릭을 수행 | `[DECIDED PD-1]` Reviewnary Cloud=Sync Job/state, **Seller PC의 Runner**=Aside 호출·임시 export·기존 parse/normalize/upload, Aside=인증된 실행. Cloud 코드에서 브라우저 책임 없음 |
| **credentials** | `[FACT]` NAVER 로그인은 판매자 PC Chrome profile 파일에만 존재. 서버·wire·로그 0. 도우미→백엔드는 `rvh_` device token. API 키류는 백엔드 vault(NAVER 리뷰와 무관) | `[DECIDED PD-1]` credential/session은 Cloud로 이동하지 않는다 — Aside 소유, Reviewnary·Runner 무보유. `[HYP]` Aside가 세션을 어디에 어떤 형태로 두는지 미확인 |
| **sessions** | `[FACT]` persistent profile(계정 slot별 디렉터리)로 재시작 생존. 5-state verdict로 판정, `UNKNOWN`은 진행 금지. 로그인·2FA·계정 선택은 판매자. readiness는 `account_session_slot`에 영속 | `[DECIDED PD-2]` 정상 로그인된 세션 사용은 허용 목표; login/MFA/CAPTCHA/re-auth가 필요하면 **`AUTH_REQUIRED` fail closed**, 사람이 정상 인증. Reviewnary는 readiness 보고만 받아 같은 표에 영속. `[HYP]` 세션 보관 형태·인증 필요 신호는 PoC 확인 |
| **security** | `[FACT]` loopback 브리지 + origin allow-list + pairing token(hash) + 단일 사용 ticket + macOS native 승인; wire/영속에 selector·URL·path·credential·page content 금지 gate; 마켓플레이스 WRITE 0; 클릭 0(source guard) | `[TARGET]` 같은 금지 필드 gate를 provider 응답에 적용, run ref는 provider에 미전달, idempotency-key. `[DECIDED PD-7]` 「지금 동기화」 1회 실행 = human checkpoint, **run-scoped 승인**(org·channel·store account·period·workflow/version·single-use), scheduled/perpetual/write/다른 store·기간으로 확장 안 함, CLAUDE.md fence 유지. `[DECIDED PD-4]` ingest 전 store identity 대조, display name 단독 불충분, 증명 부족 시 fail closed. `[HYP]` Aside 측 인증·격리·감사 로그는 미확인 |
| **parse location · raw transit · persistence** | `[FACT]` 파싱은 **backend**(`UploadFormat`·`FileParser`·`ReviewRowMapper`, 메모리 스트림). raw bytes는 도우미 → `/launches/{ref}/ingest`로 Cloud를 **통과**한다. Cloud raw 영속 저장 **0**(파일 저장 코드 없음). 판매자 PC: quarantine은 delete-after-validate, 단 `downloads/`에 판매자용 사본 **보존** | `[DECIDED PD-8=a]` 파싱은 **backend, 동일 코드**(canonical parser single-source; Runner 파서 0, normalized-row endpoint 0). raw bytes는 Runner → 같은 endpoint로 Cloud를 **통과**한다(transit 허용). Cloud raw 영속 저장 **0** 유지. 판매자 PC: ACK 후 raw 삭제, 실패 시 quarantine(TTL 미정), `[DECIDED PD-6]` 판매자용 사본 **없음** |
| **UI-change maintenance** | `[FACT]` in-page 구조 규칙(export 키워드 표 · 동의 dialog 문맥 · 날짜 input locate · iframe 해석)이 Reviewnary 코드에 있음. 라이브마다 수정 이력(07-25 iframe · 08-23 listener/확장자 · 09-02 두 컨트롤·dialog 시간·zip 마커) | `[TARGET]` UI navigation 규칙은 Aside 측. Reviewnary에 남는 규칙은 파일 판별·scope evidence·dedup뿐. `[HYP]` Aside의 UI 변경 추종 속도·범위 미확인 |
| **failure recovery** | `[FACT]` blocker 10종 + reliability park 7종, 세션/scope park 자동 재프로브, 판매자 명령(다시 확인·수동 전환·취소), 재시작 시 ABANDONED(서버가 세그먼트 보존), 새 ticket으로 재시도, terminal 실패 로그 latch | `[TARGET]` provider-neutral taxonomy(기존 코드 + STORE_*/PROVIDER_*/TRANSFER_*), at-least-once 재전송 + idempotency-key, 실패 시 Local Helper 또는 수동 업로드로 fallback |
| **user friction** | `[FACT]` 도우미 설치(macOS)·pairing 승인·로그인·날짜 2회·조회·export·동의·(기간 변경)·세그먼트마다 착석. 10단계(baseline §17) | `[DECIDED PD-1/PD-7]` Seller PC에 Runner 설치 + run마다 「지금 동기화」 승인 1회 + (`AUTH_REQUIRED` 시) 사람이 정상 인증. `[DECIDED PD-6]` 판매자용 raw 사본 없음. `[HYP]` Aside 로그인 UX·빈도 미확인 |
| **cost** | `[FACT]` 판매자 PC 자원, 도우미 패키징/서명/설치 지원 비용, 라이브마다 in-page 규칙 수정 엔지니어링. 외부 과금 0 | `[HYP]` Aside 사용료·실행당 비용·세션 유지 비용 미확인. Reviewnary 측 유지보수는 파서·ingest·계약으로 축소(목표) |
| **dependency** | `[FACT]` Playwright + Chromium/Chrome, macOS launchd, `ws`, 판매자 PC 상시 실행. 외부 서비스 의존 0 | `[TARGET]` Aside 서비스 가용성·API 안정성에 의존. Runner는 얇지만 Aside 없이는 실행 불가 → Local Helper/수동 경로가 fallback |
| **policy risk** | `[FACT]` 판매자가 공식 UI에서 직접 export — 자동화 조항 노출 최소. 스케줄 없음. 저장 리뷰 원문은 기존 결정(Coupang gate와 별개로 NAVER는 export 파일 = 공식 제공물) | `[TARGET]` 공식 UI·공식 export만 사용, 내부 endpoint·우회·크롤링 금지. `[HYP]` 제3자 실행 주체(Aside)가 판매자센터를 조작하는 것의 약관 적합성, unattended 실행의 적합성(Q-1) 미확인 |
| **fallback** | `[FACT]` FE 세그먼트 수동 업로드(`OPERATOR_CONFIRMED`) · `/api/uploads` | `[TARGET]` 동일 수동 경로 유지 + Local Helper 경로 유지(PoC 동안 삭제 0). `[DECIDED PD-5]` 실패 artifact는 local quarantine 가능(TTL 미정) |
| **migration scope** | — | `[TARGET]` Reviewnary Core 변경 0. `[DECIDED PD-3]` `CollectionMethod=SELLER_CENTER_EXPORT` 유지, **`ExecutionProvider` axis 신설**(`LOCAL_HELPER·ASIDE·future`; enum/schema는 아직 미수정). 변경 후보: `ExecutionProvider` 계약, Runner(Seller PC), provider/workflow-version 저장 위치, idempotency-key 저장소, expected store identifier 컬럼(미확인 시 신규), `AUTH_REQUIRED`·`STORE_*` 실패 코드, 파서 위치는 PD-8=(a)로 **변경 0**. Local Helper 엔진·드라이버는 WRAP(변경 0), legacy 계측 클릭 모듈은 REMOVE 후보 |

## 두 경로가 공유하는 것 (변하지 않는 사실)

- ingestion spine: `UploadFormat → FileParser → ReviewRowMapper → IngestionService(dedup) → reviews → IngestFollowUp`.
- plan/segment/launch/attempt 표와 `ReviewImportIdentityFence`.
- dedup: `uq_reviews_external`(리뷰글번호) · content hash v1.
- freshness: `sync_jobs.method.observesChannel()` 기반 coverage.
- Review Attention·RAG·Decision·Repeated Issue·Product Intelligence — 취득 방식을 모른다.

## 비교가 답하지 않는 것

- 어느 쪽이 “더 낫다”. PoC 성공 기준(aside_v2 §15)과 Q-1의 답, 그리고 PoC 측정이 있어야 판단 가능.
- Aside의 내부 동작·비용·정책 — 저장소에서 확인 불가.
