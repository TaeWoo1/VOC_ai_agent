# Urgentinquiry (긴급문의) + Urgentinquiry reply — 공식 계약 사본

> **Vendor copy.** Transcribed from the official Cafe24 Developers Admin API reference
> (`https://developers.cafe24.com/docs/en/api/admin/` and the Korean edition
> `.../docs/ko/api/admin/`, resources *Urgentinquiry* and *Urgentinquiry reply*), retrieved
> **2026-08-25**. Both editions were fetched and compared; they agree.
>
> This file records what the PLATFORM publishes. It carries **no** SellerOps conclusion — in
> particular it does **not** say that this resource is where the Demo Org's board-6 문의사항
> articles live. That is an unproven question owned by `docs/inquiry_answer_execution_v1.md`.

## Why this file exists

Until this retrieval SellerOps had never recorded this resource at all. Its own audit of "how does
a Cafe24 answer get written" examined `boards/{board_no}/articles` and its `comments`
sub-resource, concluded that no update endpoint accepts `reply_status`, and reported the answer
path as blocked. **The audit was complete for the resource it looked at and the resource it looked
at was not the only one.** Cafe24 publishes a separate 긴급문의 resource whose reply is a
first-class object with `content`, `status` and `user_id`, and whose `POST`/`PUT` exist.

## Urgentinquiry

Korean description (verbatim): 긴급문의 게시물에 대해 조회할 수 있습니다.
English: "Retrieve urgent inquiries."

| Method / path | SCOPE | Request Limit |
|---|---|---|
| `GET /api/v2/admin/urgentinquiry` | `mall.read_community` | 40 |

**That is the whole resource.** There is no `POST`, no `PUT`, no `DELETE`, and **no
`/urgentinquiry/{article_no}` single-item GET.**

### Request parameters (the complete list)

| Name | Constraint | Description |
|---|---|---|
| `shop_no` | Min 1, DEFAULT 1 | Shop Number |
| `start_date` | Date | Creation start date |
| `end_date` | Date | Search end date for "Post created date" |
| `offset` | Max 8000 | Start location of list, DEFAULT 0 |
| `limit` | 1–100 | Limit, DEFAULT 10 |

**There is no `article_no` filter.** A single urgent inquiry cannot be addressed by number
through this endpoint — only a date window can. (The *reply* sub-resource below is addressed by
`article_no`; the inquiry itself is not.)

### Property list

| Attribute | Description (verbatim) |
|---|---|
| `shop_no` | Shop Number |
| `article_no` | posts number |
| `article_type` | type of post |
| `title` | subject |
| `writer` | writer |
| `member_id` | Member id |
| `start_date` | Creation start date |
| `reply_status` | status of replay — `F`: Unreplied, `I`: Replying, `T`: Replied |
| `hit` | views |
| `content` | content |
| `writer_email` | email of writer |
| `phone` | Office phone number |
| `search_type` | Search type — `P`: Products, `O`: Orders |
| `keyword` | Search terms |
| `attached_file_detail` | attached file detail |

**`reply_status` here is `F`/`I`/`T`, not the board article's `N`/`P`/`C`.** Two different
vocabularies for the same-sounding field on two resources, and neither reference cross-references
the other.

## Urgentinquiry reply

Korean description (verbatim): 긴급문의 게시물의 답변글을 조회, 등록, 수정할 수 있습니다.
English: "Retrieve, create & update a reply for an urgent inquiry."

| Method / path | SCOPE | Request Limit | objects/call |
|---|---|---|---|
| `GET /api/v2/admin/urgentinquiry/{article_no}/reply` | `mall.read_community` | 40 | — |
| `POST /api/v2/admin/urgentinquiry/{article_no}/reply` | `mall.write_community` | 40 | 1 |
| `PUT /api/v2/admin/urgentinquiry/{article_no}/reply` | `mall.write_community` | 40 | 1 |

There is **no** `DELETE`.

### Reply property list

| Attribute | Description (verbatim) |
|---|---|
| `shop_no` | Shop Number |
| `article_no` | posts number |
| `created_date` | Reply date |
| `status` | status of replay — `F`: Unreplied, `I`: Replying, `T`: Replied |
| `content` | **Reply content** |
| `method` | Reply method — `E`: Email, `S`: SMS, `A`: All |
| `count` | Reply count |
| `user_id` | manager ID of which processing or completed answer |
| `attached_file_detail` | attached file detail |

**This is the only Cafe24 resource in the whole reference that publishes an answer's TEXT.** The
board-article property list has `reply` (a `T`/`F` flag), `reply_status` and `reply_user_id`, and
no field anywhere that holds what the seller wrote.

### GET — request parameters

| Name | Required | Description |
|---|:--:|---|
| `shop_no` | | Min 1, DEFAULT 1 |
| `article_no` | **Required** | posts number (path) |

Documented purpose (verbatim): "Retrieve a reply for an urgent inquiry. Check date, status &
number of replies."

### POST — request parameters

| Name | Required | Constraint | Description |
|---|:--:|---|---|
| `shop_no` | | Min 1, DEFAULT 1 | Shop Number |
| `article_no` | **Required** | | posts number |
| `content` | **Required** | | Reply content |
| `status` | | `F`/`I`/`T`, DEFAULT `F` | status of replay |
| `user_id` | **Required** | Max Length 20 | manager ID of which processing or completed answer |
| `attach_file_urls` | | `name` **Required**, `url` **Required** | attached file detail |

### PUT — request parameters

Identical to `POST` except that **`user_id` is optional** (Max Length 20) rather than required.

### What this resource does NOT require

Recorded because it is the sharpest contrast with the board-comment path:

- **no `writer`** — the actor is a `user_id`, i.e. a mall manager account, not a display name
- **no `password`**
- **no `client_ip`**

## What the reference does NOT state

- Whether a 문의사항 **board** article (board 6 in the Demo Org) is also an urgent inquiry, or
  whether the two resources share an `article_no` space at all. The word "board" does not appear
  in the Urgentinquiry resource, and `board_no` is not one of its parameters.
- Where an integration obtains the `user_id`. It is described only as "manager ID of which
  processing or completed answer" — a mall-manager identity. SellerOps's stored Cafe24 connection
  holds `mall_id` and `refresh_token` and nothing else (`CredentialTemplates`).
- Whether `POST .../reply` with `status=T` changes anything observable on the corresponding board
  article, if there is a corresponding board article.
