package com.sellerops.inbox.dto;

import java.util.List;

public record InboxResponse(List<FeedItem> items, long total) {
}
