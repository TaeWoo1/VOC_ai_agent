# Service Readiness v1 — contract

Status: **contract + implementation record** (2026-08-19, product-owner decision). Scope lock reference:
`docs/product-scope-v1.md` v1.11 note. Builds on `docs/auth_growth_instrumentation_v1.md` (v1.10) and changes
nothing about channels, the marketplace WRITE boundary, or the product IA (`docs/product_assembly_ia_v1.md`).
This document owns: error monitoring (Sentry), password reset, the consent structure, the analytics-consent
link, security headers / CSP, the auth-shell UX polish, and the **deployer / legal checklist that remains
before public launch**. Goal: a general-SaaS-grade sign-up / operate / measure base — **no new core feature and
no new channel**. After it merges, development stops and the new-user self-pilot starts.

## 1. Audit (what existed on `main@04811591`)

| Area | Found | Consequence |
|---|---|---|
| Error monitoring | none (no Sentry / actuator dependency; `GlobalExceptionHandler` logs the trace to stdout only; no React error boundary — a render error is a blank page) | Add Sentry on both sides, env-gated, PII-scrubbed; add a root error boundary with a seller-facing fallback |
| Password recovery | none — a forgotten password meant a new account | Add `/forgot-password` → mail → `/reset-password`; token discipline copied from the social one-time code (SHA-256 at rest, atomic consume) |
| Mail | none (`spring-boot-starter-mail` absent) | Add a `Mailer` abstraction: SMTP when configured, a dev-only outbox otherwise, OFF = link hidden |
| Analytics | `lib/analytics` (v1.10): sinks are started lazily on the first `track` — on `/product` there is no `track`, so **GTM never loaded on the landing page** and the landing `page_view` (the UTM carrier) never fired | Start sinks eagerly at init (after consent); no UTM handling in app code — GA4/PostHog read `utm_*` from `page_location` natively |
| Consent | none — no banner, no terms/privacy surface, no consent record on `users`, GTM without Consent Mode | Add consent state (필수 / 분석 / 마케팅), Consent Mode v2 signals in the GTM sink, `users.terms_accepted_at / terms_version / marketing_consent_at`, `/legal/terms` + `/legal/privacy` placeholders |
| Security headers | Spring Security defaults only (nosniff, `X-Frame-Options: DENY`, `Cache-Control: no-store`, HSTS on https, `X-XSS-Protection: 0`); no CSP, no Referrer-Policy, no Permissions-Policy on the API; the SPA (`index.html`) ships no CSP at all | Backend: CSP `default-src 'none'; frame-ancestors 'none'` + Referrer-Policy + Permissions-Policy. Frontend: **build-time** CSP `<meta>` computed from the same env that enables each vendor |
| Token leak surfaces | one-time social code in `/auth/callback?code=` (v1.10, by design, 120 s single-use); JWT only in `localStorage` + `Authorization` header; `sellerops_social_onboarding` token in `sessionStorage`; no analytics prop can hold a string | New reset token in `/reset-password?token=` (by design — a mailed link). **Both URL-borne secrets are lifted out of the address bar by `main.tsx` before Sentry or any analytics sink starts** (`lib/urlSecrets.ts`: sessionStorage + `history.replaceState`), so no vendor `page_view`, breadcrumb, referrer or history entry ever sees them; the page reads the value back once. Sentry additionally scrubs query strings, `from`/`to` navigation crumbs, auth headers, cookies, users and email-shaped text |
| Auth UX | `AuthCard` frame shared by `/login` `/signup` `/onboarding` `/auth/callback` (v1.10) | Extend the same frame to `/forgot-password`, `/reset-password`; one loading / error / success vocabulary (`AuthNotice`) |
| Release identity | none — neither side knows its git SHA | Backend: `bootBuildInfo` + `SELLEROPS_RELEASE`; frontend: `__SELLEROPS_RELEASE__` from `SELLEROPS_RELEASE` or `git rev-parse` at build |

## 2. Decisions

1. **Sentry is env-gated on both sides and OFF locally.** Backend: `SENTRY_DSN` (Spring `sentry.dsn`); frontend:
   `VITE_SENTRY_DSN`. `environment` = `SELLEROPS_ENV` / `VITE_SELLEROPS_ENV` (default `local`); `release` =
   `SELLEROPS_RELEASE` / build-time git SHA. Session replay is **not loaded** (the integration is not imported).
   `sendDefaultPii=false` on both sides. Everything below is enforced in code (`SentryScrub` / `sentryScrub.ts`):
   request query strings, `Authorization` / `Cookie` / `Set-Cookie` headers, cookies, request bodies, `user`
   (replaced by nothing — not even the id), breadcrumb URLs' query parts (`url`, and the navigation crumb's
   `from` / `to`), and any string value that looks like a bearer token, a `code=` / `token=` pair, or an
   **email address** (a DB unique-key detail carries one) are removed before send. What is captured: backend unhandled
   exceptions (`GlobalExceptionHandler.handleOther` → 500) and Sentry's own resolver for anything outside it;
   frontend uncaught errors, the root `ErrorBoundary`, and **API errors** = axios failures with status ≥ 500 or no
   response (4xx are the flow's own answers, not incidents). Performance: `tracesSampleRate` from
   `SELLEROPS_SENTRY_TRACES_SAMPLE_RATE` / `VITE_SENTRY_TRACES_SAMPLE_RATE` (default `0.1`, `0` = off).
   Frontend traces propagate only to same-origin `/api/`; backend `trace-propagation-targets` is **empty** — no
   `sentry-trace` / `baggage` header ever goes to a marketplace or provider. Backend log→Sentry forwarding is
   OFF (log lines are not audited for PII).
2. **Password reset = mailed one-time link.** `POST /api/auth/password/forgot {email}` always answers `202`
   with the same body — for an unknown email, a social-only account (`password_hash IS NULL`), a throttled
   email — the seller reads one sentence: "가입된 이메일이면 재설정 안내를 보냈어요". Only a password account
   gets a mail. Token: 32 random bytes base64url, **only its SHA-256 stored** (`password_reset_tokens`),
   TTL 30 min (`SELLEROPS_PASSWORD_RESET_TTL_SECONDS`), consumed atomically (`UPDATE … WHERE consumed_at IS NULL
   AND expires_at > now`) — replay = `401`; issuing a new token consumes the user's older live tokens; the
   janitor purges expired rows. `POST /api/auth/password/reset {token, newPassword}` sets the BCrypt hash and
   answers `204`; the seller then signs in (no auto-session from a mailed link). Throttle: at most 3 mails per
   email per 15 min (in-memory) — the answer does not change; a mailer failure (SMTP outage) is swallowed
   with an address-free WARN and the same answer (no oracle, no 500). Existing JWTs stay valid until they
   expire (12 h; there is no server-side session list — recorded as a gap).
3. **Mailer abstraction, three modes** (`SELLEROPS_MAIL_MODE`): `smtp` (JavaMail via `spring.mail.*`), `dev-outbox`
   (in-memory outbox + the full mail **logged at INFO with a `[DEV MAIL OUTBOX]` prefix**, so the local seller can
   copy the reset link from the backend log — allowed only because it is a separate mode that production never
   sets), `off` (default: the reset endpoints exist but `GET /api/auth/password/config` says `enabled:false`,
   the login page shows **no** "비밀번호를 잊으셨나요?" link, and a `forgot` call is accepted and dropped with a
   WARN that names no address). **In `smtp` and `off` mode the reset URL is never written to a log.**
   `sellerops.public-base-url` (`SELLEROPS_PUBLIC_BASE_URL`, default `http://localhost:5173`) builds the mailed
   link.
4. **Consent has two separate layers, both structural only** — no legal text is authored here.
   - **Account consent** (server-side, at sign-up): 필수 = 이용약관 · 개인정보처리방침 동의 (`termsAccepted`
     must be `true` — `400` otherwise — for both `/api/auth/signup` and `/api/auth/social/onboarding/complete`;
     stored as `users.terms_accepted_at` + `users.terms_version`); 선택 = 마케팅 정보 수신
     (`marketingConsent`, stored as `users.marketing_consent_at`, null = no). Version constant
     `TERMS_VERSION = "draft-2026-08"` — flips when the real documents are confirmed (§7).
   - **Browser consent** (client-side, `lib/consent`): categories 필수 (always) · 분석 · 마케팅, stored in
     `localStorage` `sellerops_consent_v1` `{version, analytics, marketing, decidedAt}`. The analytics layer
     starts a vendor sink **only when 분석 is granted**; events before a decision are buffered in memory
     (≤ 100, this page load) and flushed on grant, dropped on refusal. The GTM sink pushes **Consent Mode v2**
     defaults (`analytics_storage`, `ad_storage`, `ad_user_data`, `ad_personalization` = `denied`) before
     `gtm.js` and an `update` on every change (분석 → `analytics_storage`; 마케팅 → the three `ad_*`). PostHog
     `opt_out_capturing()` mirrors 분석. Sentry is 필수 (no PII, service integrity) and does not wait for consent.
   - A decided visitor can change their mind: the public footer's **쿠키·분석 설정** forgets the decision (sinks
     told to stop) and shows the banner again.
   - **Dev policy (local / self-pilot):** the banner exists only when at least one analytics vendor is
     configured (a valid `VITE_GTM_ID` / `VITE_POSTHOG_KEY`); with none, there is nothing to consent to, no
     banner is shown and consent state is `not-applicable`. `VITE_CONSENT_BANNER=always` forces the banner (UI
     review).
   - **Legal pages** `/legal/terms`, `/legal/privacy` render a titled **placeholder** that says the document is
     not yet confirmed — never generated legal wording. Footer + sign-up + onboarding link to them.
5. **Security headers.** Backend (all responses): CSP `default-src 'none'; frame-ancestors 'none'; base-uri
   'none'; form-action 'self'`, `Referrer-Policy: no-referrer`, `Permissions-Policy: camera=(), microphone=(),
   geolocation=(), payment=()`, plus the Spring defaults. Frontend (production build only): a `<meta
   http-equiv="Content-Security-Policy">` generated by `vite.config.ts` from env — `default-src 'self'`;
   `script-src 'self'` + `https://www.googletagmanager.com` iff `VITE_GTM_ID` + the PostHog host iff
   `VITE_POSTHOG_KEY`; `connect-src 'self'` + Sentry ingest origin (from the DSN) + GA collection origins
   (`https://*.google-analytics.com https://*.analytics.google.com https://*.googletagmanager.com`) iff GTM +
   PostHog host + `VITE_API_BASE_URL` origin when set + the **Agent Runtime** origin (`VITE_AGENT_RUNTIME_URL`,
   default `http://127.0.0.1:8787` — the code default) + the **Local Agent Bridge** origin (http and ws,
   `VITE_BRIDGE_URL`, default `http://127.0.0.1:47615`) iff `VITE_ENABLE_AGENT_BRIDGE=true`; `img-src 'self'
   data:` + GA origins iff GTM + `blob:` iff bridge (projection frames); `style-src 'self' 'unsafe-inline'`;
   `object-src 'none'`; `base-uri 'self'`; `form-action 'self'`. `frame-ancestors` cannot be expressed in a
   `<meta>` (browsers ignore it there) — the framing fence for the hosted SPA is nginx's `X-Frame-Options:
   DENY` (`frontend/nginx.conf`). Google / NAVER OAuth are top-level navigations and need no CSP entry. Dev
   (`vite` server) sets no CSP (React refresh needs inline scripts). **Adding an ad tag inside GTM later
   requires adding its origins here** — recorded in §7.
6. **Auth shell.** `/login`, `/signup`, `/auth/callback`, `/onboarding`, `/forgot-password`, `/reset-password`
   share `AuthCard` + `AuthNotice` (info / success / error tones, `role=status|alert`), the same field / button
   styles, and the same footer links; Google / NAVER buttons keep their official branding from v1.10.
7. **Release identity.** Backend `springBoot.buildInfo` with `build.git` = short SHA at build; frontend
   `define: __SELLEROPS_RELEASE__`. Both surface **only** to Sentry (`release`) — never to the seller.

## 3. Backend surface

- `build.gradle`: `io.sentry:sentry-spring-boot-starter-jakarta:8.53.0`, `spring-boot-starter-mail`,
  `springBoot { buildInfo { properties { additional = [git: <sha>] } } }`.
- Migration `V46__service_readiness.sql`: `password_reset_tokens(id, user_id → users, token_hash UNIQUE,
  expires_at, consumed_at, created_at, updated_at)`; `users.terms_accepted_at`, `users.terms_version`,
  `users.marketing_consent_at`.
- `com.sellerops.auth.password`: `PasswordResetToken` + repository (`consume`, `consumeAllLiveForUser`,
  `deleteExpiredBefore`), `PasswordResetService` (`requestReset`, `reset`, `purgeExpired`), `PasswordResetController`
  (`GET /api/auth/password/config`, `POST /api/auth/password/forgot`, `POST /api/auth/password/reset`),
  `PasswordResetThrottle`, `PasswordResetProperties`.
- `com.sellerops.mail`: `Mailer` (`send(OutboundMail)`), `OutboundMail(to, subject, text)`, `SmtpMailer`,
  `DevOutboxMailer` (bounded in-memory outbox + INFO log), `NoopMailer`, `MailerConfiguration` (mode switch;
  `smtp` without `spring.mail.host` fails the boot — misconfiguration is not silently `off`).
- `com.sellerops.telemetry`: `SentryScrub` (`BeforeSendCallback` + `BeforeSendTransactionCallback`; logs one
  INFO line `sentry: enabled environment=… release=…` when a DSN is present — never the DSN),
  `SentryReleaseConfiguration` (release from `SELLEROPS_RELEASE` else `BuildProperties.git`).
  `GlobalExceptionHandler.handleOther` → `Sentry.captureException(ex)` (a no-op with no DSN).
- `SecurityConfig.headers(...)`: CSP / Referrer-Policy / Permissions-Policy as §2-5.
- `SignupRequest` + `SocialOnboardingRequest`: `@AssertTrue termsAccepted`, `Boolean marketingConsent`;
  `AuthService.signup` / `SocialAuthService.completeOnboarding` record the consent columns. `AuthHandoffJanitor`
  also purges expired reset tokens.

## 4. Frontend surface

- `lib/urlSecrets.ts` (`captureUrlSecrets` in `main.tsx` before anything else; `takeUrlSecret` in
  `/reset-password` and `/auth/callback`).
- `@sentry/react` 10.x: `lib/telemetry/{sentry.ts,sentryScrub.ts}` (`initSentryFromEnv`, `captureApiError`),
  `components/app/RootErrorBoundary.tsx`; `apiClient` response interceptor reports ≥ 500 / no-response.
- `lib/consent/{consent.ts,ConsentProvider.tsx,ConsentBanner.tsx}`; analytics gains `setConsent(granted)` +
  buffering; `gtmSink` Consent Mode v2 (`gtag` shim on `dataLayer`); `posthogSink` opt-in/opt-out; sinks start
  eagerly at init when allowed.
- Pages: `ForgotPassword.tsx`, `ResetPassword.tsx`, `LegalPlaceholder.tsx` (`/legal/terms`, `/legal/privacy`);
  `Login` gets the reset link (only when `config.enabled`) and a `?reset=1` success notice; `Signup` and
  `Onboarding` get the two consent checkboxes; `AuthNotice.tsx`; footer legal links.
- `vite.config.ts`: `define __SELLEROPS_RELEASE__`, build-time CSP meta plugin (`lib/security/csp.ts` builds
  the policy string — unit-tested).

## 5. Env (deployer, before service start — the seller never sees these)

| Var | Side | Default | Effect |
|---|---|---|---|
| `SENTRY_DSN` | backend | unset = OFF | Sentry backend |
| `SELLEROPS_ENV` | backend | `local` | Sentry `environment` |
| `SELLEROPS_RELEASE` | backend build/run | build git SHA | Sentry `release` |
| `SELLEROPS_SENTRY_TRACES_SAMPLE_RATE` | backend | `0.1` | performance sampling (`0` = off) |
| `SELLEROPS_MAIL_MODE` | backend | `off` | `smtp` · `dev-outbox` · `off` (§2-3) |
| `SPRING_MAIL_HOST` / `SPRING_MAIL_PORT` / `SPRING_MAIL_USERNAME` / `SPRING_MAIL_PASSWORD` / `SPRING_MAIL_PROPERTIES_MAIL_SMTP_AUTH` / `SPRING_MAIL_PROPERTIES_MAIL_SMTP_STARTTLS_ENABLE` | backend | unset | SMTP (required for `smtp` mode) |
| `SELLEROPS_MAIL_FROM` | backend | `no-reply@localhost` | sender address |
| `SELLEROPS_PUBLIC_BASE_URL` | backend | `http://localhost:5173` | absolute base of mailed links |
| `SELLEROPS_PASSWORD_RESET_TTL_SECONDS` | backend | `1800` | reset link lifetime |
| `VITE_SENTRY_DSN` | frontend build | unset = OFF | Sentry frontend |
| `VITE_SELLEROPS_ENV` | frontend build | `local` | Sentry `environment` |
| `SELLEROPS_RELEASE` | frontend build | git SHA | Sentry `release` |
| `VITE_SENTRY_TRACES_SAMPLE_RATE` | frontend build | `0.1` | performance sampling |
| `VITE_GTM_ID`, `VITE_POSTHOG_KEY`, `VITE_POSTHOG_HOST` | frontend build | unset = OFF | v1.10, unchanged; also drive the CSP and the consent banner |
| `VITE_CONSENT_BANNER` | frontend build | unset | `always` forces the banner without vendors |
| `VITE_AGENT_RUNTIME_URL`, `VITE_ENABLE_AGENT_BRIDGE`, `VITE_BRIDGE_URL` | frontend build | code defaults | pre-existing; now also shape the CSP `connect-src` (§2-5) |
| v1.10 OAuth vars | backend | unset | unchanged |

## 6. Password reset lifecycle

```
/login → "비밀번호를 잊으셨나요?" (only if GET /api/auth/password/config.enabled)
  → /forgot-password: email → POST /forgot → 202 (always) → "가입된 이메일이면 재설정 안내를 보냈어요"
      backend: user with password_hash? → consume older live tokens → mint token → store SHA-256 (TTL 30 min)
               → Mailer.send(reset link {PUBLIC_BASE_URL}/reset-password?token=…)  [smtp | dev-outbox log | off→drop]
  → mail link → /reset-password?token=… : page reads token, replaces the URL without it, asks new password ×2
      → POST /reset {token,newPassword} → consume (atomic) → BCrypt hash saved → 204
        401 (expired / used / unknown) → "링크가 만료되었거나 이미 사용되었어요" + link to /forgot-password
  → /login?reset=1 : "비밀번호가 바뀌었어요. 새 비밀번호로 로그인해 주세요"
```

## 7. Before public launch — legal / deployer checklist (not done in this unit)

- [ ] **이용약관 · 개인정보처리방침 actual documents** (legal review) → replace `LegalPlaceholder`, set
      `TERMS_VERSION`, decide re-consent for existing users. Not authored here on purpose.
- [ ] Consent banner wording / cookie list confirmed against the vendors actually enabled (GTM/GA4, PostHog);
      GA4 data-retention + IP settings; PostHog project region.
- [ ] Sentry projects (backend, frontend) + DSNs; alert routing; `SELLEROPS_ENV=production`; release tagging in CI.
- [ ] Mail provider (SMTP / SES / …) → `SELLEROPS_MAIL_MODE=smtp` + `SPRING_MAIL_*`, `SELLEROPS_MAIL_FROM`,
      SPF/DKIM; `SELLEROPS_PUBLIC_BASE_URL` = the public origin.
- [ ] Web-server access log of the hosted SPA: the backend never logs a reset URL, but nginx's default
      `access_log` records `GET /reset-password?token=…` — scrub the query for that path or disable the access
      log for it (`frontend/nginx.conf` is the place).
- [ ] Production origin: CORS (`SELLEROPS_CORS_ORIGIN`), OAuth redirect URIs at Google / NAVER, HTTPS (HSTS is
      emitted by Spring only on https), `SELLEROPS_OAUTH_FRONTEND_BASE_URL` if split-origin.
- [ ] Ad tags (Google Ads / Meta / NAVER Ads) inside GTM → **extend the CSP origins** (`lib/security/csp.ts`) and
      the consent banner's 마케팅 text at the same time.
- [ ] Explicit account linking (password ↔ social); server-side session invalidation on password reset;
      Cafe24 `first_sync_completed` (v1.10 gaps, unchanged).

## 8. UTM attribution smoke (v1.10 funnel, verified in this unit)

Landing `/product?utm_source=…&utm_medium=…&utm_campaign=…` → GTM loads on the landing page itself (eager start,
after consent) → GA4 config tag (All Pages) sends `page_view` with `page_location` carrying the UTMs → GA4 keys
the session's source/medium/campaign from that page_view; every later `dataLayer` event of the same client
(`sign_up`, `onboarding_completed`, `channel_connected`, `first_sync_completed`) belongs to that session. For SPA
route changes the container needs a **History Change** trigger on the GA4 config tag (documented, container-side).
PostHog stores `$initial_utm_*` from the same landing URL at `init`. Verified in the walkthrough by the
`dataLayer` order (consent default → `gtm.js` → events) and by `page_location` on the landing entry; the GTM /
GA4 property side (key events, History Change trigger) is container configuration and is listed in §7.
