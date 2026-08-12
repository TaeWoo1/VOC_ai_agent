# Coupang WING key issuance — live E2E, 2026-08-12

The first guided walk that ended with a **real API key on a live Coupang seller account**, and the record of
what that run did and did not establish.

Run identity: `wt-d706105bcaa8` · approval `apr-4e2ba0cb2de9` · git `7a6c3a0a` ·
phase `COUPANG_WING_GUIDED_ISSUANCE_WALK` · agent mode `READ_ONLY`.
Grant: the WRITE-grade line, given in the operator's own words against the displayed manifest.

Agent budget held for the whole run: **0 clicks, 0 inputs, 0 submits, 0 credential-value reads, 1 navigation**
(the landing at window open). Every marketplace action was the operator's.

---

## 1. Grades

The distinction between these grades is the whole point of this document. `LIVE_MEASURED` means a sanitized
runtime reading exists in the agent log. `LIVE_OBSERVED` means it is visible in the operator's own screen
capture. `OPERATOR_REPORTED_NOT_CORROBORATED` means the operator saw it and **the runtime did not record it**.

| claim | grade | evidence |
|---|---|---|
| the vendor screen's `확인` issues a REAL API key | **LIVE_VERIFIED** | WING's own `발급 완료 / API 키를 발급했습니다` dialog, and the key listed in the account's key table |
| ②→③ auto-advance (발급 → purpose screen) | **LIVE_MEASURED** | `stage2.purpose.operator_verbatim` `visibleCount:1` `DIV` @ 05:46:04 |
| ③→④ auto-advance (확인 → terms screen) | **LIVE_MEASURED** | `stage3.terms.heading` `DIV` + `stage3.terms.issue_final` `BUTTON`, both `visibleCount:1` @ 05:46:11 |
| ⑤→⑥ auto-advance (발급받기 → vendor screen) | **LIVE_MEASURED** | `stage4.vendor.partner.label` + `self_dev.label`, `visibleCount:1 hiddenCount:1 LABEL` @ 05:46:16 — byte-identical to the recorded measurement |
| overlay re-mounts after a WING navigation | **LIVE_MEASURED** | `aw_coupang_overlay_remount` retried 05:50:55 → 05:51:57 and then **stopped**; the stop IS the success, and the panel was back on the operator's screen |
| ring re-anchors across a layout change | **LIVE_OBSERVED** | after `자체개발(직접입력)` revealed the URL/IP rows, the `7/9` chip and ring sat on the vendor `확인` |
| the guidance panel vacates the control it describes | **LIVE_OBSERVED** | panel moved to the top of the viewport when the vendor `확인` was underneath it |
| **⑦→⑧ auto-advance on the credential appearing** | **OPERATOR_REPORTED_NOT_CORROBORATED** | see §2 |

### The key that was created

A real key exists on the operator's live account. WING's dialog also disclosed two facts nothing here had
recorded before: **keys carry an expiry** (`유효기간 이후 키를 재발급해주세요`) and **re-issuing changes the
secret key** (`재발급 시 시크릿키가 변경됩니다`). Neither is acted on by this unit.

**`되돌릴 수 없습니다` was withdrawn from every manifest and on-page string before this run** — WING has a 삭제
control, the operator has used it, and the disclosure that binds a grant must not carry a claim the reader can
personally falsify. See `coupang_wing_vendor_method_epistemic_audit_v1.md` §3.

---

## 2. Why ⑦→⑧ is NOT graded as measured

The operator reported that after pressing the vendor `확인`, the panel moved to `8/9` by itself. The runtime
does not corroborate it, and the temptation to record a plausible report as a measurement is exactly what this
workstream has already paid for twice (the `약관 동의 및 Key 발급받기` claim, and the withdrawn 발급 selector).

What the log holds:

```
05:52:14.581   issuance.credentials.access_key   visibleCount: 0, hiddenCount: 1   ← last line of any kind
05:52:14 → 05:58:34   nothing. The loop had been emitting ~2 lines/second.
05:58:34.013   warn aw_coupang_issuance_drive_error {"reason":"Error"}
06:07:42       surface closed
```

**No reading of `issuance.credentials.access_key` with `visibleCount >= 1` exists anywhere in the log.** The
observation that was supposed to fire has no trace of having fired.

A second reading fits the evidence better than auto-advance did. The operator's 05:55 screen capture still
showed the panel at step ⑦ — three minutes after the runtime went silent — which means the panel on screen was
**frozen**, mounted at 05:51:58 and never updated. The step ⑧ overlay appeared only after the operator had
re-authenticated and the engine was driven again, on a page that **already had the credentials on it**. Reaching
⑧ by re-probing a page where the key already exists is a different thing from observing the transition, and
only the second one is what `WING_CREDENTIAL_SHOWN_MARKER_SPEC` claims to do.

So the credential-marker advance remains **unproven in the live path**. It is not refuted either: the run never
put it in a position to answer.

---

## 3. New defect found by this run

**The drive loop stopped and stayed stopped.** Between 05:52:14 and 05:58:34 the runtime polled nothing, logged
nothing, and surfaced no blocker; the operator was left with a guidance panel that looked live and was not. The
error arrived six minutes after the loop went quiet, which means nothing was watching the watcher.

This bounds the value of everything else in §1: an auto-advance that cannot run is indistinguishable from one
that is wrong, and a frozen panel is worse than an absent one because it still reads as guidance.

---

## 4. Recorded, not fixed

Every item below was live-observed on this run and is deliberately out of this unit's scope.

| defect | what it costs |
|---|---|
| the WING window renders cropped with scrollbars | **blocks progress.** The vendor `확인` was unreachable without zooming the page out — a workaround the product cannot ask a seller to perform |
| the guidance panel only avoids targets currently IN the viewport | a target below the fold is not "covered", so the panel parks exactly where that control arrives when the seller scrolls to it |
| the ⑧ ring lands on the credential table's HEADER row | the `Access Key` label lives in the header, so `tagAncestor: "tr"` resolves the header rather than the row holding the values |
| `SellerOps로 돌아가기` performs no navigation | the WING window and the SellerOps tab are separate windows; the button records a step completion while its label promises a move |
| closing the WING window mid-walk does not resume | the run's surface is gone and step state does not carry across a restart |
| **WING appears to drop the session after ~5–6 minutes idle** | measured twice this run (05:45:30 → 05:50:56, then again ~05:57). SellerOps sends WING no HTTP traffic while guiding — it only reads the DOM — so the seller looks idle to WING for the whole walk. This is a structural problem for the Action Window pattern on this channel, not a bug in the walk |

The session-timeout observation is **two data points and a mechanism**, not a measurement of a timeout value.
It reframes but does not overturn the earlier suspicion that the vendor `확인` itself drops the session: both
drops followed the longest stationary stretch of the walk, which is also where `확인` sits.
