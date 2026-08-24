# GET /api/v2/admin/boards/{board_no}/articles — 게시글 목록 조회 (+ 게시글 속성)

> **Vendor copy.** Transcribed from the official Cafe24 Developers Admin API reference
> (`https://developers.cafe24.com/docs/en/api/admin/`, resource *Boards articles*), retrieved
> **2026-08-25**. This file records what the PLATFORM publishes. SellerOps conclusions live in
> `docs/inquiry_action_flow_v1.md`, `InquiryReplyCapabilityRegistry`, and
> `docs/exact_operational_context_v1.md`.

## Endpoints

| Method / path | SCOPE | Request Limit |
|---|---|---|
| `GET /api/v2/admin/boards/{board_no}/articles` | `mall.read_community` | 40 |
| `GET /api/v2/admin/boards/{board_no}/articles/{article_no}` | `mall.read_community` | 40 |
| `POST /api/v2/admin/boards/{board_no}/articles` | `mall.write_community` | 40 (10 objects/call) |
| `PUT /api/v2/admin/boards/{board_no}/articles/{article_no}` | `mall.write_community` | 40 (1 object/call) |
| `DELETE /api/v2/admin/boards/{board_no}/articles/{article_no}` | `mall.write_community` | 40 |

Both GETs are documented "This API can only be used in stores using Korean or Japanese."

## Article properties relevant to inquiry operations

| Attribute | Description (verbatim) |
|---|---|
| `order_id` | Order ID |
| `reply` | whether replied for 1:1 query — `T`: Use, `F`: Do not use |
| `reply_user_id` | manager ID of which processing or completed answer |
| `reply_status` | status of replay — `N` : before answer, `P` : processing, `C` : completed answer |
| `reply_sequence` | order of replied posts |
| `reply_depth` | answer depth |
| `reply_mail` | whether replied by mail for 1:1 query |
| `input_channel` | posting path — `P` PC / `M` mobile |
| `naverpay_review_id` | review ID of Naver Pay |
| `deleted` | `T` Deleted / `F` Not deleted / `B` Before upload (pending admin approval) |

## LIST request parameters

`shop_no` (DEFAULT 1) · `board_no` **Required** · `article_no` (comma-separated) ·
`board_category_no` · `start_date` / `end_date` (creation date; **"Search duration cannot exceed one
year per call"**) · `input_channel` · `search` (`subject` / `content` / `writer_name` / `product` /
`member_id`) · `keyword` · `reply_status` (`N`: Unanswered, `P`: Answer) · `comment` (`T`/`F`) ·
`attached_file` · `article_type` · `product_no` · `has_product` · `is_notice` · `is_display` ·
`supplier_id` · `offset` (Max 8000) · `limit` (1–100, DEFAULT 10).

**`order_id` is not a list filter.** It is a response property only — the article names its order,
but articles cannot be found by order.

## Write-side: which endpoint may set the answered state

| Field | `POST` (create) | `PUT` (update) |
|---|:--:|:--:|
| `reply` | accepted | **absent** |
| `reply_user_id` (Max Length 20) | accepted | **absent** |
| `reply_status` | accepted | **absent** |
| `order_id` (Max Length 32) | accepted | **absent** |
| `title`, `content`, `rating`, `display`, `notice`, `fixed`, attachments | accepted | accepted |

`PUT`'s full accepted parameter list is: `shop_no`, `board_no`, `article_no`, `title`, `content`,
`rating`, `sales_channel`, `board_category_no`, `display`, `notice`, `fixed`,
`display_time_start_hour`, `display_time_end_hour`, `attach_file_url1`–`5`.

## What this means for the Cafe24 reply capability audit (record only)

Recorded here because the previous audit's blocker was stated imprecisely, and the correction is
sharper than the original:

1. **`reply_status` is settable only at article CREATION.** The update endpoint does not accept it.
   So there is no contracted way to mark an *existing* 문의사항 article answered by editing it.
2. Therefore the only candidate write path remains
   `POST /articles/{article_no}/comments` (`mall.write_community`,
   `docs/vendor/cafe24-admin-api/post-boards-articles-comments.md`), and **the reference still does
   not state that adding a comment changes `reply_status`** — which is SellerOps's only ANSWERED
   signal for Cafe24 (`Cafe24InquiryArticleMapper`).
3. The comment POST's `writer` and `password` are both **Required** and neither exists anywhere in
   SellerOps's stored Cafe24 connection.

Blockers (1)–(3) are unchanged in kind by this retrieval. They belong to a later Action package;
nothing in this package implements a Cafe24 comment WRITE adapter.
