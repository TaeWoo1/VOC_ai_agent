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
 * <p>Field names are the Cafe24 admin board-row names, confirmed against a real
 * mall by the supervised Board Discovery live run (see the connector's
 * {@code CONFIRMED} Board Discovery status,
 * docs/sellerops_cafe24_community_board_discovery.md). {@code board_type} arrives
 * as a numeric code and is captured as metadata only — classification keys off
 * {@code board_name}, since one {@code board_type} spans multiple board kinds.
 */
@JsonIgnoreProperties(ignoreUnknown = true)
public record Cafe24BoardRow(
        @JsonProperty("board_no") int boardNo,
        @JsonProperty("board_name") String boardName,
        @JsonProperty("board_type") String boardType) {
}
