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

## Phase 2 — cell calibration

Pending. Fresh `COUPANG_WING_CREDENTIAL_CELL_CALIBRATION` bootstrap, its own grant, on the key issued in
phase 1 — reusing that live state rather than issuing anything further. No new key, no deletion, no
reissue.
