# Goal — Action Window Runtime

Referenced canonical intent: [`../product-scope-v1.md`](../product-scope-v1.md),
[`../slices/action-window-v1.md`](../slices/action-window-v1.md). This document
records the Runtime's execution goal only; it does not redefine product intent.

## 1. SellerOps identity

SellerOps is an **SME multi-channel sales-operations agent** — not a selling
tool, not a scraper, not a data collector. The unified seller-center is the
surface; the operating loop is the engine. Review acquisition is **one step** of
that loop, not the product.

## 2. Canonical operating loop

```
observe → acquire → normalize → understand → prioritize → execute
        → request human action → observe completion → resume downstream execution
```

(See `../product-scope-v1.md` §1.2.) The **autonomy metric is operational work
removed end-to-end** — navigation time, file discovery, cross-channel checking,
dedup/product-linking effort, issue-discovery time — **never click count**.

## 3. Runtime's role in the loop

The Runtime owns the **acquire → observe-completion** span for the Action Window
model, plus the mechanical handoff into downstream `normalize`:

- prepare a valid session on the correct surface (**acquire** precondition)
- open the real Chrome window, locate + spotlight the one real control
- **wait for the user's real click** (the policy-sensitive platform action)
- observe and **verify** the expected state transition
- detect the resulting download / artifact
- hand the verified artifact to existing downstream ingestion (**normalize** on)

The Runtime never performs the policy-sensitive action itself and never turns one
user request into a hidden chain of platform clicks.

## 4. Action Window user-direct-click boundary

- The **user** clicks actual platform elements (login, 2FA, account/scope
  selection, marketplace selection, export/download).
- The Runtime may perform at most **one signature-gated, user-consented click**
  where the slice contract explicitly allows it; otherwise it only spotlights and
  observes.
- Ambiguous, missing, or changed targets **fail closed** — zero clicks, a
  blocker code, and manual-progress remains available.
- No automatic marketplace selection and no automatic export click in default
  production. See `../slices/action-window-v1.md` §2, §6, §8.

## 5. One-month objective

Prove the **Action Window + Operation Run loop end-to-end on synthetic fixtures
for exactly one channel**, and keep the branches reconciling — so the only thing
between us and the first real pilot is platform-policy clarification and PO
approval. Stay **one channel, one loop, synthetic-first**. Do not expand to a
second channel, live capture, Projection wiring, auto-relogin, or scheduling this
month.

## 6. Runtime V1 — definition of done

A single synthetic run demonstrates the full loop:

1. open a synthetic Chrome fixture
2. locate one real fixture target
3. render a spotlight / step overlay
4. wait for an **actual user click**
5. observe a state transition
6. verify the **expected** transition
7. execute **one dummy** automatic downstream task
8. emit **sanitized** Bridge events
9. complete the run
10. **fail closed** for missing, ambiguous, or changed targets

V1 is done when all ten hold against synthetic fixtures with passing tests and no
prohibited payloads leaving the Runtime.

## 7. Non-goals (explicitly out for V1)

- live marketplace / live commerce action
- automatic marketplace selection
- automatic export clicking
- real ingestion volume
- Browser Projection production wiring
- scheduled execution
- backend Operation Run persistence **in the first slice** (arrives at R3)

## 8. Related

- Component responsibilities and the synthetic state flow → [`architecture.md`](architecture.md)
- Slice sequencing → [`implementation-plan.md`](implementation-plan.md)
- Durable decisions → [`decisions.md`](decisions.md)
