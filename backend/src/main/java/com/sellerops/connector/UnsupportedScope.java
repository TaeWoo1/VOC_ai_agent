package com.sellerops.connector;

/**
 * An honest, operator-facing note that a connector deliberately does <b>not</b>
 * support a particular scope — e.g. a board it never reads, or a write action it
 * never performs. This is distinct from a {@link DataType} capability: a data
 * type is something the connector <em>can</em> collect, whereas an unsupported
 * scope documents a boundary so the UI can be transparent about what is out of
 * scope rather than silently absent.
 *
 * <p>{@code code} is a stable machine token (e.g. {@code BOARD_9}); {@code label}
 * is the Korean operator wording. Connectors own their own list (Cafe24-specific
 * boundaries live in the Cafe24 connector), keeping channel-specific knowledge
 * out of the generic control surface.
 */
public record UnsupportedScope(String code, String label) {
}
