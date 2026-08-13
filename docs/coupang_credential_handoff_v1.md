# Coupang Credential Handoff v1 — the contract

What changes: after the seller has issued their own WING Open API key and confirmed it in a trusted
SellerOps surface, the Local Agent reads 업체코드 / Access Key / Secret Key **once** and hands them
straight to the backend credential vault, which verifies them against a read-only Coupang API call.

What does not change: the seller issues the key. Every press on WING is theirs. SellerOps does not
click, submit, or create a credential, and never has.

Canonical approval contract: [`sellerops_live_approval_contract.md`](./sellerops_live_approval_contract.md)
(§3 the run grant, §5a in-run checkpoints, §5b the auto-read arm policy). This document is the
credential-specific half and adds nothing that weakens those.

---

## 1. The reuse map — what was already here

The backend needs no new credential machinery. Every piece of this path exists and is in use:

| need | existing path | reused how |
|---|---|---|
| encrypted storage | `CredentialVault.store` — per-credential DEK, master key wraps it, plaintext never in DB or logs | unchanged, called through the existing service |
| field shape | `CredentialTemplates` `COUPANG` → `access_key`, `secret_key`, `vendor_id` (+ `secret` flags) | the agent's read targets ARE these three keys |
| payload validation | `CredentialIntakeValidator` — server-owned `connectorClass`/`authType`, unknown keys rejected, values trimmed | unchanged |
| the intake service | `CollectControlService.storeCredential` — org-scoped 404 first, then channel → template → validate → vault | unchanged, one new caller |
| read-only verification | `CoupangApiConnector.verifyConnection` — a low-privilege `returnShippingCenters` GET proves the HMAC key + caller IP, then a read-only `ordersheets` probe answers order access separately | unchanged |
| the verify entrypoint | `CollectControlService.testConnection` — never collects, never writes, returns a safe result only | unchanged |
| live-call interlock | `CoupangLiveCallGuard` — a real marketplace host requires an armed approval id, fail closed | unchanged; it guards this path for free |
| lifecycle | `CoupangConnectionLifecycle` — verified ⇒ `PREPARING`, only a real order sync ⇒ `CONNECTED` | unchanged; a stored key still does not claim a connection |
| expiry, when unknown | `tokenExpiresAt` nullable + `POST /credentials/expiry` for an exact operator-confirmed date | unchanged; see §7 |

**So the only new backend surface is a binding**, not a credential store — see §2.

## 2. How the agent names an account without holding one

The Action Window wire refuses identity: a run carries opaque refs, never a seller-account id
(`contracts/action-window/v2`). That rule is not relaxed here.

It does not need to be. `account_session_slot.account_slot` (V30) is already exactly this object: a
stable, opaque, CSPRNG 24-hex per-account key, **one-way — not reversible to the account id** — minted
find-or-create by `AccountSessionSlotService`, and already handed to the runtime on the review-import
path (`LaunchScopeResponse.accountSlot`).

So the handoff endpoint takes the slot and resolves it server-side.

> **The slot selects; it does not authorize.** It is long-lived and reused, so it is not a capability.
> Authorization is the operator JWT the request carries, and the slot lookup is scoped to that JWT's
> org — a slot from another org reads as absent, with no existence leak. Reading the slot as an
> authorization would be the same defect as reading an auto-read as an approval (§5b): a token that
> identifies is not a token that permits.

**Known placeholder, disclosed rather than hidden:** the agent authenticates with the collector's
SellerOps dev login (`upload.ts login()`). `sellerops_local_agent_runtime_adr.md` §7(3) already lists
"프론트-에이전트 페어링/인증 모델 … 업로드용 데브 계정을 revocable pairing token으로 교체하는 시점"
as an open product-owner decision. This unit does not resolve it and does not make it worse — it adds
one caller to an authentication story that already carries every upload.

## 3. The barrier — where a person decides

`CREDENTIAL_REVEAL` is one of the seven `ACTION_BARRIER_KINDS`, and it has had no call site until now.
This is it.

The barrier is raised **immediately before the read**, inside the boundary that performs it — not at
the top of the run, and not at the step that arms the guidance. The reason is the one §5b already
records: a hand-off at the start authorizes a run, and cannot authorize an act decided on minutes
later, on a screen the seller has since changed. The ask names the three fields, says where the values
go, and says what still will not happen.

An auto-read may bring the walk **to** this barrier — noticing that the credential label has painted
is a reading, and the Action Window's auto-advance is not being taken apart. An auto-read may never
**cross** it. `AUTO_READ` and `OPERATOR_UI_CONFIRMED` remain separate types precisely so "the keys
appeared on screen" cannot be passed where "the seller decided" is required.

Refusal is fail-closed and total: no read, no POST, no status write, `barrierRefusedRecord`, stop.

## 4. ONE-SHOT means one shot

The read is a single in-page evaluation returning the three values together. It is not a poll, not a
retry loop, and not a per-field sequence.

That is a safety property, not an efficiency one. A retry loop is a loop whose body holds three
plaintext secrets, whose exit condition is data-dependent, and whose failure mode is "read them again
because the first read looked wrong" — every extra pass is another window in which a value exists in
another scope. A single read either produces all three unambiguously or **fails closed and reads
nothing again**; recovery is the seller's own existing manual entry path, which has always been there.

Fail closed means: any label not matching exactly once, any label without a uniquely associated value
cell, any empty value, any duplicate among the three — refuse, report the value-free reason, stop.

## 5. What may cross which boundary

| boundary | may carry | may never carry |
|---|---|---|
| in-page → agent | the three values, once | DOM, HTML, screenshots, the page URL, any fourth field |
| agent → stdout / log / telemetry / status file | outcome enum, per-field presence, length bucket, char class, salted digest prefix | any value, or any substring of one |
| agent → backend | the three values, in ONE request body, over loopback | anything else about the page |
| backend → response | masked metadata + a safe connection result | any value, ciphertext, IV, or provider body |
| agent → anywhere else | **nothing** | clipboard, a file, `localStorage`, a fixture, an env var, a second endpoint |
| agent → Claude / any LLM context | **nothing** | the values never enter a model context, in any form |

The last row is the one this unit exists for. The values are read by a local process and posted by that
same process. No assistant, no chat surface, and no transcript is in the path.

**The one exception, named rather than buried.** The calibration (§11 step 1) reports, per cell, whether
it holds non-empty text — one boolean, derived from a credential, taken BEFORE any barrier. It is
required: a locator that resolves to an empty cell has not found the key, and a calibration that cannot
tell those apart would certify a locator that reads nothing. It carries its own declared capability
(`MEASURE_CREDENTIAL_CELL_STRUCTURE`) rather than riding along with the structural ones, exactly as
`OBSERVE_FIELD_NONEMPTY_AGGREGATE` does for the vendor form — and unlike that one, which promises it is
never taken on a credential, this one says plainly that it is. No length, no character class, no prefix.

## 6. Plaintext lifetime, stated honestly

The values live in **one function scope**, from the read until the POST resolves. They are never
returned to a caller, never stored on an object, never put in a closure that outlives the call, and
never serialized except into the single request body.

**What cannot be claimed:** JavaScript strings are immutable and garbage-collected. There is no
`memset` for them, so "the plaintext was wiped" would be false. What is true is narrower and is what
the tests pin: the only reference is dropped at the end of one scope, and nothing on any other path
ever held one. Overwriting a variable with `""` afterwards would be theatre — it replaces a reference,
not the bytes — so this code does not do it and does not claim it.

The same is true in-page: the values are read out of the DOM WING itself rendered. Nothing is injected,
typed, or left behind, and the read adds no attribute of its own.

## 7. Expiry is never guessed

`tokenExpiresAt` is stored **only** from a value that was actually read, unambiguously, from a
structurally identified expiry field. Absent that it is `null`.

`null` is a modelled state — "unknown", not "no expiry" — and the backend already carries the operator
path for it (`POST /credentials/expiry`, an exact date, never an estimate). An inferred expiry
("issued today, WING keys last N months") is forbidden: it would put a fabricated date in front of an
alerting system that renews credentials, and a wrong renewal date is worse than an absent one.

**As of this unit no expiry field on the issued screen has been measured**, so v1 stores `null`. That
is a stated non-capability, not an oversight.

## 8. Evidence carries status and digest, never a value

The record a run emits is value-free:

- `outcome` — a closed enum
- per field: `present`, `lengthBucket`, `charClass`
- `digest` — `credential-handoff-digest/v1`: HMAC-SHA256 under a **per-run random salt**, first 12 hex

The salt is generated per run, held in memory, and never logged or persisted. It exists because a plain
digest of 업체코드 is an enumeration oracle — the vendor code is short and low-entropy, and an unsalted
hash of it is reversible by anyone with a candidate list. A per-run salt makes the digest useful for
exactly what it is for (telling three distinct values apart, and referring to one later **within the
same run**) and useless as a cross-run identifier or an offline attack surface.

The digest is not evidence to the backend, which cannot compute it. Nothing in this design asks it to.

## 9. Deliberately out of scope

Key deletion, reissue, renewal, rotation on expiry, reading a key that was issued in an earlier session,
and any second channel. `POST /credentials/replace` (guided renewal, with rollback) already exists and
is untouched by this unit.

## 10. Not established

- **Where the credential VALUES sit relative to their labels.** `WING_CREDENTIAL_REGION_EVIDENCE`
  measured the label structure (three `<th>` in one header row) and explicitly records
  `WHERE_THE_CREDENTIAL_VALUES_SIT_RELATIVE_TO_THE_VENDOR_BLOCK` as **not established**. A value-cell
  locator written today would be a guess. It is measured by a separate value-free READ_ONLY
  calibration before any handoff runs — see §11.
- Whether WING renders an expiry on that screen at all (§7).
- Whether the issued screen's structure is stable across WING variants. Every rule here is written
  against a measurement, fails closed without one, and claims n=1 where that is what it has.

## 11. Order of operations

1. Value-free calibration (READ_ONLY): does each label have a uniquely associated value cell, and what
   is its shape? **No value crosses the boundary.** Its own approval.
2. Offline: the read, the handoff, the barrier, the leak regression — all against the measured shape.
3. The live proof: its own manifest, its own fresh approval, naming the credential read explicitly.
   A grant for the calibration is never a grant for the handoff.
