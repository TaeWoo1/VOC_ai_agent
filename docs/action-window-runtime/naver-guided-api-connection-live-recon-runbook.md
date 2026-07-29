# Live recon runbook — NAVER Guided API Connection v1 (slice G3-C)

**Offline instrument, prepared 2026-07-28. NOT yet run.** This is the read-only + experiment protocol for
proving the onboarding hypotheses of **Draft PR #370** (`feat/naver-guided-api-connection`, head `31dcb1c`)
against the **real NAVER Commerce API Center**. It is the G3-C gate the slice contract holds open
(`docs/slices/naver-guided-connection.md` §0 RULED 2026-07-21, §14, §19, §20-3): live NAVER recon requires a
**separate product-owner approval + a single-use in-turn G6 + §14 policy clarification** before any live step.

**SellerOps performs no marketplace click.** The seated operator logs in, opens the API Center, reads every
screen, enters credentials into the SellerOps secure field, and performs every Secret replace / app delete on
NAVER's own screens. The agent only records what the operator reports. All destructive steps stop for a fresh
re-affirmation first.

**The default user path this run must prove is 신규 애플리케이션 발급 (`처음 발급해요`).** The existing-app
discovery / reuse / recovery paths are secondary and are what the recovery + destructive experiments below
confirm or refute.

---

## Sanitization — non-negotiable, applies to every line recorded here

Record **screen names and behaviours only**. Never write, paste, screenshot, or log:
application ID · Client Secret · access/refresh tokens · account · store identifier · call/allowed IP ·
any personal or seller data. A judgment row records *whether* a value re-displays, **never the value**. If a
comparison is needed (old Secret vs new Secret), compare **safely without capturing either** (e.g. connection
test pass/fail as the proxy), never by writing the values down.

---

## Preconditions (live session only — do not stand up before approval)

| | |
|---|---|
| Approval | fresh, single-use, in-turn G6 naming channel / account / date / operator; §14 policy clarification on record. A plan is never authorization. |
| Flag | `sellerops.connector.naver.enabled` = ON **only for the disposable live session**. Never in production; revert after. |
| Backend | disposable, name-guarded (e.g. `sellerops_naver_gapi_live_*`), never the persistent `sellerops`. No new Flyway migration. |
| Seed | one org/user + one NAVER channel; the connect flow creates the PENDING API-mode seller account itself (`POST /api/seller-accounts/api-channel`). |
| Credentials | the operator's own real Client ID/Secret, entered by the operator into the SellerOps secure field only. The agent never types or copies them. |
| Other-program check | before ANY Secret replace or app delete: operator confirms the app is used by no other system. If unclear → STOP. |

---

## Phase 0 — read-only baseline (operator observes, agent records; no SellerOps action)

Operator, in the real NAVER Commerce API Center, report **screen/menu names and behaviour only**:

1. Actual menu path and screen names of the API Center.
2. The registered-application list and the path into an application's detail screen.
3. Does the application **ID** re-display and is it copyable? (`ID_REDISPLAY`)
4. Does the **Secret** re-display and is it copyable? (`SECRET_REDISPLAY`)
5. If the Secret is masked: is there a re-check / replace / reissue affordance? (`SECRET_REISSUE_AVAILABLE`)
6. Current API group, call IP, status, and whether each is editable.
7. Record screen names + behaviour **only** — no ID / Secret / account / store value.

### Phase 0 — EXECUTED (2026-07-29, correct-IP env, seated operator; no NAVER change, no values recorded)

**Tooling used (dev-only):** `collector/tools/naver-api-observe-recon.ts` — a dev-only Playwright **read-only**
API-center observer. **One supervisor process** owns the persistent context from `launchNaverContext(profileDir,
"chrome")` (headed real Chrome, no extension / no `--load-extension` / no stealth, default args + real sandbox)
to `context.close()`. It creates **one fixed Page**, pins its identity with `window.name` (`addInitScript`, so it
survives the cross-origin login redirects), foregrounds it, and observes **only that page** — a per-observe
validity gate (context alive, page open + in context, `window.name` match, host = API center) **fails closed**,
never reading a fallback URL or another tab. Signals: an **observe sentinel** (read) and a **close sentinel**
(graceful `context.close()`); `SIGINT/SIGTERM` also close the context. **No credential / login automation** (the
human logs in on the fixed tab; the tool never types credentials, never handles 2FA/CAPTCHA, never touches the
login screen). Labels are read with `locator(sel).allInnerTexts()` per selector (isolated: one selector's failure
is recorded and never zeroes the others). The **screenshot is in-memory only** (byte size reported, image never
written). **No raw application ID / Secret / store name / call IP / token** is read, printed, or saved (only UI
label text, element counts, `recencyBucket`-style structure). Refuses to run without
`--i-understand-this-opens-live-naver` (fail-closed, no browser launched).

**Observation-capability findings (sanitized):**
- **Claude-in-Chrome extension hard-blocks the API-center host** (`apicenter.commerce.naver.com`): both DOM read
  and screenshot return `"This site is blocked"`. So the coding-agent's Chrome tools cannot observe NAVER — the
  human-observes / agent-records safety model is enforced at the extension layer. (Chrome control itself was
  proven separately on a harmless page.)
- **Playwright headed persistent context CAN observe** the API center (read + screenshot).
- The API center is an **Angular SPA**, content in the **top document — no iframe** (`frameCount = 1`).
- **LNB selectors** that work: section labels `p.title-menu`, items `a.item-menu`, bottom `.btn-area button`.
- **Stable fixed-Page ownership proven** — `window.name` held across **3** observations, DevTools `a.item-menu`
  count matched Playwright's (16), survived the restored tab being closed (`pageCount` 2→1), screenshot bytes
  varied (live). (An earlier `page.evaluate` label extractor was a bug returning `[]`; the locator extractor fixed it.)

**Baseline findings (sanitized — values never recorded):**
- **App status = 활성 (active)** (operator-confirmed; a `일시중단` button implies a running app).
- **Application ID (Client ID) re-checkable** — a `복사` (copy) control is present.
- **Secret re-checkable + reissue affordance present** — `보기` (view) and `재발급` (reissue) buttons on the app
  detail. **Reissue was NOT pressed** (that is Phase 2, still gated).
- **Registered call IP matches the current environment** (operator-confirmed; raw IP not recorded). This run was
  on the correct-IP environment, resolving the earlier IP-mismatch defer.
- Detail field labels present: 애플리케이션 이름 / 스토어명 / 상태 / 최근 수정일·회원 / 인증 기한 / 애플리케이션 ID /
  애플리케이션 시크릿 / 설명 / API호출 IP / API그룹명·리소스 유형. Action buttons: 일시중단 · 사용현황 · 수정 ·
  보기 · 복사 · 재발급 · 취소 · 저장 · 추가.

## Phase 1 — baseline connection (SellerOps live, non-destructive)

1. Operator enters the current app's ID/Secret into the SellerOps secure field.
2. Connection test — pass/fail. (`SELLEROPS_TEST_CURRENT`)
3. First order sync incl. the 0-row case (0 rows = success). (`FIRST_SYNC_CURRENT`)
4. Connection status + last-success time update on screen?
5. Operator confirms the app is used by no other program.
6. **If in use → stop the Secret-replace and app-delete experiments here.** Record why.

## Phase 2 — Secret recovery experiment (stop before pressing replace/reissue)

1. If a Secret re-check affordance exists: re-check, then compare to the prior value **safely** (no capture).
2. If a replace/reissue affordance exists: record the **real screen name + warning text**.
3. Leave the SellerOps current-Secret connection test PASS as the baseline before replacing.
4. **STOP here and request `Seated and ready — destructive NAVER API recon`.** After replace, verify each:
   - old-Secret connection test
   - new-Secret connection test
   - application ID unchanged?
   - API group / call IP unchanged?
   - the SellerOps key-rotation flow
5. Old and new Secret never land in chat / log / doc / screenshot.
6. If no replace affordance exists → record `NOT_AVAILABLE` and move to Phase 3.

## Phase 3 — delete + reissue (last-resort destructive; stop before pressing delete)

1. Stop before deleting; take a fresh confirmation the app is used by no other system.
2. Record the current app config as a **secret-free** recovery checklist.
3. Record NAVER's real delete button name, confirm-dialog text, impact warning.
4. Operator deletes on NAVER's own screen. After deletion, verify:
   - app disappears from the list immediately?
   - existing ID/Secret fail to mint a new token immediately?
   - a pre-delete access token is invalidated immediately?
   - any re-registration limit / wait / error?
5. Immediately attempt a new application issuance.
6. Same store re-issuable? New application ID minted? API group / call IP need re-setup?
7. Register the new ID/Secret in SellerOps → connection test + first order sync (incl. 0-row) must pass.
8. If re-registration is blocked or gated by a wait → **do not work around it**; end `INCONCLUSIVE`, record the
   real error text only.

---

## Judgment table (fill each: `CONFIRMED` / `REFUTED` / `INCONCLUSIVE` / `NOT_AVAILABLE`)

| # | Hypothesis | Verdict | Evidence (sanitized) |
|---|---|---|---|
| 1 | Existing application ID re-checkable / copyable | `CONFIRMED` | `복사` control on the app detail (Phase 0, read-only) |
| 2 | Existing Secret re-checkable / copyable | `CONFIRMED` | `보기` control on the app detail (Phase 0, read-only) |
| 3 | Secret alone replaceable / reissuable | `CONFIRMED (affordance)` | `재발급` button present on the app detail; **not pressed** — pressing is Phase 2 (gated) |
| 4 | On Secret replace, application ID unchanged | | |
| 5 | On Secret replace, old Secret invalidated immediately | | |
| 6 | On Secret replace, old access token invalidated immediately | | |
| 7 | Application deletable | `REFUTED` | **내 스토어 애플리케이션 has no delete function** — official CS: unused apps are **비활성화(deactivate)** only. Observed `삭제` in the detail button area is an **IP/API-group row delete**, not an app delete. |
| 8 | On delete, existing ID/Secret invalidated immediately | `NOT_APPLICABLE` | predicated on a delete that does not exist |
| 9 | On delete, existing access token invalidated immediately | `NOT_APPLICABLE` | predicated on a delete that does not exist |
| 10 | After delete, same store re-registerable immediately | `NOT_APPLICABLE` | predicated on a delete that does not exist |
| 11 | On re-registration, API group / call IP reset | `NOT_APPLICABLE` | predicated on a delete that does not exist |
| 12 | New app → SellerOps connection test passes | `NOT_APPLICABLE` | same-store new issuance is blocked by the 1-app-per-store limit (existing app non-deletable) |
| 13 | New app → first order sync (incl. 0-row) passes | `NOT_APPLICABLE` | as above; see the existing-app baseline (B2) instead |

**Phase 1 baseline (existing app, non-destructive) — 2026-07-29:**

| # | Hypothesis | Verdict | Evidence (sanitized) |
|---|---|---|---|
| B1 | Existing app → SellerOps connection test passes | `CONFIRMED` | `test-connection` → SUCCESS on the real Commerce API, correct-IP env |
| B2 | Existing app → first order sync passes | `CONFIRMED` | `ORDER_SUMMARY` sync → SUCCESS, 15 orders, PAYED→PAID, daily↔per-order consistent |
| B3 | 0-row sync = success, distinct from failure | `CONFIRMED` | same-scope re-sync after cursor advance → SUCCESS counts 0 |
| B4 | permission-insufficient / call-IP-mismatch reason codes | `NOT_OBSERVED` | happy path succeeded; failure branches never triggered (IP matched, auth OK) |

Rows 4–6 (Secret-replace effects) remain **unrun** — destructive, Phase 2, gated. Rows 7–13
(delete/reissue effects) are **closed as REFUTED / NOT_APPLICABLE** — NAVER provides no app-delete (see
"Phase 3 — CLOSED" below), so the entire delete-then-reissue branch cannot be executed.

## Phase 3 — CLOSED: app-delete capability absent (delete-then-reissue branch, 2026-07-29, no NAVER change)

An operator-approved destructive dry-run (`delete existing app → re-register on the same store`) was
**aborted before any action** because the premise is invalid. Sanitized findings:

- **내 스토어 애플리케이션 provides no delete on the current screen.** The seated operator could not
  locate an app-delete control; NAVER Commerce API CS confirms deletion is **not offered** — unused apps
  must be **비활성화(deactivate)** instead.
- **The observed `삭제` label was not an app delete.** The read-only observer saw `삭제` in the detail
  button area (`.btn-area button`), but it is a **row-level delete for a 호출 IP / API 그룹 entry**, not
  an application delete. (App-level actions on the detail screen: `일시중단 · 사용현황 · 수정`.)
- **Same-store new-app issuance is blocked** by the 1-app-per-store limit while the existing (non-deletable)
  app is present, so the from-scratch **issuance-form walk cannot run on this store**. It needs an
  **app-free store**, or the **solution-provider path** (out of pilot scope).
- **The `삭제 후 재발급` (delete-then-reissue) recovery assumption is DISCARDED.** Recovery for a lost
  Secret is **재발급 (Secret reissue) on the existing app** (the `재발급` affordance seen in Phase 0), which
  rotates the **store-wide** Secret for every consumer — not a delete-and-recreate.
- **The existing 전선몰딩 app was fully preserved** — no delete, no 비활성화, no 수정, no 재발급. The
  read-only observer closed gracefully (context.close, cookies flushed); nothing on NAVER was mutated.

Pre-delete recovery baseline captured (sanitized, values never recorded): app 상태 = 활성; API groups
selected = 문의 / 주문 판매자 / 상품·N배송 / 정산 (all "모든 리소스 유형"); 호출 IP entries = 1 (count only);
Client ID/Secret UI = 복사 / 보기 / 재발급.

---

## Product reflection (apply only from CONFIRMED real screen names — fill after the run)

- Default new-user CTA / first path = `처음 발급해요`; `이미 애플리케이션이 있어요` / `있는지 모르겠어요` stay secondary.
- Put only **confirmed** screen names / warnings / recovery behaviour into copy + state machine
  (`frontend/src/lib/guidedConnection/copy.ts`, `state.ts`).
- If Secret re-check is impossible, guide existing-app users in order: key-on-hand? → **Secret 재발급
  (reissue) on the existing app** (store-wide rotation — warn it affects every consumer of that app).
  **There is no delete/reissue path — NAVER offers no app delete (see Phase 3 — CLOSED).**
- ~~Delete is not recommended by default; shown only after the no-other-program confirmation.~~ **App delete
  does not exist. The `delete_reissue_confirm` phase and its copy (built on that REFUTED assumption) HAVE been
  retired in the guided FE (`frontend/src/lib/guidedConnection/state.ts`, `copy.ts`) on branch
  `feat/naver-connection-strategy-v1`; recovery now guides Secret reissue on the existing app.**
- If real reason codes are obtained, update the 인증 실패 / 권한 부족 / 호출 IP 불일치 mapping
  (`afterTestFailure`, backend reason codes) — no branching on guesses, no cause asserted from an unclassified error.

## Safety fences (verbatim)

- SellerOps does not click login / 2FA / app-create / Secret-replace / app-delete. The operator does all of it on NAVER.
- Never write real ID / Secret / token / store / account / call IP to log / doc / screenshot.
- Stop if other-system use of the app is unclear before any destructive step.
- On reissue failure: no repeated deletes, no account switching, no unofficial workaround.
- Do not extend to solution-provider OAuth or an automatic issuance flow.

## Recon environment setup — findings (2026-07-28, offline, no NAVER touched)

Established how a seated operator attaches "Claude in Chrome" to a headed real Chrome for recon,
without changing any product launcher. Sanitized outcomes:

- **Dev-only recon launcher** added: `collector/tools/naver-api-recon-chrome.ts` (NOT a product path).
  Reuses the product path helper (`accountScopedProfileDirFor`) but the product launcher
  (`src/profile.ts`), account-scoped runtime, Pilot Runtime, and the normal NAVER profile are
  **unchanged**. Recon-only deviation: `ignoreDefaultArgs: ["--disable-extensions"]`, `channel:"chrome"`,
  `headless:false`. Never `--load-extension`, never a local side-load, never a detection-bypass flag.
- **Recon-only opaque profile** (leaf `naver-agent-<24hex>` from an opaque recon slot) is distinct from
  the existing verified profiles — those were never touched or read.
- **Playwright default `--disable-extensions` is real** (verified in `playwright-core`), alongside
  `--enable-automation` + `--remote-debugging-pipe`. So the product launcher can never carry a Web-Store
  extension, and modifying it to do so is out (matches the no-side-load prohibition).
- **A Web-Store extension DOES load under Playwright automation** once `--disable-extensions` is dropped:
  the extension service worker was active (confirmed via Playwright's worker list AND a CDP
  `Target.getTargets` probe).
- **BLOCKER — Google refuses account login in the automation-flagged window.** Signing into the extension
  (Google auth) inside the Playwright `--enable-automation` Chrome hits Google's anti-automation wall
  ("이 브라우저 또는 앱이 안전하지 않을 수 있습니다 / 다른 브라우저를 사용해 보세요"). Not defeatable without a
  detection-bypass flag, which is prohibited. Google login DOES work in **plain** Chrome (no automation).
- **`/chrome` is not usable from the coding-agent session:** no browser-control tool is exposed to the
  agent, so even a connected `/chrome` gives the agent no page-reading ability. This is fine — the safety
  model is human-observes / agent-records, agent never reads raw page content.
- **Resolved approach:** Phase 0 read-only recon runs in **plain Chrome + Claude-in-Chrome** (operator's
  side); the SellerOps **product** verification stays in a **separate Playwright run** (its own isolated
  profile). Isolation only matters for the product run, not for the operator eyeballing NAVER screens.
- **Phase 0 deferred:** the current network is on a **different call-IP** than the app's allowed IP, which
  would make a connection test / sync fail on IP mismatch and give a misleading verdict. Phase 0 (and all
  live steps) resume from the **correct-IP environment**.

## Phase 1 — EXECUTED (2026-07-29, non-destructive, correct-IP env, seated operator)

Baseline connection + first real sync on the **existing** app (no Secret replace, no delete, no reissue). Run
against the real NAVER Commerce API through the **product backend boundaries** the guided FE drives
(`POST …/test-connection`, `POST …/sync {ORDER_SUMMARY}`) on a **disposable throwaway Postgres** with the
connector flag enabled by an **environment variable only** (torn down afterward; the product
`sellerops.connector.naver.enabled` was never changed). Operator entered the existing app's Client ID/Secret
into the vault (`API_KEY`); values never surfaced. Sanitized outcomes:

- **Connection test PASS** (`status=SUCCESS`, no reason code) — the real client-credentials token mint was
  accepted → credentials valid + call IP accepted + auth permission sufficient. (Runbook Phase 1 step 2.)
- **First order sync SUCCESS — 15 orders** (`ORDER_SUMMARY`, 15 success / 0 skip / 0 fail). Real status
  vocabulary `PAYED → PAID`; daily ↔ per-order count + amount consistent. (Phase 1 step 3.)
- **0-row case = success, distinct from failure** — a follow-up same-scope sync returned `totalRows=0`
  (`SUCCESS`, counts 0) because the last-changed cursor advanced; "수집됨, 신규 주문 없음", not an error.
  (Confirms slice §12 / §17.9.)
- **Idempotency** — re-presenting the same window (disposable cursor reset only; not a NAVER change) skipped
  all 15 (0 new rows, 0 spurious events).

> **Caveat (honest scope):** this exercised the **backend** connection-test + ORDER_SUMMARY boundaries and the
> real NAVER API with the existing app's credentials — **not** a live end-to-end walk of the guided FE wizard
> (§17.10 does not require live NAVER for implementation validation). Distinct failure reason codes
> (permission-insufficient / call-IP-mismatch) were **not observed** because the happy path succeeded.

## Boundary — what stays true until the seated session runs

**Phase 0 (read-only recon) and Phase 1 (baseline connection test + first order sync, non-destructive) HAVE
run — 2026-07-29** (results above). **Phase 3 (delete + reissue) is CLOSED as REFUTED — NAVER offers no
app-delete, so the branch cannot run** (see "Phase 3 — CLOSED"). **Phase 2 (Secret replace/reissue effects)
has NOT run** — still destructive, still gated.
`sellerops.connector.naver.enabled` stays **OFF in the product** (Phase 1 used an env-only override on a
disposable backend, torn down), no **Secret replace / app delete / reissue** (Phase 2/3); Pilot Runtime PR #369
untouched; no new Flyway migration on this branch. The agent requests `Seated and ready — destructive NAVER API
recon` before recording any Phase-2/Phase-3 destructive result. Within one approved session, the same
channel/account/scope replace / delete / reissue proceed without re-approval.
