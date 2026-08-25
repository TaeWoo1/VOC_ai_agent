# Boards articles — 게시글 목록 조회 · 등록 · 수정 (공식 계약 사본)

> **Vendor copy.** Transcribed from the official Cafe24 Developers Admin API reference
> (`https://developers.cafe24.com/docs/en/api/admin/`, resource *Boards articles*), first retrieved
> **2026-08-25**, **re-retrieved and corrected the same day** against both the English and the
> Korean (`.../docs/ko/api/admin/`) editions. This file records what the PLATFORM publishes.
> SellerOps conclusions live in `docs/inquiry_action_flow_v1.md`,
> `docs/inquiry_answer_execution_v1.md`, and `InquiryReplyCapabilityRegistry`.

## Corrections made at the 2026-08-25 re-retrieval

Recorded rather than silently fixed, because both errors were load-bearing for a conclusion this
repository published:

1. **There is no single-article `GET`.** The first transcription listed
   `GET /api/v2/admin/boards/{board_no}/articles/{article_no}` as an endpoint. The reference's
   *Endpoints* block lists exactly four: `GET` (list), `POST`, `PUT`, `DELETE` — and there is no
   "Retrieve a board post" (singular) section anywhere in the document. One article is read through
   the LIST's `article_no` filter, which accepts a comma-separated set.
2. **`POST` accepts `reply_article_no`** — "replied post number. *If you want to add an reply to a
   post, enter the number of the post.*" The first transcription of the write-side table omitted it,
   and its omission is the whole reason this repository concluded that no contracted answer path
   existed for an existing article. See *What this means* below.

## Endpoints

| Method / path | SCOPE | Request Limit | objects/call |
|---|---|---|---|
| `GET /api/v2/admin/boards/{board_no}/articles` | `mall.read_community` | 40 | — |
| `POST /api/v2/admin/boards/{board_no}/articles` | `mall.write_community` | 40 | 10 |
| `PUT /api/v2/admin/boards/{board_no}/articles/{article_no}` | `mall.write_community` | 40 | 1 |
| `DELETE /api/v2/admin/boards/{board_no}/articles/{article_no}` | `mall.write_community` | 40 | — |

All four are documented "This API can only be used in stores using Korean or Japanese."

## Article properties relevant to inquiry operations

| Attribute | Description (verbatim) |
|---|---|
| `article_no` | posts number (Max 2147483647) |
| `parent_article_no` | **posts number of parent posts** |
| `reply_sequence` | order of replied posts |
| `reply_depth` | answer depth |
| `order_id` | Order ID |
| `reply` | whether replied for 1:1 query — `T`: Use, `F`: Do not use |
| `reply_user_id` | manager ID of which processing or completed answer |
| `reply_status` | status of replay — `N` : before answer, `P` : processing, `C` : completed answer |
| `reply_mail` | whether replied by mail for 1:1 query — `Y` used / `N` do not used |
| `input_channel` | posting path — `P` PC / `M` mobile |
| `naverpay_review_id` | review ID of Naver Pay |
| `deleted` | `T` Deleted / `F` Not deleted / `B` Before upload (pending admin approval) |
| `secret` | whether secret posts — `T` Use / `F` Do not use |

**`parent_article_no` + `reply_sequence` + `reply_depth` are three separate fields describing one
structure: on a Cafe24 board an ANSWER can itself be an ARTICLE, hanging off the question.** No
field in this property list holds an answer's text, because in that structure the answer's text is
the child article's own `content`.

## LIST request parameters

`shop_no` (DEFAULT 1) · `board_no` **Required** · `article_no` (Min 1, **"You can search multiple
item with ,(comma)"**) · `board_category_no` · `start_date` / `end_date` (creation date; **"Search
duration cannot exceed one year per call"**) · `input_channel` · `search` (`subject` / `content` /
`writer_name` / `product` / `member_id`) · `keyword` · `reply_status` · `comment` (`T`/`F`) ·
`attached_file` (`T`/`F`) · `article_type` (`all` / `normal` / `notice` / `fixed`, comma-separated) ·
`product_no` · `has_product` (`T`/`F`) · `is_notice` · `is_display` · `supplier_id` ·
`offset` (Max 8000) · `limit` (1–100, DEFAULT 10).

Two notes recorded verbatim because they are inconsistencies in the reference itself:

- The LIST's `reply_status` filter documents only **`N: Unanswered`, `P: Answer`** — the `C`
  token that the property list defines ("completed answer") is not listed as a filter value.
- **`order_id` is not a list filter.** It is a response property only — an article names its
  order, but articles cannot be found by order.

## POST (create) request body — the envelope this copy was missing

**Corrected 2026-08-25 by a live 400.** The table below lists the parameter NAMES. It does not, and
did not, say how they are wrapped — and this copy's silence was read as "flat". The first live POST
sent the eight decided fields at the top level and Cafe24 answered **HTTP 400**, creating nothing.

The Admin API's create/update calls take a `request` envelope (confirmed by the product owner against
the official reference; the reference page could not be retrieved into this copy, so this note records
the correction rather than a transcription):

```json
{
  "shop_no": 1,
  "request": { "…the parameters below…" }
}
```

SellerOps sends `{"request": {…}}` and **omits `shop_no`**: it is optional with a documented default
of 1, and this deployment has no provenance for it — the value appears in no stored article row, no
response it reads, and no part of the connection. Asserting a shop that was never observed is a worse
error than letting the platform apply its own default.

## POST (create) request parameters — the complete list

| Name | Required | Constraint | Description (verbatim) |
|---|:--:|---|---|
| `shop_no` | | DEFAULT 1 | Shop Number |
| `board_no` | **Required** | | board number |
| `writer` | **Required** | Max Length 100 | writer |
| `title` | **Required** | Max Length 256 | subject |
| `content` | **Required** | | content |
| `client_ip` | **Required** | IP | IP address of a writer |
| `reply_article_no` | | | replied post number — *If you want to add an reply to a post, enter the number of the post.* |
| `created_date` | | Date | date of create |
| `writer_email` | | Email | email of writer |
| `member_id` | | Max Length 20 | Member id — *If member_id is the same as mall_id: The author will be returned as **shop_name**. If member_id is not provided or is a member ID: The author will be returned as writer.* |
| `notice` | | `T`/`F`, DEFAULT `F` | whether notice |
| `fixed` | | `T`/`F`, DEFAULT `F` | whether fixed |
| `deleted` | | `T`/`F`/`B`, DEFAULT `F` | whether deleted |
| `reply` | | `T`/`F`, DEFAULT `F` | whether replied for 1:1 query |
| `rating` | | 1–5 | review score |
| `sales_channel` | | Max Length 20 | sales channel |
| `secret` | | `T`/`F`, DEFAULT `F` | whether secret posts |
| `password` | | | password of posts |
| `reply_mail` | | `Y`/`N`, DEFAULT `N` | whether replied by mail for 1:1 query |
| `board_category_no` | | | category number of a board |
| `nick_name` | | Max Length 50 | nickname |
| `input_channel` | | `P`/`M`, DEFAULT `P` | posting path |
| `reply_user_id` | | Max Length 20 | manager ID of which processing or completed answer |
| `reply_status` | | `N`/`P`/`C` | status of replay |
| `product_no` | | Max 2147483647 | Product number |
| `category_no` | | | category number |
| `order_id` | | Max Length 32 | Order ID |
| `naverpay_review_id` | | Max Length 20 | review ID of Naver Pay |
| `attach_file_urls` | | `name`, `url` | attached file detail |

Note that `password` is **optional** here, while on the comments POST
(`post-boards-articles-comments.md`) it is **required**.

## PUT (update) request parameters — the complete list

`shop_no`, `board_no` **Required**, `article_no` **Required**, `title` (Max 256), `content`,
`rating` (1–5), `sales_channel` (Max 20), `board_category_no`, `display` (`T`/`F`),
`notice` (`T`/`F`), `fixed` (`T`/`F`), `display_time_start_hour`, `display_time_end_hour`,
`attach_file_url1`–`attach_file_url5`.

| Field | `POST` (create) | `PUT` (update) |
|---|:--:|:--:|
| `reply_article_no` | accepted | **absent** |
| `reply` | accepted | **absent** |
| `reply_user_id` | accepted | **absent** |
| `reply_status` | accepted | **absent** |
| `order_id` | accepted | **absent** |
| `writer`, `client_ip`, `member_id`, `secret`, `password` | accepted | **absent** |
| `title`, `content`, `rating`, `display`, `notice`, `fixed`, attachments | accepted | accepted |

Verified against both the English and the Korean editions on 2026-08-25: `PUT` does **not** accept
`reply_status`. The Korean edition describes `PUT` as
"게시물의 제목, 내용과 평점, 노출 시간 등의 정보를 수정할 수 있습니다."

## What this means for the Cafe24 answer path (record only)

The earlier conclusion — *"`reply_status` is settable only at article CREATION, therefore there is
no contracted way to mark an existing 문의사항 article answered"* — is **half right and its second
half is wrong**. The first clause holds. The inference does not, because creation is not only how a
NEW question is posted: `reply_article_no` makes creation the documented way to attach an ANSWER to
an existing post, on the same call that carries `reply_status` and `reply_user_id`.

So the reference now supports **three** candidate answer representations, and it states which one a
given board actually uses for **none** of them:

| # | Representation | Write endpoint | Actor fields required |
|---|---|---|---|
| A1 | a **reply ARTICLE** whose `reply_article_no` is the question | `POST /boards/{board_no}/articles` | `writer`, `client_ip` (+ optional `member_id`, `reply_user_id`) |
| A2 | a **comment** on the question | `POST /boards/{board_no}/articles/{article_no}/comments` | `writer`, `password` |
| B | an **urgentinquiry reply** | `POST /urgentinquiry/{article_no}/reply` | `user_id` |

What the reference does not state, for any of them:

1. Whether creating a reply article, or a comment, changes the **parent** article's `reply_status`
   — SellerOps's only ANSWERED signal for Cafe24 (`Cafe24InquiryArticleMapper`).
2. Whether the Demo Org's board 6 (문의사항) articles are also urgentinquiry articles, or share an
   `article_no` space with them.
3. Where `writer` / `password` / `client_ip` / `user_id` are expected to come from — except for
   the one documented hint that `member_id` equal to `mall_id` makes the author render as the
   shop's name rather than a person's.

Which of A1 / A2 / B this mall actually uses is answerable by READ alone, because 43 board-6
articles in the Demo Org are already `reply_status=C`. That proof is designed, and stops before
execution, in `docs/inquiry_answer_execution_v1.md`.
