# Coupang Credential Handoff v1 — live proof record

Four phases, each with its own manifest and its own single-use grant. A grant for one is never a grant
for the next, and the code enforces the order: `WING_CREDENTIAL_CELLS_CALIBRATED` ships `false`, so a
`CREDENTIAL_READ` manifest cannot even be prepared until phase 2 has measured the screen.

| phase | what it does | state |
|---|---|---|
| 1. key issuance | the OPERATOR issues a real WING Open API key; the agent guides and reads no value | **PASS 2026-08-13** |
| 2. cell calibration | READ_ONLY: which cell holds each key, value-free | pending |
| 3. handoff | one-shot read → vault → read-only verify | blocked on 2 |
| 4. — | | |

Contract: [`coupang_credential_handoff_v1.md`](./coupang_credential_handoff_v1.md).
Approval contract: [`sellerops_live_approval_contract.md`](./sellerops_live_approval_contract.md) §5c.

---

## Phase 1 — key issuance (PASS)

| | |
|---|---|
| phase | `COUPANG_WING_GUIDED_ISSUANCE_WALK` |
| approval | `apr-4a2b83d3e02b` |
| run | `wt-b63b4297cab6` |
| commit | `1943918f` (clean tree, drift-checked) |
| agent mode | `READ_ONLY` — every marketplace press was the operator's |
| grant | not the one-liner: *"Seated and ready — I approve issuing a REAL Coupang API key on this account."* |

**Result: a real Open API key now exists on the operator's live Coupang account.** The account held none
before this run (operator-confirmed), which is why the run was needed at all: phases 2 and 3 both require
issued keys on screen.

Everything the walk logged, reduced to its transitions:

```
12:15:51  aw_coupang_walk_landing          {"urlCategory":"wing_host"}      ← the ONE navigation
12:16:03  aw_coupang_step_armed            {"target":"issue"}
12:16:21  aw_coupang_flow_marker           {"markerId":"stage2.purpose.operator_verbatim","visibleCount":1}
12:16:22  aw_coupang_step_armed            {"target":"confirm_purpose"}
12:16:23  aw_coupang_flow_marker           {"markerId":"stage3.terms.heading","visibleCount":1}
12:16:23  aw_coupang_step_armed            {"target":"terms_consent"}
12:16:26  aw_coupang_step_armed            {"target":"issue_final"}
12:16:27  aw_coupang_step_armed            {"target":"vendor_method"}
12:16:28  aw_coupang_step_ring_retired     {"reason":"SELLER_DID_WHAT_IT_POINTED_AT"}
12:16:34  aw_coupang_vendor_form_field     {"fieldId":"stage2.call_ip.ip_addr","ready":true,"buttonCount":2}
12:16:35  aw_coupang_step_armed            {"target":"vendor_confirm"}      ← the key-issuing 확인, ringed
12:16:35  aw_coupang_marker_occlusion      {"markerId":"…access_key","verdict":"NOT_VISIBLE"}
12:16:37  aw_coupang_marker_occlusion      {"markerId":"…access_key","verdict":"COVERED"}
12:16:40  aw_coupang_credential_region     {"visibleCount":1,"observedTag":"TH",
                                            "ancestorChain":"TR>THEAD>TABLE>DIV>DIV>DIV",
                                            "association":"NONE"}
12:16:40  aw_coupang_step_armed            {"target":"credentials"}         ← the keys are on screen
12:17:24  aw_coupang_returned_to_sellerops {"opened":true,"surface":"DEFAULT_BROWSER"}
```

| claim | evidence |
|---|---|
| agent navigations | **1** — the landing at window open, and never again |
| agent clicks / inputs / submits | **0** |
| agent credential-value reads | **0** |
| the key-issuing press | the OPERATOR's; the agent ringed `확인` and stopped |
| the WING window after the return | **not closed** — no `walk_surface_closed`; the return opened the seller's own default browser instead |

### Two guards fired live for the first time, and both were load-bearing

**`COVERED` at 12:16:37.** WING's own `발급 완료` dialog painted over the credential label between the
press and the keys becoming readable. That is precisely the 2026-08-12 defect the occlusion gate was
built for: without it the step completes over keys the seller cannot see. The step waited three seconds
and advanced only once the marker was visible AND unoccluded.

**`buttonCount 1 → 2` at 12:16:34.** The registered-IP chip — the signal that replaced the refuted
`entryRowCount` rule, and the reason the `buttonCount > 1` absolute was replaced by a comparison against
an arm-time baseline. First live firing of both corrections.

### What this run also MEASURED, incidentally

`aw_coupang_credential_region` reported `association: "NONE"` on the `Access Key` `<th>`. The vendor-form
census's association vocabulary includes `TH_NEXT_TD` — a `<th>` naming the `<td>` beside it — and it did
not resolve. So **there is no value cell beside the label**, which is consistent with the column-headed
shape (`TR > THEAD > TABLE`) and with `TH_COLUMN_TD` being the candidate association.

This is corroboration, not the calibration. It says where the value is NOT; phase 2 has to say where it
IS, and the handoff stays refused until it does.

---

## Two UX defects found by the operator during phase 1

Both are **blockers for merging PR #443** (product-owner decision, 2026-08-13). Neither is a safety
failure and neither changes what the run did; both are the guidance pointing at or returning to the
wrong thing.

### D1 — step ⑧'s ring encloses the vendor 연동 정보 block

The panel says *"표시된 Access Key / Secret Key / 업체코드를 직접 복사하세요"* while the ring encloses
`연동 정보수정` with 업체명 / IP주소 / URL and their values.

This is the `tagAncestor: "table"` anchor, and this run's own log explains it: the anchor chain is
`TR > THEAD > TABLE`, and WING puts the 연동 정보 block inside that **same** `<table>`.
`WING_CREDENTIAL_REGION_EVIDENCE` measured exactly this on 2026-08-13 (`containCount: 2, excludeCount: 2`
at `TABLE`) and kept the anchor deliberately, on the grounds that `thead`/`tr` would ring three column
headings with the values outside. The live screen says that trade was wrong: a ring that reaches the
seller's own business details while the copy names the keys is pointing at the wrong thing.

**Fix rule, from the operator:** narrow to a region holding **only** 업체코드 / Access Key / Secret Key
and their values. **If the phase-2 measurement finds no such region, do not pick an anchor — leave it a
blocker.** Guessing at a region here is the mistake this workstream has already withdrawn twice.

### D2 — `SellerOps로 돌아가기` opens a fresh `/connect/coupang` at the START state

The tab the seller came from was already correct — `Open API 키 발급 완료` →
`SellerOps로 돌아가 연결 정보 입력하기`. The return opened a **new** tab at
`쿠팡 연결 안내 시작` / `이미 키가 있어요`, i.e. the beginning of the flow, because the URL carries no run
or issuance context and the page resolves its phase from scratch.

**Fix rule, from the operator:** the return must land on the credential-entry / handoff state of the
EXISTING run, not start a new flow. The WING window stays open and untouched either way.

---

### Backlog — copy-friendly connection details (deployment polish, not a blocker)

The vendor form asks the seller for three things SellerOps already knows: 업체명, the SellerOps URL, and the
fixed API-call IP. On 2026-08-13 the operator typed `http://localhost:5173/connect` into WING's URL field,
which is a development origin on a live marketplace record.

- **one source**: backend/config owns all three; the FE renders them and never re-types them
- **copy per field, and copy-all**
- **`localhost` must be unreachable in production** — a build that could show a loopback origin here is the
  defect, not the copy that displayed it

Not in this unit and not a merge blocker. Recorded here because the live run is where it surfaced.

## Phase 2 — cell calibration

### Sitting 1 — REFUSED (`CELL_NOT_UNIQUE`), 2026-08-13

`apr-18727aabc978` / `wt-a6648aaa792c` / `8284ae2e`. Grant `GRANTED` 12:27:03; checkpoint confirmed
12:28:06 with `provenance: OPERATOR_UI_CONFIRMED`. Surface classified `open_api_issuance`. **Exit 5** —
measured, and the cells did not resolve.

| label | visible | tag | association | candidates | cellTag | inputs | table | nonEmpty |
|---|---|---|---|---|---|---|---|---|
| 업체코드 | 1 | `TH` | `TH_COLUMN_TD` | **2** | — | — | — | — |
| Access Key | 1 | `TH` | `TH_COLUMN_TD` | 1 | `TD` | 0 | 1 | true |
| Secret Key | 1 | `TH` | `TH_COLUMN_TD` | 1 | `TD` | 0 | 1 | true |

**Established.** The shape is column-headed, for all three — `TH_COLUMN_TD` fired and `TH_NEXT_TD` did not,
corroborating the walk's own `association: "NONE"`. The value cells are plain `TD` holding TEXT
(`cellInputCount: 0`), so extraction is `textContent` and not an input value — a real open question, since a
copyable key is as often a readonly input. Access Key and Secret Key resolve uniquely and are non-empty.

**Also established, incidentally and usefully:** this was a fresh window after the operator re-navigated, and
both keys read non-empty — so **WING redisplays the Secret Key on the already-issued screen**. The manual-entry
fallback survives a window close.

**Not established: which of 업체코드's two candidate cells is the value.** Access Key and Secret Key each found
one, so the second row is narrower than the credential row — it covers 업체코드's column index and not theirs.
That is an INFERENCE about the second row's width, and no locator was built on it. The handoff stays refused
(`WING_CREDENTIAL_CELLS_CALIBRATED` is still `false`), and D1 is unanswered because the region was never scored
from the value side.

### Sitting 2 — MEASUREMENT PASS / calibration FAIL-CLOSED, 2026-08-13

`apr-fd6ea58a03e6` / `wt-fa71d221404a` / `e9e06fc1`. Grant `GRANTED` 12:43:33; checkpoint
`OPERATOR_UI_CONFIRMED` 12:43:54; surface `open_api_issuance`. **Exit 5** — and this time the refusal came
with its own explanation.

```
업체코드     column index 1   candidates: row 1 (TBODY, 5 cells)   row 5 (TBODY, 3 cells)
Access Key   column index 3   candidate:  row 1 (TBODY, 5 cells)
Secret Key   column index 4   candidate:  row 1 (TBODY, 5 cells)
credentialState: UNKNOWN (CELL_NOT_UNIQUE on vendor_id)
```

**The collision, measured.** The credential row is row 1, **five columns wide** — 업체코드 at index 1, Access
Key at 3, Secret Key at 4. Row 5 is **three columns wide**: the 연동 정보 block, 업체명 / IP주소 / URL, whose
index 1 is the IP address's value. So 업체코드's column index collides with IP주소's, and the naive column rule
finds both. Without the refusal, **an IP address would have been stored as the vendor code.**

The hypothesis recorded after sitting 1 — "a narrower row covering column 0" — was **wrong in detail**: the
index is 1, not 0. Measuring beat inferring, which is the entire reason the sitting existed.

**The region scope, first time taken:**

```
depth 1  TR      labels 0   values 2   vendor 0     ← the value row: clean of the vendor block
depth 2  TBODY   labels 0   values 2   vendor 2
depth 3  TABLE   labels 3   values 2   vendor 2
depth 4-6 DIV    labels 3   values 2   vendor 2
cleanRingRegion: null
```

No level holds the labels AND the values AND nothing else — the labels are in `THEAD`, the values in `TBODY`.
D1 therefore has no "just narrow the anchor" answer. It does have a **new** fact: depth 1, the value row, is
clean of the vendor block.

### The same-row rule, derived from that measurement

The disambiguator the readings support, and nothing more: **three keys shown together are one record, so they
are one row.** Labels that resolved to exactly one cell on their own are the anchors; if at least two agree on
a row, that is the credential row, and an ambiguous label keeps the candidate inside it — only if exactly one
is.

- no row ordinal is hardcoded — the row is whatever the unambiguous labels resolved to
- no text is read — candidates are chosen by row identity, never by content
- fewer than two anchors, anchors that disagree, or zero/several candidates in the row all fail closed
  (`ROW_NOT_CORROBORATED`, distinct from `CELL_NOT_UNIQUE` so "ambiguous" and "ambiguity survived" stay
  different facts)
- `candidateCellCount` keeps the RAW count: the record says what was seen, not what was chosen

Offline regression reproduces the live collision — 업체코드 at index 1 of a five-column row, the vendor block a
three-column row whose index 1 is an IP — and asserts the naive rule finds two, corroboration resolves to the
credential row, and **the read returns the vendor code and not the IP**. Plus every fail-closed axis, and that
the same shape at different row positions resolves identically (no hardcoded ordinal).

### Sitting 3 — PASS, 2026-08-13

`apr-9a81d1968b2e` / `wt-5286f763e5b0` / `b823db47`. Grant `GRANTED` 12:57:51; checkpoint
`OPERATOR_UI_CONFIRMED` 12:58:17. **Exit 0.**

| label | association | resolved by | row | table | column | non-empty |
|---|---|---|---|---|---|---|
| 업체코드 | `TH_COLUMN_TD` | **`ROW_CORROBORATION`** | 1 | 1 | 1 | yes |
| Access Key | `TH_COLUMN_TD` | `DIRECT` | 1 | 1 | 3 | yes |
| Secret Key | `TH_COLUMN_TD` | `DIRECT` | 1 | 1 | 4 | yes |

`resolved: true` · `refusal: OK` · **`credentialState: KEY_PRESENT`**.

The rule worked on the screen that defeated the naive one. `candidateCellCount: 2` is still on the record as the
raw evidence — 업체코드's column reaches row 1 (five cells) and row 5 (three cells, the 연동 정보 block whose
index 1 is the IP). Corroboration kept row 1 because that is where the two unambiguous labels landed, and the
row was derived from them rather than named.

`credentialState` answered positively for the first time, from the same census that refused twice. **The rule
changed the reading; the account never changed.**

`WING_CREDENTIAL_CELLS_CALIBRATED` is flipped to `true` on this reading and on nothing else, with
`WING_CREDENTIAL_CELL_EVIDENCE` recorded beside it. The APPROVAL GATE still defaults to `false` — a caller who
omits the field gets the refusal — so what changed is what the two CLIs now state, not what the gate assumes.

### D1 — answered, and the answer is still `null`

```
depth 1  TR      labels 0   values 3   vendor 0     ← all three values, zero vendor labels
depth 2  TBODY   labels 0   values 3   vendor 2
depth 3  TABLE   labels 3   values 3   vendor 2     ← today's anchor
```

No level holds the labels AND the values AND nothing else: the labels are in `THEAD`, the values in `TBODY`. So
the `TABLE` ring cannot be narrowed into correctness, which settles it as the thing to remove.

**Product-owner decision, 2026-08-13:** v1 rings the **value row** (depth 1) — the live-measured credential row,
which contains the three values and none of 업체명 / IP주소 / URL. Three-cell multi-highlight goes to the
overlay-extension backlog.

### What sitting 2 measured, and why it is a measurement rather than a rule

Two value-free additions, both declared capabilities:

- **`MEASURE_CREDENTIAL_CELL_STRUCTURE` gains candidate DETAIL** — per label its own column index, and per
  candidate cell the row ordinal, the section tag, and that row's cell count. `candidateCellCount: 2` is a
  refusal that says nothing about why; this says which rows they are and how wide.
- **`MEASURE_CREDENTIAL_REGION_SCOPE`** — for each ancestor level of a credential VALUE cell: how many of the
  three labels are inside, how many resolved value cells are inside, and how many of 업체명 / IP주소 / URL are.
  `WING_CREDENTIAL_REGION_EVIDENCE` recorded that the `tbody` question was unanswerable from the label side
  *because the anchor sits in the `thead`*; this anchors on the value side, which is the side the ring encloses.

Nothing in either reads a value. `chooseCredentialRegion` returns `null` when no level is clean, and `null` is
the answer D1 is allowed to have — the ring stays a blocker rather than being pointed at a chosen anchor.

## `CoupangCredentialState` — added to this PR's direction

An account may already hold a key, and a seller who does must not be walked into issuing another. The state is
determined value-free from the same census: `NO_KEY` / `KEY_PRESENT` / `UNKNOWN`.

The asymmetry is the design. A wrong `KEY_PRESENT` sends someone to a handoff that then refuses — recoverable.
A wrong `NO_KEY` walks them into creating a **second real key on a live account** — not. So `NO_KEY` requires a
POSITIVE reading (cells resolved AND all empty), `KEY_PRESENT` requires cells resolved AND all non-empty, and
everything else — a missing label, an ambiguous column, a mixed shape, a truncated scan, a census taken without
the bit, a partially-filled table — is `UNKNOWN`. `mayStartIssuance` is true only for `NO_KEY` and
`mayOfferHandoff` only for `KEY_PRESENT`, spelled as predicates so `!== "KEY_PRESENT"` cannot creep in and read
`UNKNOWN` as permission.

This is the trap `wingIssuedStateFrom` documented: `credentialAnchorPresent` reads `true` on a confirmed no-key
form, so "something credential-shaped is here" was never "a key exists". What is different is that the census
measures the value CELL and one bit about it — an empty cell is a screen with no key, and that is a reading
rather than an absence.

**On the sitting-1 data this classifier answers `UNKNOWN`** — a key demonstrably exists on that account, and
the honest answer is still `UNKNOWN`, because the reading does not establish it. A test pins exactly that.
