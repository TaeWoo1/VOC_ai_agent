# D6 — Claude Operator Copilot — Closeout Handoff

Status: **SHIPPED & TIDIED**. Track paused by design.

## 1. Final HEAD

- `main` @ `f8a36e4`
- No D6 feature branches remain (local or remote) — all 5 pruned after ancestor-verification against `origin/main`.

## 2. What D6 shipped

D6 attaches a local Claude Code instance as a **read-only, advisory-only operator copilot**
fallback. It fires only when a message is NOT claimed by any existing deterministic
handler. It added **no new regex/case classification** — copilot eligibility is a
deterministic *negative* gate that reuses existing classifiers, so copilot only handles
"leftover" messages no other route claims. This resolves the original misroute where
"진행된 내용 정리" was wrongly routed to archive/cancel because "정리" matched an
unanchored cancel-verb regex.

| Slice | What it added |
|---|---|
| **D6-1a** | `operator_copilot` seam — pure module: prompt/context builders, `is_copilot_eligible` negative gate, `_RESPONSE_CONTRACT`. |
| **D6-1b** | Discord **0d hook** in `task_discord_adapter` — runs after lifecycle/status routes, before generic fallthrough. |
| **D6-2a** | Hardened local Claude backend (`copilot_backend.py`) — `claude -p --permission-mode plan --output-format json --tools "" --no-session-persistence --disable-slash-commands`, env scrub, killpg timeout, cwd=tempdir, 16k cap, fail-as-`""`. |
| **D6-2b** | Env-selected resolver — `_resolve_copilot_responder` picks backend from env; test seam `_COPILOT_RESPONDER` outranks env. |
| **D6-3a** | Operator-friendly briefing UX — 5-section response contract (한 줄 결론 / 지금 바로 볼 것 ≤3 / 지금은 무시해도 되는 것 / 다음 추천 / 실행 주의), `_GLOSSARY` translation of internal labels, no task_id dumps, legacy framed non-urgent. |

## 3. Runtime behavior

Copilot is enabled **only** when all hold (triple gate):

- `AGENT_OPERATOR_COPILOT_ENABLED=1`
- `AGENT_OPERATOR_COPILOT_BACKEND=claude`
- local `claude` binary available (`shutil.which`)

If any gate is off, the 0d hook is inert and routing is identical to pre-D6.

**Preserved deterministic routes** (copilot never intercepts these):

| Phrase | Route |
|---|---|
| 상태 알려줘 | operator_status card (read-only) |
| 진행해 | lifecycle / root task_id disambiguation |
| 최종 발송 승인 | send route (or send_no_pending) |
| 최종 게시 승인 | publish route |
| 라이브 수집 승인 | collect route (or collect_no_pending) |

Routing order: `0a` intent planner (inert) → `0b` agent_discord.try_handle
(진행해/취소/lifecycle) → `0c` status hook (anchored 상태/status) → `0d` copilot (D6)
→ `1` question gate → `2` operational router → `3` classify → new-task graph.

## 4. Safety boundaries

- **Advisory / read-only.** Copilot emits a briefing; it executes nothing.
- No send / publish / collect / render.
- No task_id auto-choice — disambiguation stays with the deterministic lifecycle route.
- No final-approval-phrase handling by copilot (approvals stay deterministic).
- No packet / status / log mutation.
- Backend runs in `--permission-mode plan` with empty tool set, scrubbed env, temp cwd —
  cannot touch the repo even if prompted to.
- Every reply carries header `🤖 copilot(조언 전용) · 실행 없음`.

## 5. Live smoke result

Run against the live Discord bot with both env flags set; PRE snapshot captured first.

- **Copilot messages (3): PASS** — all carried the copilot header, followed the 5-section
  contract, translated internal labels (검토 가능 / 실제 완료 / 과거 방식·미완 instead of raw
  `ready_for_review` / `completed_real` / `legacy_send_log_only`), framed legacy as
  non-urgent, and claimed no execution.
- **Preserved phrases (4): PASS** — 상태 알려줘 → operator_status card; 진행해 → lifecycle
  task_id clarification; 최종 발송 승인 → send_no_pending; 라이브 수집 승인 →
  collect_no_pending. None carried the copilot header.
- **Zero mutation** — POST snapshot matched PRE exactly: git porcelain count, orchestration
  jsonl mtimes, approvals.log mtime, outputs newest mtime, status.json count, no new/modified
  send_log.md or publish_log.md. Bot confirmed restarted post-merge.

## 6. Known UX notes

- Copilot replies are a clear improvement over the D6-2c baseline.
- One minor observation: at an operator-decision point, msg-2 cited two concrete task_ids
  (`task_fa185e…` / `task_9266e…`). Arguably useful, not a dump — flagged for tuning, not a defect.
- Open future question for **D6-4**: tune response length and how much task_id detail is
  exposed, once there is real-usage signal.

## 7. Recommended next steps

1. **Pause D6.** Track is feature-complete.
2. Use the copilot in Discord for a few real sessions with the flags on.
3. Collect bad/weak answers (length, task_id exposure, label translation misses).
4. **Only then** scope D6-4 against that evidence — do not pre-design it.

Deferred / not authorized to start: D6-4 tuning; `status_reader._state_from_send_log`
case-insensitivity fix; D5-3b status.json backfill. None may begin without explicit
per-turn authorization.
