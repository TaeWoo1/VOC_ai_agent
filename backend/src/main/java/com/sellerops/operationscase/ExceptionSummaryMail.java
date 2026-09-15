package com.sellerops.operationscase;

import com.sellerops.mail.OutboundMail;
import java.util.ArrayList;
import java.util.List;

/**
 * The one exception summary a run may send — composed from COUNTS and channel names, never from a case's text.
 *
 * <p>A mail leaves the product. So it carries no customer sentence, no product name, no summary the investigator
 * wrote, no draft: «확인할 일 2건» and which channel could not be read, and a link. What the two cases are is on the
 * screen the link opens, behind the seller's login. {@code ExceptionSummaryMailTest} asserts the absence.
 */
public final class ExceptionSummaryMail {

    static final String SUBJECT = "[reviewnary] 고객 운영 관리에서 확인할 일이 있습니다";

    private ExceptionSummaryMail() {
    }

    /** A source that could not be read, as the mail may state it: the channel's name and why. */
    public record GapLine(String channelNameKo, String family, List<String> dataTypes) {
    }

    public static OutboundMail compose(String to, int decisions, List<GapLine> gaps, String link) {
        List<String> lines = new ArrayList<>();
        if (decisions > 0) {
            lines.add("고객 운영 관리에서 확인할 일 " + decisions + "건이 있습니다.");
        } else {
            lines.add("고객 운영 관리에서 제대로 확인하지 못한 곳이 있습니다.");
        }
        for (GapLine gap : gaps) {
            String channel = gap.channelNameKo() == null ? "판매 채널" : gap.channelNameKo();
            String why = "AUTH".equals(gap.family()) ? "연결이 만료되어" : "연결이 끊겨";
            lines.add(channel + topic(channel) + " " + why + " " + dataTypesKo(gap.dataTypes())
                    + " 확인하지 못했습니다. 다시 연결해 주세요.");
        }
        lines.add("");
        lines.add("Reviewnary에서 확인하기: " + link);
        lines.add("");
        lines.add("이 메일에는 고객이 쓴 내용이 들어 있지 않습니다. 자세한 내용은 Reviewnary에서 확인해 주세요.");
        return new OutboundMail(to, SUBJECT, String.join("\n", lines));
    }

    static String dataTypesKo(List<String> dataTypes) {
        List<String> words = new ArrayList<>();
        for (String type : dataTypes) {
            words.add(switch (type) {
                case "INQUIRY" -> "문의";
                case "REVIEW" -> "리뷰";
                default -> "자료";
            });
        }
        return words.isEmpty() ? "자료를" : String.join("·", words.stream().distinct().toList()) + "를";
    }

    /** 은/는 for the channel's last character — a Hangul syllable's final consonant, or a digit's reading. */
    static String topic(String word) {
        if (word == null || word.isEmpty()) {
            return "는";
        }
        char last = word.charAt(word.length() - 1);
        if (last >= 0xAC00 && last <= 0xD7A3) {
            return (last - 0xAC00) % 28 == 0 ? "는" : "은";
        }
        if (Character.isDigit(last)) {
            return "0136780".indexOf(last) >= 0 ? "은" : "는";
        }
        return "는";
    }
}
