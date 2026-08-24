# POST /api/v2/admin/boards/{board_no}/articles/{article_no}/comments — 게시글 댓글 등록

> **Vendor copy.** Transcribed from the official Cafe24 Developers Admin API reference
> (`https://developers.cafe24.com/docs/en/api/admin/`, section *Boards articles comments →
> Create a comment for a board post`), retrieved **2026-08-24**. This file records what the
> PLATFORM publishes. It carries no SellerOps conclusion — those live in
> `docs/inquiry_action_flow_v1.md` and in `InquiryReplyCapabilityRegistry`, and as of this
> retrieval they still say NEEDS_VERIFICATION.

## Specification

| Property | Value |
|---|---|
| Method / path | `POST /api/v2/admin/boards/{board_no}/articles/{article_no}/comments` |
| SCOPE | `mall.write_community` |
| Request limit | 40 |
| Objects per single API call limit | 1 |

## Request parameters

| Name | Required | Constraint | Description |
|---|:--:|---|---|
| `shop_no` | | Min: 1, DEFAULT 1 | Shop number |
| `board_no` | **Required** | | Board number |
| `article_no` | **Required** | | Post number |
| `content` | **Required** | | Comment content |
| `writer` | **Required** | Max length: 100 | Writer |
| `password` | **Required** | Length min 1 / max 20 | Comment password |
| `member_id` | | Max length: 20 | Member id |
| `rating` | | Min 1 – Max 5, DEFAULT 0 | Comment rating |
| `secret` | | `T` / `F`, DEFAULT `F` | Whether a secret post |
| `parent_comment_no` | | Min: 1 | Parent comment number |
| `input_channel` | | `P` (PC) / `M` (Mobile), DEFAULT `P` | Type of online store |
| `created_date` | | Date | Date of creation |
| `attach_file_urls` | | `name`, `url` | Attached file detail |

## Sibling endpoints in the same resource

| Method / path | SCOPE |
|---|---|
| `GET /api/v2/admin/boards/{board_no}/articles/{article_no}/comments` | `mall.read_community` |
| `DELETE /api/v2/admin/boards/{board_no}/articles/{article_no}/comments/{comment_no}` | `mall.write_community` |

## Comment property list (as returned by the GET)

`shop_no`, `board_no`, `article_no`, `comment_no`, `content`, `writer` (max 100), `member_id`
(max 20), `created_date`, `client_ip`, `rating` (1–5), `secret` (`T`/`F`), `parent_comment_no`,
`input_channel` (`P`/`M`), `attach_file_urls`.

## What the reference does NOT state

Recorded because their absence is the reason SellerOps has not promoted this to `DIRECT_API`:

- Whether creating a comment on a **문의사항 board** changes that article's `reply_status`
  (SellerOps's only ANSWERED signal for Cafe24 — `Cafe24InquiryArticleMapper`). The reference
  describes comments as "comments added by a shopping mall customer **or manager**" and says
  nothing about inquiry-answer semantics.
- Where a seller-side integration is expected to obtain `writer` and `password`. Both are
  **required** and neither exists anywhere in SellerOps's stored Cafe24 connection.
