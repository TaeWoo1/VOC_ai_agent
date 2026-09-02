package com.sellerops.attention.reply.dto;

/**
 * Save one template's wording. The key is the path, not the payload — a request that could name a
 * different template than the route does is a request with two answers.
 */
public record ReviewReplyTemplateRequest(String body) {
}
