# SellerOps AI — Frontend

React + TypeScript + Tailwind CSS (Vite). Toss-like clean UI: large type,
card-based dashboard, simple Korean labels.

## Run locally
```bash
npm install
cp .env.example .env   # optional; defaults work
npm run dev            # http://localhost:5173
```
With no backend running, set `VITE_USE_MOCKS=true` (or just leave the backend
down — read GETs fall back to seeded mock data so the UI is never blank).

## Build
```bash
npm run build      # tsc --noEmit + vite build → dist/
npm run typecheck  # types only
```

## Routes
`/login` then the authenticated shell: `/` 홈, `/inbox` 인박스, `/orders`
주문·매출, `/issues` 상품 이슈, `/search` AI 검색, `/reports` 리포트,
`/channels` 채널 연결, `/alerts` 알림 설정.

## Structure
- `lib/` — `apiClient` (axios + JWT + mock fallback), `auth` (context),
  `types` (mirrors backend DTOs), `mocks`, `format`, `useApiData`.
- `components/` — `AppShell`, `Sidebar`, `TopBar`, `StatCard`, `Section`,
  `StatusBadge`, `DataBadge`, `Charts`, `EmptyState`, `ComingSoon`.
- `pages/` — one per route.

상품 이슈 / AI 검색 / 리포트 / 알림 설정 are Phase-1 placeholders; AI analysis
connects to the Python review-ops engine in a later phase.
