# SellerOps AI — Phase 1: Skeleton & UI Foundation

A unified commerce seller-operations dashboard. Phase 1 ships the product
skeleton and a high-quality UI foundation on seeded/mock data. The look-and-feel
goal: a clean, large-text, card-based **seller-center dashboard** for 40–50+ year
old manufacturing CEOs/operators — *not* an AI report tool.

## Stack
- Backend: Spring Boot 3, Java 17, Gradle, Spring Security (JWT), JPA/Hibernate,
  Flyway, PostgreSQL.
- Frontend: React + TypeScript + Tailwind CSS, Vite, React Router.
- Local dev: Docker Compose (Postgres + backend + frontend).

## What is built (Phase 1)
- **App shell**: sidebar (8 menus), top bar, responsive card layout, large type.
- **Auth**: signup / login / me with JWT.
- **Home dashboard**: 8 stat cards + 6 sections from `GET /dashboard/*`.
- **Channel connection page**: 13-channel grid with status + data badges +
  last-synced + action button.
- **Inbox / Orders**: unified feed + order-summary endpoints and pages.
- **Mock seeding**: a seeder fills Postgres so the UI is never blank; the
  frontend also has a mock fallback layer.

## What is NOT built (Phase 1)
Real Coupang/Naver/any channel API; OpenAI/RAG; the Python analysis bridge
implementation; notification sending; reports generation; file-upload connector
logic. `상품 이슈` and `AI 검색` render placeholder data via a mock analysis port.

## Backend domains
`auth, organization, user, channel, sellerAccount, dashboard, inquiry, review,
order, product` plus shared `common/`, `config/`, `inbox/`, `analysis/`.

## DB tables (Flyway `V1__init.sql`)
`organizations, users, channels, seller_accounts, products, channel_products,
inquiries, reviews, order_daily_summaries, sync_jobs, sync_cursors`.

## API endpoints (`/api`, JSON)
| Method | Path | Purpose |
|---|---|---|
| POST | `/auth/signup` | create org + user, return token |
| POST | `/auth/login` | return `{token, user}` |
| GET | `/users/me` | current user + org |
| GET | `/channels` | all channels + status + data badges + last sync |
| GET | `/seller-accounts` | org's connected/available accounts |
| POST | `/seller-accounts/file-channel` | register a file-upload channel account |
| GET | `/dashboard/summary` | 8 cards + section payloads |
| GET | `/dashboard/channel-status` | per-channel 현황 |
| GET | `/inbox` | unified 문의+리뷰 feed |
| GET | `/orders/summary` | 7-day trend + channel sales share |

## Frontend routes
`/login` (public), then the authenticated shell: `/` 홈, `/inbox` 인박스,
`/orders` 주문·매출, `/issues` 상품 이슈, `/search` AI 검색, `/reports` 리포트,
`/channels` 채널 연결, `/alerts` 알림 설정.

## Future Python bridge (planned, not built)
`analysis/ReviewAnalysisPort` (`discoverRepeatedIssues`, `searchReviews`) is the
seam. A future `PythonReviewOpsAdapter` will HTTP-call the existing Python
review-ops service so `상품 이슈` / `AI 검색` use real repeated-issue discovery and
review Q&A. Phase 1 uses `MockAnalysisAdapter`.

## Run locally
```bash
cp .env.example .env
docker compose up --build
# frontend: http://localhost:5173   backend: http://localhost:8080
# demo login is created by the seeder: see backend/README.md
```
Local (without Docker): run `backend` with a local Postgres + Gradle, and
`frontend` with `npm install && npm run dev`. See the per-package READMEs.

## Relationship to the Python tree
The Python review-ops app is left fully in place and unmodified. A git safety tag
`pre-sellerops-python-review-ops` marks the pre-SellerOps state for recovery.
