# Pilot-Ready Local Agent Runtime v1

> One big PR turning the collector's live agent into something a non-technical seller can **install, keep
> running, and reuse** on a clean Windows PC — no developer, no terminal, no dev CLI flags. Follow-up to the
> Guided Acquisition Reliability work (#368): that made a single guided run recoverable; this makes the
> *runtime around it* installable and durable.

Status: **offline-complete, on-device verification pending.** Everything below is built and offline-green; the
Windows-device install/reuse check is the final human step (it opens a live browser and needs a seated
seller), requested separately.

## Preservation record

- **Branch:** `feat/pilot-ready-local-agent-runtime` (off `main` @ `fbbc90a`).
- **Feat commit:** `5dd1cef` (this doc's branch head is the immediate follow-up docs commit). PR: **Draft** —
  do NOT merge until the on-device Windows proof lands.
- **Completed offline gate (2026-07-28):** collector `tsc --noEmit` + crossstack tsconfig clean, **5,516**
  vitest tests; frontend typecheck clean, **1,086** tests. Contracts untouched (no contract change). No Flyway
  migration. Two independent reviews' findings fixed in-branch.
- **Remaining Windows on-device proof scenarios (the human step — NOT yet run; no new live run performed):**
  1. First install → pair (승인 코드) → NAVER 로그인 → 리뷰 수집.
  2. Agent 완전 종료·재실행 → 재로그인 없이 수집.
  3. PC 재부팅 → 자동 시작·자동 재연결 → 세션 재사용.
  4. 세션 만료 → 로그인 안내 → 다시 확인 → 같은 작업 재개.
  5. NAVER 창 닫기 → 같은 run/ticket으로 창 다시 열기.
  6. 같은 기간·파일 재처리 → 중복 적재 없음.
  7. 다른 계정 slot → 프로필·쿠키 미혼입.
  8. 종료 시 다른 SellerOps/Chrome 프로세스 미영향.
  9. 설치→업데이트(로그인/설정 보존)→제거(프로필 보존) runbook 왕복.
  10. `--export-diagnostics` 진단 파일에 민감정보 없음 확인.

## What it adds (the runtime supervisor layer)

A thin `collector/src/runtime/` layer composed into `cli/local-agent.ts`, engaged only in **pilot mode**
(`NODE_ENV=production` or `SELLEROPS_PILOT_RUNTIME=1`) so dev/test and the existing CLIs are byte-for-byte
unchanged:

- **`runtime-paths.ts`** — a per-user **data root** (`%LOCALAPPDATA%\SellerOps\Agent`) holding profiles,
  pairing store, settings, logs, diagnostics — separate from the **install root** (`…\SellerOps\app`, code)
  so an update preserves the login/pairing by construction.
- **`single-instance-lock.ts`** — a PID/pgid lock. A live holder → refuse (duplicate prevention); a dead
  holder → take over + reap its orphans (crash recovery). Staleness is by **liveness, not time**.
- **`owned-process-registry.ts`** — terminates **only** processes the agent started, by **exact
  PID/process-group**, never by name/pattern (the mistake that once killed a protected process). Records
  orphans so a crash-recovering instance can reap them.
- **`self-check.ts`** — extends the guided pre-flight with **version + capability** axes
  (backend · bridge · origin · version · Chrome · profile-writable · approval-channel). One sanitized issue
  enum + one recovery key each — never a URL/host/port/path.
- **`reconnect-policy.ts`** — bounded-backoff bridge-bind retry (agent-side reconnect after a
  crash-recovery rebind). FE-side auto-pair/reconnect already exists and is unchanged.
- **`production-import-gate.ts`** — production import admitted by a one-time **install consent**
  (`config/import-consent.json`), not a dev flag. Fail-closed without consent; still refuses on a
  CI/scheduled/headless host (a live browser needs a seated human).
- **`diagnostics-export.ts`** — `--export-diagnostics` writes a sanitized bundle (self-check + scrubbed,
  metadata-only log tail + agent facts). Defensive redaction blanks any URL/path/token shape.
- **`packaging-plan.ts`** — the install-root / startup-shortcut / update-safety decisions the PowerShell
  scripts mirror, unit-tested off-Windows.
- **`bridge/windows-approval-presenter.ts`** — the Windows native-dialog approval presenter (PowerShell
  MessageBox, stdin-only, injection-escaped, fail-closed). **This is what lets Windows pilot pairing
  complete** — before it, production pairing off macOS failed closed (`503 approval_unavailable`).

Windows packaging under `collector/packaging/windows/`: `install.ps1` (per-user, no admin, Startup-folder
auto-start + one-time consent), `start-agent.ps1` + `run-agent.vbs` (hidden launcher, production env),
`update.ps1` (preserves the data root, aborts if the safety invariant fails), `uninstall.ps1` (keeps profiles
by default), and a Korean `README.md` runbook.

## Decisions (recorded, not invented)

Grounded in `docs/sellerops_local_agent_runtime_adr.md`:

1. **Installed real Chrome, not bundled Chromium** (ADR §2.1) — the pilot drives the installed Chrome channel.
2. **Per-user login auto-start, not a Windows service** — a headed Chrome the seller logs into must run in
   their interactive session; a session-0 service cannot host it. So auto-start is a Startup-folder shortcut.
3. **Session reuse is persistent-profile cookies, not a credential vault** — no auto-login, and this PR does
   not claim one (ADR §3.2/§4). Cookies persist in the account-scoped profile across restarts.
4. **Production import via recorded consent, not a dev flag** — relaxes the ceremony, preserves every safety
   semantic (human login/2FA/CAPTCHA; the runtime highlights and observes, never auto-clicks export).

## Verification matrix (the 8 acceptance scenarios)

| # | Scenario | How it's met | Offline coverage |
|---|---|---|---|
| 1 | First install → pair → NAVER login → collect | install.ps1 + consent + Windows approval presenter + guided import (#368) | presenter unit tests; consent gate tests; **live login = on-device** |
| 2 | Agent restart → collect without re-login | account-scoped profile under the durable data root survives a release/re-acquire | `pilot-runtime.e2e` #2 |
| 3 | Reboot → auto-reconnect + session reuse | Startup-shortcut auto-start + durable pairing store + persistent profile; crash-recovery takeover | `pilot-runtime.e2e` #3; supervisor tests |
| 4 | Session expiry → login guide → 다시 확인 → resume | recoverable park + PREPARE re-run on the same run/ticket (#368) | import-session reliability tests (existing) |
| 5 | NAVER window close → reopen same run/ticket | surface-close → `markClosed` → re-check reopens (#368) | import-session tests (existing) |
| 6 | Reprocess same period/file → no duplicates | backend dedup: partial-unique indexes + in-batch/against-store skip; collector relies on it | backend ingest tests (existing) |
| 7 | Account slots don't mix profiles/cookies | `accountScopedProfileDirFor` one-way-hashed leaf per (channel, slot) | `pilot-runtime.e2e` #7; profile tests |
| 8 | Shutdown never touches other processes | owned-process registry: exact-PID kill only, never a name/pattern | `pilot-runtime.e2e` #8; registry tests; wiring guard |

## Honest limitations

- **On-device Windows check is pending** (the human step). The PowerShell scripts are authored to match the
  tested `packaging-plan`, but PowerShell itself was not run here (macOS host).
- **The Windows approval dialog's on-screen behaviour is not live-verified** — like the macOS adapter, the
  logic is hermetically tested with an injected process seam; treat the presentation as unconfirmed until an
  operator runs it (collector §4.6).
- **Browser PID ownership is via CDP `SystemInfo.getProcessInfo`** (best-effort): Playwright exposes no
  persistent-context browser pid publicly, so the boot and account contexts' Chrome pids are captured over
  CDP and recorded in the owned-process registry — so crash-orphan reaping and the shutdown force-backstop are
  real, and are **liveness-gated** (a recorded pid no longer alive is never signalled, bounding PID reuse;
  start-time verification is a further hardening). If the CDP method is unavailable, teardown falls back to
  `context.close()` (exact-handle) + Playwright's pipe-close self-termination. The no-name-kill discipline is
  enforced regardless.
- **Unattended-launch defence rests on the shipped interactive Startup item + env markers**, not on OS
  session detection — a third party wiring their own Scheduled Task/Session-0 launcher without the markers is
  a documented follow-up (pairing still fails closed in Session 0).
- **Dedup for channels without a stable review id** (ESM+/GMARKET) is date-granular; NAVER is unaffected (it
  dedups on `리뷰글번호`). Inherited, not introduced here.
- **Session/surface markers stay placeholder-derived** (inherited from #368) — a NAVER login page is a
  generic recoverable "not ready", not specifically `LOGIN_REQUIRED`.
