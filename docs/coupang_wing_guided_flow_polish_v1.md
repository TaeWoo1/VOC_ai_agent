# Coupang WING guided flow polish — live walk, 2026-08-13

The unit that made step ⑥ complete itself and kept the guidance panel off the controls the seller reaches next,
and the record of the live walk that graded both.

Run identity: `wt-52fff03714a2` · approval `apr-5794c27b7d86` · git `17e1b70f` ·
phase `COUPANG_WING_GUIDED_ISSUANCE_WALK` · agent mode `READ_ONLY`.
Grant: the WRITE-grade line, given in the operator's own words against the displayed manifest.

**No key was created.** The operator pressed the vendor screen's `확인`, WING bounced the session to its
password screen, and after re-authenticating the page was back at `API Key 발급 받기` with no new key in the
account (operator-reported). Live account state is unchanged by this run.

---

## 1. Grades

`LIVE_MEASURED` = a sanitized reading exists in the agent log. `LIVE_OBSERVED` = the operator saw it on their
own screen. `NOT_REACHED` = the run never got to the state that would have produced the evidence.

| claim | grade | evidence |
|---|---|---|
| the panel keeps clear of the vendor `확인` and the form inputs | **LIVE_OBSERVED** | operator: "패널은 타이틀을 좀 가리긴 하는데 버튼이나 입력란은 안가려" — the 2026-08-12 blocker, closed |
| the vendor-form census resolves on the live screen | **LIVE_MEASURED** | all three fields `resolved:true` within 4s of the step arming |
| 업체명 / URL read `ready:true` from a live screen | **LIVE_MEASURED** | first time any apparatus has read this — `17:42:14` and `17:42:15` |
| the repeating readings are sampled, not repeated | **LIVE_MEASURED** | `repeat:30`, `repeat:60`, `repeat:90` on the vendor-field and re-anchor lines |
| the form gate refuses exactly ONCE | **LIVE_MEASURED** | one `aw_coupang_vendor_form_not_ready` at `17:45:35`; the second press advanced at `17:45:39` |
| **the re-anchor fence refuses a wrong PAGE** | **LIVE_MEASURED** | `aw_coupang_reanchor_off_page {"pageCategory":"login"}` + `guidance_suspended` — the same WING bounce that on 2026-08-12 put the key-issuance ring on a password submit |
| **the re-anchor fence refuses a wrong SCREEN** | **LIVE_MEASURED** | `aw_coupang_reanchor_off_screen {"expected":"VENDOR_METHOD","observed":"UNRECOGNIZED"}` |
| the bounded park stops the silent retry | **LIVE_MEASURED** | `aw_coupang_guidance_lost {"polls":60}` — twice, and see §3 |
| **⑥ auto-advances when the form reads ready** | **REFUTED — the rule was wrong; fixed from a measurement** | see §2, and §2a for what replaced it |
| ⑦→⑧ auto-advance on the credentials appearing | **NOT_REACHED** | third consecutive walk; WING bounced the session before any credential could paint |

---

## 2. Why ⑥ did not auto-advance: WING registers an IP as a CHIP

The readiness census read 업체명 and URL as ready and `IP 주소` as not-ready, steadily, for ninety seconds:

```
17:42:14  aw_coupang_vendor_form_field {"fieldId":"stage2.vendor_info.baseline","resolved":true,"ready":true}
17:42:15  aw_coupang_vendor_form_field {"fieldId":"stage2.vendor_url.url","resolved":true,"ready":true}
17:43:07  aw_coupang_vendor_form_field {"fieldId":"stage2.call_ip.ip_addr","resolved":true,"ready":false,"repeat":60}
```

The operator's screen showed the address registered — as a removable chip, `211.222.138.6 ×`, above the input
and its `추가` button, exactly as WING's own hint describes ("등록한 IP 주소는 [x] 버튼으로 삭제할 수 있습니다").

`entryRowCount` counts painting `li` / `tr` / `option` in the region. A chip is none of those, so the count is
zero however many addresses are registered, and `READY` was unreachable on this surface.

At the time, the rule was NOT changed: nothing had read what a registered entry does to that region, and
guessing at it — `span`, or "two buttons instead of one" — is the move this workstream has twice had to
withdraw. Instead the census began LOGGING the structure it was already computing (`regionTag`, `inputCount`,
`textInputCount`, `buttonCount`, `entryRowCount`), and a separate READ_ONLY sitting was run to record the
region in both states. §2a is that reading.

---

## 2a. What a registered entry actually is — MEASURED 2026-08-13

Run identity: `wt-017b33239e33` · approval `apr-181b4bd2cebf` · git `b95c908f` ·
phase `COUPANG_WING_VENDOR_METHOD_DISCOVERY` · mode `READ_ONLY` · 7/7 checkpoints, every one
`OPERATOR_UI_CONFIRMED`. No key issued; the vendor `확인` was never pressed.

The `API 호출 IP` region, before the operator pressed `추가` and after:

| signal | before | after |
|---|---|---|
| `entryRowCount` | 0 | **0** |
| `buttonCount` | 1 | **2** |
| `BUTTON` | 1 | **2** |
| `DIV` | 2 | **3** |
| `SPAN` | 4 | **6** |
| `INPUT` | 1 | 1 |
| `STRONG` | 2 | 2 |

**A registered address is a `div` chip carrying its own remove `button`.** The row count reads zero on both
sides — so the old rule could not have fired on any number of registered addresses. The region gains a button
per registered entry.

Two controls on the reading: `entryRowCount` was measured on both sides rather than assumed, and the 업체명 and
URL regions were **byte-identical** across the pair while the operator typed into both — so the signal is
specific to REGISTRATION, not to typing.

**The comparison is against a before-picture, not against the number 1.** The first rule written from this
table asked `buttonCount > 1`, which is n=1 talking: one sitting, one screen. A WING variant carrying two
controls in that region before anything is registered would satisfy it on arrival, and what step ⑥ hands to is
a ring on `확인` — the control that issues the key. So the walk measures the region when the step arms
(`VendorIpBaseline`, the same construction as the screen / category / credential baselines beside it) and claims
only the DIFFERENCE, which is what was actually observed. The baseline is cleared the moment the form stops
resolving, so a seller who returns to a fresh form is measured against that one.

The rule lives in `vendorIpEntryRegistered` (`collector/src/action-window/coupang-wing-field-region.ts`), which
keeps `entryRowCount >= 1` as a baseline-free alternative rather than a replacement. Every half fails closed: no
baseline is not a registration, no count is not a registration, equal counts are not a registration.

**What it costs, named rather than discovered live:** a walk re-anchoring on a form the seller ALREADY completed
baselines on the chip that is already there, so step ⑥ does not complete itself. The seller's own panel button
is on screen throughout and the form gate refuses exactly one press before yielding — so that case is two
presses, never an unreachable key. A missed auto-advance is recoverable by the seller; a premature ring on `확인`
is not.

**The offline fixture was wrong in the same way the rule was.** It modelled the registration as a row
appearing, which is why sixteen tests passed while the live walk sat at NOT_READY. It now models the measured
shape.

---

## 3. What the run found that the unit did not set out to find

1. **The bounded park re-arms rather than becoming a visible blocker.** `guidance_lost` fired at 60 polls, the
   session re-armed the step, the fence suspended it again, and the cycle repeated every ~60s. Each turn is
   logged, so it is not the silent spin the bound was added for — but the seller sees no ring and no message
   saying why. The step's `다시 확인` remains available. **Not fixed here; recorded.**
2. **The ⑥ ring outlived its own instruction.** Reported by the operator mid-run: once the input method is
   chosen the ring keeps pointing at the radio while the work is in the fields below it. Fixed in this unit —
   the ring is retired when the form paints, and the panel carries the rest of the step.
3. **The panel covers the modal's TITLE.** Cosmetic; the operator confirmed no control is covered. Backlog.

---

## 4. What the walk cost the account

Nothing. 0 clicks, 0 inputs, 0 submits, 0 credential-value reads and 1 navigation by the agent (the landing).
Every marketplace action was the operator's, and the one that would have created a credential was swallowed by
WING's own session bounce.
