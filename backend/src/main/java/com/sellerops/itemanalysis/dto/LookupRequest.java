package com.sellerops.itemanalysis.dto;

import java.util.List;
import java.util.UUID;

/**
 * Inbox-scoped analysis lookup body: the {@code (sourceType, sourceId)} refs of the feed rows
 * currently on screen. The inbox sends only the items it is displaying so the response is
 * bounded by the feed size, never the org-wide corpus.
 */
public record LookupRequest(List<SourceRef> items) {

    /** One feed row's join key — mirrors {@code FeedItem.(type, id)}. */
    public record SourceRef(String sourceType, UUID sourceId) {}
}
