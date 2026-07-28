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
| 1 | Existing application ID re-checkable / copyable | | |
| 2 | Existing Secret re-checkable / copyable | | |
| 3 | Secret alone replaceable / reissuable | | |
| 4 | On Secret replace, application ID unchanged | | |
| 5 | On Secret replace, old Secret invalidated immediately | | |
| 6 | On Secret replace, old access token invalidated immediately | | |
| 7 | Application deletable | | |
| 8 | On delete, existing ID/Secret invalidated immediately | | |
| 9 | On delete, existing access token invalidated immediately | | |
| 10 | After delete, same store re-registerable immediately | | |
| 11 | On re-registration, API group / call IP reset | | |
| 12 | New app → SellerOps connection test passes | | |
| 13 | New app → first order sync (incl. 0-row) passes | | |

---

## Product reflection (apply only from CONFIRMED real screen names — fill after the run)

- Default new-user CTA / first path = `처음 발급해요`; `이미 애플리케이션이 있어요` / `있는지 모르겠어요` stay secondary.
- Put only **confirmed** screen names / warnings / recovery behaviour into copy + state machine
  (`frontend/src/lib/guidedConnection/copy.ts`, `state.ts`).
- If Secret re-check is impossible, guide existing-app users in order: key-on-hand? → replaceable? → last-resort delete/reissue.
- Delete is not recommended by default; shown only after the no-other-program confirmation.
- If real reason codes are obtained, update the 인증 실패 / 권한 부족 / 호출 IP 불일치 mapping
  (`afterTestFailure`, backend reason codes) — no branching on guesses, no cause asserted from an unclassified error.

## Safety fences (verbatim)

- SellerOps does not click login / 2FA / app-create / Secret-replace / app-delete. The operator does all of it on NAVER.
- Never write real ID / Secret / token / store / account / call IP to log / doc / screenshot.
- Stop if other-system use of the app is unclear before any destructive step.
- On reissue failure: no repeated deletes, no account switching, no unofficial workaround.
- Do not extend to solution-provider OAuth or an automatic issuance flow.

## Boundary — what stays true until the seated session runs

Nothing here has run. `sellerops.connector.naver.enabled` stays **OFF**, no live NAVER call, no first real
sync, no merge; Pilot Runtime PR #369 untouched; no new Flyway migration. The operator performs the read-only
baseline (Phase 0) and reports it; the agent requests `Seated and ready — destructive NAVER API recon` before
recording any Phase-2/Phase-3 destructive result. Within one approved session, the same channel/account/scope
replace / delete / reissue / connection-test / first-sync proceed without re-approval.
