package com.sellerops.knowledge.style.dto;

import com.sellerops.knowledge.style.AnswerLength;
import com.sellerops.knowledge.style.AnswerTone;
import com.sellerops.knowledge.style.EmojiPolicy;
import java.util.List;

/**
 * What the settings screen sends.
 *
 * <p>Every field is optional, and an absent field means "the default", not "leave what was there".
 * The screen always sends the whole form, and a PUT that merged would make 「끝 인사를 지웠다」
 * unrepresentable.
 */
public record AnswerStyleRequest(AnswerTone tone, AnswerLength lengthPreference,
                                 EmojiPolicy emojiPolicy, String greeting, String closing,
                                 String customerAddress, List<String> requiredPhrases,
                                 List<String> forbiddenPhrases, String unknownFallbackTemplate) {
}
