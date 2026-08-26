package com.sellerops.knowledge.style.dto;

import com.sellerops.knowledge.style.AnswerLength;
import com.sellerops.knowledge.style.AnswerStyleProfile;
import com.sellerops.knowledge.style.AnswerTone;
import com.sellerops.knowledge.style.EmojiPolicy;
import java.util.List;

/**
 * The style as the settings screen reads it back.
 *
 * <p>{@code configured} is the honest half: an org with no row is shown the defaults, and the screen
 * says 「기본 설정으로 답변합니다」 rather than pretending someone chose them.
 */
public record AnswerStyleView(AnswerTone tone, AnswerLength lengthPreference, EmojiPolicy emojiPolicy,
                              String greeting, String closing, String customerAddress,
                              List<String> requiredPhrases, List<String> forbiddenPhrases,
                              String unknownFallbackTemplate, boolean configured, int version) {

    public static AnswerStyleView of(AnswerStyleProfile profile) {
        return new AnswerStyleView(profile.tone(), profile.length(), profile.emoji(),
                profile.greeting(), profile.closing(), profile.customerAddress(),
                profile.requiredPhrases(), profile.forbiddenPhrases(), profile.unknownFallback(),
                profile.version() > 0, profile.version());
    }
}
