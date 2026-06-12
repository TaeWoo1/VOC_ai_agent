# SellerOps AI — Backend

Spring Boot 3 (Java 17) + PostgreSQL + Flyway + Spring Security (JWT).

## Run with Docker (recommended)
From the repo root:
```bash
cp .env.example .env
docker compose up --build
```
Backend: http://localhost:8080 — health at `GET /health`.

## Run locally (without Docker)
Requires JDK 17 + a local PostgreSQL and Gradle (or generate the wrapper with
`gradle wrapper`).
```bash
cp .env.example .env.local        # this directory's git-ignored real env file
# fill in .env.local, then load it — Spring Boot does not read .env files itself
set -a; source .env.local; set +a
# create the DB: createdb sellerops
./gradlew bootRun
```
Full walkthrough (vault key, connector flags, credential intake):
[`docs/sellerops_local_env_setup.md`](../docs/sellerops_local_env_setup.md).

## Demo login (created by the seeder on an empty DB)
- email: `demo@sellerops.ai`
- password: `demo1234`

The seeder (`config/MockDataSeeder`) runs only when no organizations exist and
fills the 13-channel catalog plus sample products/inquiries/reviews/order
summaries so every screen renders data. Disable with `sellerops.seed.enabled=false`.

## Endpoints
| Method | Path | Auth |
|---|---|---|
| POST | `/api/auth/signup` | public |
| POST | `/api/auth/login` | public |
| GET  | `/api/users/me` | bearer |
| GET  | `/api/channels` | bearer |
| GET  | `/api/seller-accounts` | bearer |
| POST | `/api/seller-accounts/file-channel` | bearer |
| GET  | `/api/dashboard/summary` | bearer |
| GET  | `/api/dashboard/channel-status` | bearer |
| GET  | `/api/inbox` | bearer |
| GET  | `/api/orders/summary` | bearer |
| POST | `/api/uploads` (multipart: channelId, uploadType, file) | bearer |
| GET  | `/api/sync-jobs` | bearer |
| GET  | `/health` | public |

## Test
```bash
gradle test   # JwtTokenProviderTest — pure unit, no DB needed
```

## Future Python bridge
`analysis/ReviewAnalysisPort` is the seam to the existing Python review-ops
engine (repeated-issue discovery + review Q&A). Phase 1 wires only
`MockAnalysisAdapter` (canned data, no controller). A future
`PythonReviewOpsAdapter` will HTTP-call the Python service — not built yet.
