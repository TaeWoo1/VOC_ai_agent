package com.sellerops.attention.reply.dto;

import java.util.List;

/**
 * Every review reply template, in the order the provider decides between them (rating first, then
 * the keyword list, then the fallback). The screen lists them in this order so that reading the list
 * top to bottom is reading how the choice is made.
 */
public record ReviewReplyTemplatesView(List<ReviewReplyTemplateView> templates) {
}
