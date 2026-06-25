package com.sellerops.connector.cafe24;

import com.fasterxml.jackson.annotation.JsonIgnoreProperties;
import com.fasterxml.jackson.annotation.JsonProperty;

/**
 * Minimal projection of one Cafe24 Admin boards-list row — only the board-level
 * metadata that Board Discovery needs to map a community board to the kind of
 * VOC it carries. Everything else in the board object is ignored.
 *
 * <p><b>Metadata only by design:</b> this row carries {@code board_no},
 * {@code board_name}, and an optional {@code board_type} — never article bodies,
 * writers, customer fields, or any post content. Discovery enumerates the
 * <i>structure</i> of the mall's boards; article capture is a later slice.
 *
 * <p>Field names are the doc-asserted Cafe24 admin board-row names; they are a
 * live-verification item (see the connector's {@code NEEDS_VERIFICATION} Board
 * Discovery status, docs/sellerops_cafe24_community_board_discovery.md) until a
 * gated {@code /boards} read confirms them against a real mall.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Cafe24BoardRow(
        @JsonProperty("board_no") int boardNo,
        @JsonProperty("board_name") String boardName,
        @JsonProperty("board_type") String boardType) {
}
