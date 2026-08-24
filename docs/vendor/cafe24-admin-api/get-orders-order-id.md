# GET /api/v2/admin/orders/{order_id} — 주문 단건 조회 (Retrieve an order)

> **Vendor copy.** Transcribed from the official Cafe24 Developers Admin API reference
> (`https://developers.cafe24.com/docs/en/api/admin/`, resource *Orders*), retrieved
> **2026-08-25**. This file records what the PLATFORM publishes. It carries no SellerOps
> conclusion — those live in `docs/exact_operational_context_v1.md`, in
> `ExactOrderLookupCapability`, and in `docs/multi-channel-connector-roadmap.md` §4.1.

## Why this file exists

`ExactOrderLookupCapability` declared, on 2026-08-25, that **no vendored contract on any of the
three channels retrieves an order by its identifier**, and classified an exact endpoint as
*external research required*. That declaration was correct about this repository's `docs/vendor/`
tree and **wrong about the platform**: Cafe24 publishes exactly such an endpoint, and has for as
long as the v2 Admin API has existed. This is the research, done. The capability declaration moves
because a contract is now vendored — not because anyone remembered a URL.

## Specification

| Property | Value |
|---|---|
| Method / path | `GET /api/v2/admin/orders/{order_id}` |
| Description (verbatim) | "You can inquire about 1 order. You can check the order number, member ID, payment method, etc. Sub-resources can be used as embedded to retrieve more information needed for a single call." |
| SCOPE | `mall.read_order` |
| Request Limit | 40 |

## Request parameters

| Name | Required | Description |
|---|:--:|---|
| `shop_no` | | Shop Number, DEFAULT 1 |
| `order_id` | **Required** | Order ID (path) |
| `items` | | *embed* — Item Resource |
| `receivers` | | *embed* — Receiver Resource |
| `buyer` | | *embed* — Orderer Resource |
| `benefits` | | *embed* — Benefits Resource |
| `coupons` | | *embed* — Coupon Resource (not available on Youtube shopping) |
| `return` | | *embed* — Return Details Resource |
| `cancellation` | | *embed* — Cancellation details Resource |
| `exchange` | | *embed* — Exchange details Resource |
| `refunds` | | *embed* — refund details resource |

**Every sub-resource is opt-in.** `buyer` (orderer) and `receivers` (recipient) are returned only
when named in `embed`. Requesting neither is how a caller declines the two resources that exist to
carry a person's name, phone, and address.

## Order property list (the base response, no embed)

Reproduced in full because *what the base response carries anyway* is the privacy question. Fields
this repository projects are marked **[projected]**; fields it must discard are marked
**[discarded — PII]** where that is the reason.

| Attribute | Description (verbatim, abbreviated) |
|---|---|
| `shop_no` | Shop Number |
| `currency` | Currency unit of a mall |
| `order_id` | Order ID **[projected — identity echo only]** |
| `market_id` | Market id (price-comparison origin) |
| `market_order_no` | Market order number |
| `member_id` | Member id **[discarded — PII]** |
| `member_email` | customer email **[discarded — PII]** |
| `member_authentication` | `T` authorized / `B` special treatment / `J` under 14 **[discarded — PII]** |
| `billing_name` | Billing name. May differ from orderer or recipient name **[discarded — PII]** |
| `bank_code` / `bank_code_name` | Bank code / name |
| `payment_method` | payment method code — `cash`, `card`, `cell`, `tcash`, `icash`, `prepaid`, `credit`, `point`, `pointify`, `cvs`, `cod`, `coupon`, `market_discount`, `giftcard`, `pointcard`, `etc` |
| `payment_method_name` | Payment method name |
| `payment_gateway_names` | Payment gateway name |
| `sub_payment_method_name` / `sub_payment_method_code` | International payment method |
| `transaction_ids` | Card transaction ID **[discarded — payment identifier]** |
| **`paid`** | Paid — **`T`: Paid, `F`: Unpaid, `M`: Partially paid** **[projected]** |
| **`canceled`** | Whether the order is canceled — **`T`: Canceled, `F`: Not Canceled, `M`: Partially canceled** **[projected]** |
| **`order_date`** | Ordered date **[projected]** |
| `first_order` | `T` first order / `F` not |
| **`payment_date`** | Payment date **[projected]** |
| `order_from_mobile` | `T`/`F` |
| `use_escrow` | `T`/`F` |
| `group_no_when_ordering` | Customer group number when ordering |
| `initial_order_amount` | initial payment details **[discarded — amount]** |
| `actual_order_amount` | final payment details **[discarded — amount]** |
| `bank_account_no` | Bank account number of the mall for this order |
| `bank_account_owner_name` | Bank account holder name **[discarded — PII]** |
| `market_seller_id` | marketplace vendor ID |
| `payment_amount` | Order total **[discarded — amount]** |
| **`cancel_date`** | Order cancellation date **[projected]** |
| `order_place_name` / `order_place_id` | Order path text / code |
| `payment_confirmation` | `T` confirmed / `F` not confirmed |
| `commission` | Transaction fee |
| `postpay` | `T` payment after delivery / `F` no |
| `admin_additional_amount` | manually input amount |
| `additional_shipping_fee`, `international_shipping_insurance`, `additional_handling_fee`, `eu_customs_fee` | fee fields |
| `shipping_type` / `shipping_type_text` | `A` Domestic / `B` Overseas |
| **`shipping_status`** | Delivery status — **`F`: Awaiting shipment, `M`: In transit, `T`: Delivered, `W`: Shipment on hold, `X`: Awaiting confirmation** **[projected]** |
| `wished_delivery_date`, `wished_delivery_time`, `wished_carrier_id`, `wished_carrier_name` | desired delivery **[discarded]** |
| `return_confirmed_date` | Return approval time |
| `total_supply_price` | Total supply price |
| `naver_point` | NAVER points |
| `additional_order_info_list` | Additional order info **[discarded — free text]** |
| `store_pickup` | `T`/`F` |
| `easypay_name` | Easypay payment gateway name |
| `loan_status` | `OK` / `NG` / `ER` |
| `subscription` | `T` subscription payment / `F` not |
| `items` | Item Resource (embed) |
| `receivers` | Receiver Resource (embed) **[never requested — PII]** |
| `buyer` | Orderer Resource (embed) **[never requested — PII]** |
| `shipping_fee_detail`, `regional_surcharge_detail` | fee detail |
| `return`, `cancellation`, `exchange` | claim Resources (embed) |
| `multiple_addresses` | `T` multi-address / `F` single |
| `exchange_rate` | Exchange rate |
| `first_payment_methods` | initial payment method code |
| `naverpay_payment_information` | `P` PG payment / `N` NaverPay |
| `include_tax` | `T`/`F` |
| `tax_detail` | Tax details |
| `service_type` | `rental` : rental order |
| `service_data` | order service data |
| `show_shipping_address` | `T` Displayed / `F` Hidden |

### The three state fields, and that they are three

Cafe24 does not publish one "order status" at order level. It publishes `paid`, `canceled` and
`shipping_status` as **three independent fields with three independent vocabularies**, and each of
the first two has a *partial* value (`M`) that is neither yes nor no. A projection that folds them
into one status has to invent a rule the platform did not state.

`order_status` — the long `N00…E40` code list — is a **request filter on the LIST endpoint and on
the Items sub-resource**, not an order-level response property. It is not projected.

## Sibling endpoint: the LIST also filters by order_id

| Method / path | SCOPE |
|---|---|
| `GET /api/v2/admin/orders` | `mall.read_order` |
| `GET /api/v2/admin/orders/count` | `mall.read_order` |
| `PUT /api/v2/admin/orders` | (write) |
| `PUT /api/v2/admin/orders/{order_id}` | (write) |

The LIST accepts `order_id` ("You can search multiple item with ,(comma)"), so a bounded multi-order
read is contracted too. It also accepts `buyer_name`, `receiver_name`, `receiver_address`,
`buyer_cellphone`, `buyer_phone`, `buyer_email`, `member_id`. **SellerOps sends none of those** —
searching a customer by name or phone is the fuzzy-matching path this package forbids, and a
contract offering it is not a reason to use it.

`start_date`/`end_date` are documented as "The search period cannot exceed 3 months per call", with
`date_type` DEFAULT `order_date`. That is the endpoint `Cafe24OrdersClient` already uses for
`ORDER_SUMMARY`; nothing in this package widens its window.

## What the reference does NOT state

- Whether `order_id` on a **board article** (`docs/vendor/cafe24-admin-api/get-boards-articles.md`)
  is guaranteed to be an order id resolvable by this endpoint, or may be a free-typed string. The
  article field is documented `Max Length : [32]` on create with no format constraint.
- What HTTP status an unknown `order_id` returns. SellerOps therefore treats **any** non-200 that is
  not a recognized auth/rate-limit response as "could not read", never as "the order does not exist".
