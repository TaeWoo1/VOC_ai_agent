package com.sellerops.attention.reply.dto;

import java.util.List;

/**
 * One review reply template as the settings screen reads it.
 *
 * <p>{@code body} is the EFFECTIVE wording — the override when there is one, the shipped default
 * otherwise — so the screen never has to decide which of two fields is in force. {@code defaultBody}
 * is carried beside it because 「기본값 복원」 has to be able to show what would be restored, and
 * {@code customized} is the one bit that says whether a row exists.
 *
 * <p>{@code matchWords} is what actually selects this template. It is the provider's own keyword
 * list, and it is here because a settings screen that cannot say when a template is used is asking
 * the seller to guess. Empty for the two that are not chosen by words.
 *
 * <p>{@code key} is the storage/route address. The screen renders a Korean name for it and never the
 * key itself — {@code reviewReplyTemplates.test.tsx} asserts that.
 */
public record ReviewReplyTemplateView(String key, String body, String defaultBody,
                                      boolean customized, List<String> matchWords) {
}
