# R4 Operator Runbook — supervised NAVER review export

> **This file grants nothing.** It authorizes no live NAVER contact, no browser launch, no run. It
> describes what the **human** does during a run that has *already* been authorized elsewhere. Nothing
> below being read, checked, or understood makes a run permitted.
>
> **Authorization** lives in [`r4-gate-record.md`](r4-gate-record.md) — a **fresh, single-use, export-scoped
> G6** recorded in the dispatching turn. **Every G6 to date is CONSUMED.**
> **The boundary** lives in [`r4-preparation.md`](r4-preparation.md) §4 — binding, and it wins over this file.

**Scope:** the run-time choreography only. Pre-dispatch authorization is the gate record's
[pre-dispatch runbook](r4-gate-record.md#export-pilot-pre-dispatch-runbook--not-yet-authorized-grants-nothing);
the worked evidence example is [`r4-evidence-pack.md`](r4-evidence-pack.md) §8-17 (Run 4). This file
**links** to both rather than restating them — they are the source, this is the sequence.

**Status:** describes the path **proven end-to-end in Run 4** (2026-07-15, §8-17: `COMPLETED` 3-of-3,
backend `SUCCESS` 55/55/0/0). Written from that run's observations plus the code, not from intent.

---

## 1. Before you start

- The run is authorized by a **filled export-scoped G6** in the dispatching turn — not by this file.
- Read [`r4-preparation.md`](r4-preparation.md) §4 (live-action safety boundary). In one line: **you**
  log in, choose account/store/period, and perform the real export action; **the Runtime** only prepares,
  highlights, observes, verifies, detects read-only, validates, and ingests. **The Runtime never performs
  the export action, and never types a credential.**
- Be **seated and ready before the run starts.** This is a human-in-the-loop run with a short window
  (§3). If nothing gets clicked, the first explanation is an absent operator — not a code bug.

## 2. Phase A — preparation (you have ~10 minutes)

Budget: **`CONFIRM_TIMEOUT_MS` = 10 min** — the sentinel handshake wait. This is the generous phase; take
the time you need inside it.

The collector opens a real Chrome window on NAVER and **waits**. In that same window, you:

1. Complete the **NAVER-ID login**, and any **2FA / CAPTCHA** yourself.
2. Select **account / store**, and select **period / scope**.
3. Reach the **review-management export surface**.
4. **Leave the browser open, and do NOT act on the export control yet.**
5. Signal readiness by creating the sentinel file the CLI prints (in Claude Code, just say **"ready"**).

> **On period / scope:** §4 makes this **your** obligation, and this runbook deliberately gives **no
> procedure for it** — the step has never been observed in a live run. It exists as three words in §4,
> one CLI prompt line, and a halt branch (`EXPORT_DATE_RANGE_REQUIRED`) that has **never fired live**.
> Use your own judgment on the surface; **do not expect this document to guide it.**

If the 10 minutes lapse, the run **aborts without ever driving** — nothing happens, and nothing is
written. Ctrl-C also aborts safely at any point before the run drives.

## 3. Phase B — the export action (you have ~60 seconds)

Budget: **`DOWNLOAD_TIMEOUT_MS` = 60_000` — about 60 seconds.** Once you signal ready, the collector
prepares the surface, locates and **highlights** the one export control, and parks. **The 60-second clock
starts about 1 second after the highlight appears** — the run auto-requests its recheck the moment it
parks, so download detection is already listening.

**⚠ The export is TWO human steps, not one** (observed in Run 4, §8-17). Inside those ~60 seconds you must:

1. **Act on the highlighted export control** yourself. This opens an **expected NAVER confirmation
   dialog** — a normal part of the flow.
2. **Manually confirm that dialog.** **The download only fires on this confirmation.**

**Do both without hesitation.** The Runtime performs neither step.

### Two things about this window that are easy to get wrong

- **10 minutes is NOT your budget.** `OBSERVE_TIMEOUT_MS` is 10 minutes and appears in the code and in
  older notes, but on this path it is **cosmetic** — the run does not wait on it. **The honest number is
  ~60 seconds**, and it is the only one that can fail your run.
- **The Runtime does not see your confirmation.** It observes your action on the highlighted control
  only; the dialog is outside what it watches. **The download firing is the sole evidence you
  confirmed** — which is exactly why step 2 must land inside the window.

## 4. If the window lapses

The run **fails closed**: blocker `DOWNLOAD_TIMEOUT`, no download, **nothing written anywhere** — the
same shape as Run 3 (§8-16), and **non-mutating**. This is a safe outcome, not a broken one.

**But it consumes the G6.** A retry needs a **fresh** one recorded in a new dispatching turn. That is the
real cost of a late click, and the reason for §1's seated-and-ready rule.

## 5. When to abort

Full criteria: [`r4-preparation.md`](r4-preparation.md) §7 — **binding, not re-authored here.** The one
point this runbook restates, because it is the trap Run 4 exposed:

- ✅ **The export confirmation dialog is EXPECTED. Do not abort on it — confirm it.** It is part of the
  flow and the download depends on it.
- 🛑 **Everything else unrecognized still aborts.** Any prompt or dialog you do not recognize, any
  anti-abuse signal (CAPTCHA storm, lockout warning), any on-screen data you did not expect to share,
  or withdrawn consent → **you complete it or walk away; the Runtime never retries around it.**

## 6. After the run

- Evidence to record (sanitized — enums/booleans/counts/SHA only): the gate record's
  [§5 post-run evidence list](r4-gate-record.md#5--post-run-evidence-to-record-sanitized).
- Worked example: [`r4-evidence-pack.md`](r4-evidence-pack.md) **§8-17** (Run 4) — what a `COMPLETED` run
  looks like written up honestly, including its **mutation** note.
- **A successful run mutates the backend** (Run 4 put 55 real rows into the **local dev** DB) and is
  **not reversible by the Runtime**. Know that before you confirm, not after.

---

**Related:** [`HANDOFF.md`](HANDOFF.md) (orientation) · [`r4-preparation.md`](r4-preparation.md) (§4
boundary, §7 abort — normative) · [`r4-gate-record.md`](r4-gate-record.md) (gates, pre-dispatch) ·
[`r4-evidence-pack.md`](r4-evidence-pack.md) (§8-N evidence) ·
[`r4-run4-full-export-pilot-dispatch-record.md`](r4-run4-full-export-pilot-dispatch-record.md) (Run 4
dispatch + the choreography observation this runbook is built on).
