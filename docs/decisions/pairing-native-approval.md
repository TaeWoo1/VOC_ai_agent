# Decision — pairing is approved in the agent's own window, not retyped in the browser

**Status:** accepted (2026-08-20) · **Scope:** `collector/src/bridge/*`, `frontend/src/lib/bridge/*`
**Supersedes nothing.** The out-of-band approval secret and every check around it stay exactly as they were.

## The problem

The seller was being asked to do a developer's job. Pairing minted a secret, showed it through an
`ApprovalPresenter`, and then required a human to carry it back into a browser field. On the product path
(an installed launchd agent, `NODE_ENV=production`, `macos_native`) that meant reading a code off an OS
dialog and typing it into a page — and on a dev boot whose stderr is redirected, the code appeared nowhere
at all and the instruction on screen ("에이전트를 실행한 터미널에 표시된…") named a window that did not exist.

## What changed

`PresentResult` gained `approved`: an **attestation** that a human answered affirmatively *in a surface this
process owns*. The macOS dialog already collected that verdict — 확인/취소 — and threw it away. Now:

- the dialog asks the question (origin + workspace + "연결할까요?") with **허용 / 거부** buttons, and no longer
  displays the code at all;
- on 허용 the bridge calls the ordinary `confirmPairing(requestId, "allow", secret)` **itself**;
- the `pair/request` response carries `attested: true` and omits `confirmationCode`/`confirmUrl`, so the
  frontend shows no code screen and opens no confirmation tab. The existing poll collects the token.

An unanswered dialog is `unavailable: "no_response"` → `503 approval_no_response`, kept distinct from
`approval_unavailable` because the fixes differ ("you were away" vs "this Mac cannot ask").

The frontend asks **once, automatically**, when it finds an unpaired agent — bounded to one attempt per
client and never from a hidden tab, because what the attempt raises is an OS-level dialog.

## Why this does not weaken the gate

The secret exists so that *a caller confined to the HTTP surface cannot forge a human approval*
(`approval-presenter.ts`). That property is unchanged: the only thing that can confirm a pairing is a press
on a dialog the agent itself spawned. A hostile local process can still provoke that dialog — and the origin
it claims is shown in the body, exactly as before — but it cannot answer it. What was removed is the
retyping, not the check; `confirmPairing` runs the same constant-time comparison against the same secret.

It is in one respect **stronger**: the code is no longer rendered anywhere. A secret displayed for a reader
who no longer needs it is pure exposure (shoulder-surfing, screen sharing, screenshots), so on this channel
it never leaves the process.

Auto-approve (`--dev-insecure-auto-approve`) is untouched and still refused under `NODE_ENV=production`.
The DEV terminal flow — code, confirmation page, two steps — is unchanged and still covered by its own tests.

## Environment truth

| | dev boot (`NODE_ENV` unset) | installed service (`NODE_ENV=production`, darwin) |
|---|---|---|
| presenter | `dev_tty_stderr` | `macos_native` |
| what the human does | read the code, type it into the confirm page | press **허용** |
| what the browser shows | code + confirm page | "내 PC 화면에 뜬 SellerOps 창에서 [허용]을 눌러 주세요." |

Autostart is not new: `collector/src/agent/local-agent-service.ts` already installs the agent as a launchd
user agent, pins `NODE_ENV=production`, and **refuses to install unless that decision yields the native
presenter** — a service host with no human channel could never pair.
