# SellerOps

**SellerOps is a multi-channel commerce operations AI agent for SME sellers/manufacturers.**
It carries operational work between human decisions across the seller's channels — normalizing
reviews, inquiries, orders, and reports, and surfacing what needs action.

It is **not** a scraper dump, a browser click-bot, or a VOC/cardnews project. Agentic value is
measured by the operational work removed around human checkpoints — not by making data acquisition
click-free. Canonical product/strategy/state reference:
[`docs/sellerops_canonical_reference.md`](docs/sellerops_canonical_reference.md).

## Repository modules

- `backend/` — Spring Boot service (Java, Gradle, Postgres/Flyway, JWT).
- `frontend/` — React/Vite operations UI.
- `collector/` — TypeScript local agent: channel acquisition and the Action Window flow (NAVER, ESM, Cafe24).
- `contracts/` — shared contracts (Action Window, review fingerprint).
- `tools/` — dev/support tooling (e.g. `cafe24-callback` dev receiver).
- `docs/` — current SellerOps docs and `docs/archive/` for historical material.

Local dev stack: `docker-compose.yml` (Postgres + backend + frontend) —
`cp .env.example .env && docker compose up --build` (frontend :5173, backend :8080).

## Development

- Do normal development in `sellerops/repo`, or in feature-named worktrees under `sellerops/worktrees/`.
- **Runtime state holders live outside this repo** at `sellerops/runtime-holders/` (worktrees that hold
  live profiles, `.env`, connections, and run state). **Do not develop in them.**

## Safety boundaries

SellerOps operates within firm fences:

- **No CAPTCHA / 2FA bypass** and no auth bypass.
- **No hidden or chained platform clicks** — manual progress always remains available.
- **No automatic export / download / submit** as product behavior — those happen only through an
  explicit, approved **human checkpoint**.
- **Official APIs first; the Action Window** pattern for user-confirmed platform actions: the seller
  clicks export/consent/download/submit on the marketplace, and SellerOps only detects, validates,
  and processes the result. Ambiguous or changed targets fail closed. Output is sanitized — never
  credentials, tokens, seller IDs, raw page content, or personal data.

## Legacy note

The legacy Python VOC / OliveYoung / Brand20 / cardnews stack (`voc-intelligence`) was **removed**
from this active repo and **preserved separately** under `voc-oliveyoung`. This repo is the active
SellerOps product only.
