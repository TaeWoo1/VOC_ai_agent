# Brand-20 manual mapping review — operator guide

Companion to `configs/review_ops_brand20_manual_mapping_review.csv`.

## 1. Why this worksheet exists

The current Brand-20 seed (`configs/review_ops_brand20_seed.csv`,
`..._goods_validation.csv`, `..._collection_queue.csv`) was built by
mapping a 20-row OliveYoung URL list the user supplied onto the
existing 20 seed brand/product rows **by row index**.

That row-order assumption was never explicitly confirmed by the user.
A read-only CDP probe of all 20 URLs against OY's `og:title` showed
that 4 of the 20 rows did not match the seed row they were
sitting in. The operator subsequently confirmed that **the actual OY
products at those four URLs are the intended Brand-20 candidates**,
not the prior seed brand/products. The seed CSVs have therefore
been updated to reflect the operator-confirmed products:

| seed rank | prior seed (now retired) | operator-confirmed actual product |
|---|---|---|
| 9  | Espoir 프로 테일러 비벨벳 커버 쿠션 | **Tocobo 비타 톤업 선크림** (sunscreen) |
| 10 | Abib 어성초 스팟 패드 카밍 터치    | **Ilso 슈퍼 멜팅 세범 소프트너** (pore_care) |
| 12 | Mediheal 마데카소사이드 흔적 패드   | **Mediheal 마데카소사이드 흔적 리페어 더마크림** (skincare_cream) |
| 16 | rom&nd 쥬시 래스팅 틴트          | **Espoir 꾸뛰르 립틴트 글레이즈** (lip_makeup) |

These four are **seed replacements**, not "wrong goodsNo". The URLs
were never wrong; the prior seed brand/product names were placeholder
slots that the operator has now filled with the intended products.
The `prior_seed=` field in each row's `notes` preserves the audit
trail. The `verified_by_user_current_oy_page` provenance tag was
removed from these rows because the brand/product changed; it
remains on the other 16 rows where the original mapping held.

## 2. The row-order assumption error (resolved)

The user supplied 20 rows of `(goodsNo, public_review_count)`. They
were inserted into the existing 20 seed rows as
`user_row[i] → seed_row[i]`. No semantic check linked the supplied
URL to the seed brand/product at that index. As a result:

- All 20 supplied URLs were technically `confirmed_by_order_only` at
  intake time.
- The CDP probe later promoted 16 rows to
  `actual_title_matches_seed`.
- The other 4 (#9, #10, #12, #16) were flagged
  `row_order_mapping_mismatch`. After operator review they were
  reclassified as `operator_confirmed_seed_replacement` — the URLs
  point to the products the operator wants in the Brand-20 set; the
  prior seed brand/product names were retired.

The lesson stays on the record even though this round resolved
cleanly: **never silently align a user-supplied list to an existing
indexed list without an explicit semantic check.** The CDP probe is
the lightweight check that should run on every new URL list, and
the manual mapping worksheet is the artifact that captures any
disagreement before configs are mutated.

## 3. How to fill `operator_action`

Choose one value per row. The 16 `actual_title_matches_seed` rows
are pre-filled with `keep_current_mapping`; do not change unless you
disagree with the auto-decision.

The 4 `row_order_mapping_mismatch` rows are pre-filled with
`needs_operator_mapping`. Change to one of:

- **`keep_current_mapping`** — accept the row as-is. (Use only if you
  meant for this URL/seed pair, e.g. an intentional replacement.)
- **`remap_to_seed_rank`** — the URL is correct, but it belongs in a
  different existing seed slot. Set `operator_target_seed_rank` to
  the destination row.
- **`replace_seed_product`** — the URL is correct, and the brand/product
  in the seed slot should be replaced with what's actually at the URL
  (e.g. retire "Mediheal pad" and adopt "Mediheal cream" instead).
  Add a short rationale in `operator_notes`.
- **`drop_candidate`** — the URL is wrong and should not be in the
  Brand-20 set. The original seed product at that rank still applies
  but needs a fresh goodsNo lookup. Add the brand to lookup in
  `operator_notes`.
- **`needs_lookup`** — leave the URL aside; the original seed row's
  intended product needs an OY search before any decision can be
  made. Add what to search for in `operator_notes`.

## 4. How to fill `operator_target_seed_rank`

- For `keep_current_mapping` and `replace_seed_product`: leave equal
  to `current_seed_rank` (already pre-filled for keep rows; fill in
  for replace rows).
- For `remap_to_seed_rank`: set to the target rank (1–20).
- For `drop_candidate` and `needs_lookup`: leave blank. The slot will
  be regenerated from the operator's notes during the next config
  rebuild.

If the same `operator_target_seed_rank` ends up assigned twice
(two URLs both claiming, say, rank 9), the conflict has to be
resolved before the seed CSV can be rebuilt. The rebuild step will
fail loudly rather than silently picking one.

## 5. What happens after the worksheet is filled

Once the operator commits this CSV:

1. A rebuild script (to be written; not yet present) reads
   `configs/review_ops_brand20_manual_mapping_review.csv`, validates
   that every `operator_target_seed_rank` is unique and that every
   row's `operator_action` is decided, then rewrites:
   - `configs/review_ops_brand20_seed.csv`
   - `configs/review_ops_brand20_goods_validation.csv`
   - `configs/review_ops_brand20_collection_queue.csv`
2. Rows marked `drop_candidate` or `needs_lookup` are written to the
   seed CSV with the original brand/product name preserved but
   `goods_no` blanked and a new `validation_status=needs_goods_no`.
   These rows must be resolved before the next batch run.
3. Rows marked `replace_seed_product` overwrite the seed brand and
   product name with `actual_brand_guess` and a normalized form of
   `actual_oy_title` (operator should sanity-check the rewritten name).
4. The `verified_by_user_current_oy_page` provenance tag is removed
   from any row whose mapping changed; only rows the operator
   explicitly retained as `keep_current_mapping` keep that tag.
5. After the rebuild, run the CDP probe again on the new seed to
   confirm 20/20 `actual_title_matches_seed` before any further
   smoke or batch.

The rebuild script and the second-pass probe are both deferred — they
will be written when the worksheet returns filled. Until then, none
of the three Brand-20 CSVs is modified.

## 6. Wording discipline

When discussing the 4 mismatched rows, do **not** call them "wrong
goodsNo" unless the operator has explicitly marked the row's intent
that way. The CDP probe only proves the supplied URL does not match
the seed name in the slot it currently occupies — it does not prove
the URL itself is incorrect, nor that the operator did not intend
to swap that seed row's product. Use:

- "row-order mapping mismatch" — what the probe found.
- "operator-confirmed wrong goodsNo" — only after the worksheet
  marks the row as `drop_candidate` or `needs_lookup`.
- "operator-confirmed seed replacement" — only after the worksheet
  marks the row as `replace_seed_product`. **This is what happened
  for rows 9, 10, 12, 16 in this round.**

These distinctions matter because the recovery path is different
in each case: a wrong goodsNo needs a fresh OY lookup, a seed
replacement needs a name update with no new lookup, and a remap
just shuffles existing rows. The current Brand-20 CSV state
reflects four `replace_seed_product` decisions; no rows are
currently in `drop_candidate` or `needs_lookup` state.
