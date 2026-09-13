# Agent-native Text-first Pilot — scope, as of 2026-09-13

The single sentence: **reviewnary's pilot is text-first, provider-independent at its Core, and media
presence-aware. It does not implement media references and it does not implement multimodal
inference.** Everything below either belongs to that scope or is named as not implemented.

This document is a scope statement, not an architecture. Each line points at the document that owns it.

---

## In scope

| | state | owner |
|---|---|---|
| **Provider-independent Core** | reading, judging, deciding and recording an act on a review are scoped by `(reviewId, orgId)` — no seller account, no channel gate | `docs/core_channel_boundary_v1.md` |
| **Cafe24 official API** | board articles via the Admin API; reviews promoted from board 4; inquiry answer execution `VERIFIED` | `docs/inquiry_answer_execution_v1.md` |
| **Coupang Aside** | optional execution provider behind the same driver interface; acquisition `IMPLEMENTED / LIVE_UNPROVEN` | `docs/agentic_operating_workspace_v2.md` |
| **Media presence awareness** | `reviews.media_count` + `media_count_observed`; Cafe24 projects `attach_file_urls.length` on the sweep it already runs | `docs/review_media_presence_audit_v1.md` |
| **Core data presence ≠ connector availability** | a channel this org holds rows on is accounted for on the operations figures whether or not it can be connected | §2 below |

## NOT implemented, and deliberately so

- **Media references.** No URL, filename, `name`, blob or image is stored anywhere. Three tests assert
  it structurally: the wire row has no field for one (`AttachmentCount` holds an `int`), V101 and V102
  add one boolean and one integer, and the probe's report record carries no container type.
- **Multimodal inference.** No image is downloaded, sent to a model, or described.
  `AI_EXTRACTED_FROM_SELLER_IMAGE` still has zero producers and a test still says so.
- **NAVER media.** `DEFERRED`. The 25-column export's `포토/영상` is column E and the mapper does not
  read it; the only value this repository has ever seen in that cell is a fixture author's
  `example.invalid` placeholder. One real export file read offline would settle it.
- **Coupang media.** `MEDIA_UNKNOWN` and frozen. The `photoWord`/`videoWord` census has no production
  caller and none is being added; the existing policy commitment (「이미지·동영상 원본」 미저장) stands.
- **Cafe24 historical attachments.** The 127 board-4 articles older than the measured window are not
  re-read. There is no backfill: `attachment_count` is null for every row that existed before V102,
  and `media_count_observed` is false for every review promoted before it.

---

## §1 — What «media presence-aware» means, exactly

Three states, and the third is the one that did not exist before:

| `media_count_observed` | `media_count` | means |
|---|---|---|
| `false` | any | **UNKNOWN** — nobody looked, or the reader could not have seen it |
| `true` | `0` | observed none |
| `true` | `> 0` | observed present |

Carried, never derived from the count. The Cafe24 sweep sets it from a length the response already
carried; every file-upload path leaves it false, because a CSV has no attachment column to read.

**Measured**: 1 of 7 Cafe24 board-4 articles in the last 365 days carries 1 file. That is the whole
of what this product knows about review media, and it is more than it knew yesterday.

## §2 — Four questions that were one list

`ProductChannels` — the connectable set, NAVER / Coupang / Cafe24, product-owner decision
2026-08-17 — was answering all four of these. It now answers the second only.

| question | answered by | unchanged? |
|---|---|---|
| **Core data presence** — does this org hold rows here? | `OrgChannelVisibility` | new |
| **connector availability** — can a seller connect this channel? | `ProductChannels` | unchanged |
| **Attention support** — can the AI pilot run here? | `ReviewTriageChannelCapability` | unchanged |
| **reply / execution capability** — can anything be sent? | `SellerAccount` + channel capability | unchanged |

A seller whose only reviews arrived by upload now has a Home that shows their work. The connect CTA
is still there — connecting is still something they can do — and nothing on any screen says an
unconnectable channel could be connected, could be triaged by the pilot, or could be replied to.

## §3 — The pilot's honest ceiling

- Reply/execution is `VERIFIED` for Cafe24 inquiries and NAVER product inquiries; review reply is
  guided composer fill on NAVER (`COMPOSER_FILLED ≠ posted`) and the Cafe24 comment lane.
- Coupang has no seller reply to a 상품평 at all, and the product says so rather than offering one.
- The AI pilot covers three channels; a review outside them is the seller's to judge and never the
  pilot's to mark.
- Everything a seller concludes stays inside reviewnary. The one sentence the Decision Workspace ends
  on is still true: 「여기 기록한 판단과 조치는 reviewnary 안에만 남습니다.」
