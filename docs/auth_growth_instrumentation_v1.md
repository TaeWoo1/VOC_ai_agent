# Auth + Growth Instrumentation v1 — contract

Status: **contract + implementation record** (2026-08-19, product-owner decision). Scope lock reference:
`docs/product-scope-v1.md` v1.10 note. IA reference: `docs/product_assembly_ia_v1.md` §8 (auth surface routes).
This document owns: social login (Google · NAVER) on top of the existing email/password/JWT auth, the
minimal onboarding for a new social user, the single frontend analytics abstraction, its sinks (GTM/GA4,
optional PostHog), the canonical funnel, and what is deliberately **not** done in this unit.

## 1. Audit (what existed on `main@42ffd90d`)

| Area | Found | Consequence |
|---|---|---|
| Auth model | `AuthService` (email/password, BCrypt) → `JwtTokenProvider` HS256 JWT (`sub`=userId, `orgId`, `email`), `JwtAuthFilter` (also refuses tokens whose org no longer exists), `SecurityConfig` STATELESS chain, `/api/auth/**` permitAll | Social login must end in the **same JWT**; nothing else in the app changes |
| Schema | `users(org_id NOT NULL, email NOT NULL UNIQUE, password_hash NOT NULL, name, role)` | A user cannot exist without an org → onboarding must precede user creation; social-only users need `password_hash` nullable |
| Frontend auth | `AuthProvider` (`login`/`signup`/`logout`, token in `localStorage`, `getMe` hydrate), `/login`, `/signup`, 401 interceptor → `/login?expired=1` | Add `acceptSession` for the code exchange; keep the flows |
| Dev topology | FE :5173 calls same-origin `/api` through the vite proxy; backend :8080 | OAuth endpoints (`/oauth2/authorization/*`, `/login/oauth2/code/*`) are proxied too so **one public origin** is the redirect URI both in dev and prod |
| Analytics | none; no vendor script, no `VITE_*` for GTM/GA4/PostHog | Green-field abstraction; local/dev OFF by default |

## 2. Decisions (product-owner amendments included)

1. **JWT is never carried in a URL.** OAuth success mints a **short-lived one-time auth code** (32 random
   bytes, base64url; only its SHA-256 is stored; TTL 120 s), redirects the browser to `/auth/callback?code=…`,
   the frontend POSTs `/api/auth/social/exchange {code}`, the backend consumes the code atomically
   (`UPDATE … WHERE consumed_at IS NULL AND expires_at > now`) and answers with the **existing** `AuthResponse`
   (`token`, `user`). A code is usable once; a replay is `401`.
2. **Social identity = `(provider, provider_subject)`** in `user_identities`. **No automatic account link by
   email.** If a first-time social identity arrives with an email that already belongs to a `users` row, the
   sign-in is **refused (fail closed)** and the login page says so (`/login?social=email_taken`); explicit
   account linking is a later, signed-in feature (§9). The same rule holds the other way: password sign-up
   with an email a social user already holds is the existing `409`.
3. **No user without an org.** A first-time social identity does **not** create a user. The success handler
   writes a **pending onboarding handoff** (provider, subject, email, display name; TTL 30 min, one-time) and
   the exchange answers `ONBOARDING_REQUIRED` with an opaque `onboardingToken` (JSON body, never a URL). The
   frontend `/onboarding` asks for 상호명 (+ 이름, prefilled) and POSTs
   `/api/auth/social/onboarding/complete`; **org + user + identity are created in one transaction**, the
   email-collision and identity-collision checks are repeated inside that transaction, and the answer is the
   JWT `AuthResponse`. Then `/connect`.
4. Providers: **Google (OIDC)** and **NAVER (OAuth2, custom provider)** via Spring Security's
   `oauth2Login()` — the existing auth system is **not replaced**; a provider exists only when its client id is
   configured (`SELLEROPS_OAUTH_GOOGLE_CLIENT_ID/SECRET`, `SELLEROPS_OAUTH_NAVER_CLIENT_ID/SECRET`); with none
   configured no OAuth endpoint or bean exists and the buttons are not rendered (`GET /api/auth/social/providers`).
5. A provider identity **without a verified email** is refused (`/login?social=email_missing`) — `users.email`
   is NOT NULL and is the seller's login identity; NAVER must have 이메일 consent enabled in the app.
6. Password login for a social-only user (`password_hash IS NULL`) fails with the **same** generic message as a
   wrong password (no account enumeration).
7. Redirect targets are **relative** (`/auth/callback`, `/login?social=…`) so the single public origin holds;
   `SELLEROPS_OAUTH_FRONTEND_BASE_URL` may prefix them for a split-origin deployment.
8. Analytics: exactly one abstraction, `analytics.track(event, props)` (`frontend/src/lib/analytics/`). Pages
   never touch `dataLayer`, `gtag`, or `posthog`. Sinks: **GTM** (`VITE_GTM_ID`; `dataLayer` push, container
   loads GA4) and **PostHog** (`VITE_POSTHOG_KEY` [+ `VITE_POSTHOG_HOST`]; session replay OFF, autocapture
   OFF, pageview OFF). Both OFF when their env is empty — local/dev default.
9. **PII allow-list, enforced in code, not by convention.** Every event has a fixed prop key set and every value
   must be one of an enum (`method ∈ email|google|naver`, `channel ∈ naver|coupang|cafe24`). Any other key or
   value is dropped before it reaches a sink; free-form strings are impossible by construction. `identify` uses
   the internal user UUID only (opaque, non-PII). Never sent: email, name, orgName, review/inquiry text,
   marketplace ids, seller account ids, tokens.

## 3. Backend surface

- Migration `V10__social_login.sql`: `users.password_hash` DROP NOT NULL; `user_identities(id, user_id → users,
  provider, provider_subject, email, created_at, updated_at, UNIQUE(provider, provider_subject))`;
  `auth_handoffs(id, code_hash UNIQUE, purpose SESSION|ONBOARDING, user_id, provider, provider_subject,
  email, display_name, expires_at, consumed_at, created_at, updated_at)`.
- `com.sellerops.auth.social`: `SocialLoginProperties`, `SocialLoginConfiguration` (conditional
  `ClientRegistrationRepository`: Google = `CommonOAuth2Provider.GOOGLE`, NAVER = custom
  authorize/token/userinfo, `user-name-attribute=response`, `client_secret_post`), `SocialLoginSuccessHandler`
  (extracts provider/subject/email/name → `SocialAuthService.onProviderAuthenticated` → redirect),
  `SocialLoginFailureHandler` (→ `/login?social=failed`), `SocialAuthService`, `SocialAuthController`,
  entities `UserIdentity`, `AuthHandoff` + repositories, `AuthCodes` (random code + SHA-256).
- Endpoints (all `permitAll`): `GET /api/auth/social/providers` → `{google, naver}`;
  `POST /api/auth/social/exchange {code}` → `{status:"SIGNED_IN", token, user}` |
  `{status:"ONBOARDING_REQUIRED", onboardingToken, provider, email, name}`;
  `POST /api/auth/social/onboarding/complete {onboardingToken, orgName, name}` → `AuthResponse`.
- `SecurityConfig`: `oauth2Login` wired only when a `ClientRegistrationRepository` bean exists;
  `/oauth2/**`, `/login/oauth2/**` permitAll. The OAuth `state` round-trip uses the servlet session for the
  seconds between authorize and callback (default Spring repository); the API stays JWT-stateless.
- Registered redirect URI at Google / NAVER developer console: `{public origin}/login/oauth2/code/google`
  and `{public origin}/login/oauth2/code/naver` (dev: `http://localhost:5173/...`, through the vite proxy).

## 4. Frontend surface

- `/login`, `/signup`: polished auth cards, **Google** (light "Google 계정으로 계속하기" per Google
  branding: white, `#747775` border, G mark) and **NAVER** (`#03C75A`, white N mark, "네이버로 계속하기")
  buttons — plain `<a href="/oauth2/authorization/{provider}">`; a divider "또는 이메일로"; buttons only for
  configured providers. `/auth/callback` (exchange), `/onboarding` (상호명 · 이름 → complete → `/connect`).
- `AuthProvider.acceptSession(AuthResponse)`.
- `analytics` initialised in `main.tsx`; `identify(userId)` / `reset()` follow the auth context.

## 5. Events (this unit) and where they fire

| event | props | fired |
|---|---|---|
| `sign_up` | `method` | `/signup` success (email); `/onboarding` complete (google/naver) |
| `login` | `method` | `/login` success (email); `/auth/callback` `SIGNED_IN` (google/naver) |
| `onboarding_started` | — | `/onboarding` mounted with a pending token |
| `onboarding_completed` | — | `/onboarding` complete success (also for email sign-up: sign-up *is* the onboarding → fired right after `sign_up`) |
| `channel_connect_started` | `channel` | `/connect/naver`, `/connect/coupang`, `/connect/cafe24` mounted |
| `channel_connected` | `channel` | NAVER/Coupang connection test `SUCCESS`; Cafe24 result `status=connected` |
| `first_sync_completed` | `channel` | NAVER/Coupang wizard first sync `SUCCESS` (once per channel per session); Cafe24: **gap** — the first sync runs from the channel workspace, not the wizard (§9) |
| `today_inbox_viewed` | — | 홈 `/` mounted |
| `review_attention_opened` | — | `/reviews` mounted with the attention tier active |
| `inquiry_opened` | — | `/inquiries` mounted |

## 6. Canonical funnel and GA4 key events

`landing (/product page_view)` → `sign_up` → `onboarding_completed` → `first_channel_connected` (=
first `channel_connected`) → `first_sync_completed`.

GA4 key-event candidates (mark in GA4 admin, not in code): `sign_up` (primary), `onboarding_completed`,
`channel_connected`, `first_sync_completed` (activation). Retention (PostHog): `today_inbox_viewed` weekly.

## 7. Ad tags — prepared, not firing

Everything reaches GTM as `dataLayer` events with the names above, so Google Ads conversion, Meta Pixel /
CAPI and NAVER Ads conversion tags are attached **in the GTM container** on `sign_up` /
`first_sync_completed` triggers when accounts exist. No ad SDK is loaded by the app, and nothing fires in
this unit. Meta CAPI (server side) is out of scope until a server sink exists.

## 8. Env (deployer, before service start — the seller never sees these)

Backend: `SELLEROPS_OAUTH_GOOGLE_CLIENT_ID`, `SELLEROPS_OAUTH_GOOGLE_CLIENT_SECRET`,
`SELLEROPS_OAUTH_NAVER_CLIENT_ID`, `SELLEROPS_OAUTH_NAVER_CLIENT_SECRET`, optional
`SELLEROPS_OAUTH_FRONTEND_BASE_URL`. Frontend build: `VITE_GTM_ID`, `VITE_POSTHOG_KEY`,
`VITE_POSTHOG_HOST` (default `https://us.i.posthog.com`).

## 9. Known gaps / not in this unit

- Explicit account linking (password ↔ social, social ↔ social) for a signed-in user.
- Cafe24 `first_sync_completed` (its first sync is not observed by the wizard).
- Server-side analytics sink / Meta CAPI; consent banner (no cookies are set by the app itself; GTM/PostHog
  cookies appear only when the deployer enables them).
- Landing `page_view` is GTM's own trigger (All Pages), not an app event.
