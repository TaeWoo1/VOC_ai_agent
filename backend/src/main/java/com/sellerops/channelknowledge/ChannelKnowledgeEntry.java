package com.sellerops.channelknowledge;

import java.time.LocalDate;
import java.util.List;

/**
 * One fact about how a sales channel works, carrying where it came from and when it was last true.
 *
 * <p>Channel Knowledge is the third knowledge axis, and the boundaries matter more than the content:
 * Product Knowledge answers "무엇을 파는가", Customer Operations Memory answers "고객이 무엇을
 * 말해왔는가", and this answers "이 채널은 어떻게 작동하고 판매자는 어떻게 운영하는가". It is platform
 * knowledge — true for every seller on Coupang — and must never absorb seller-specific policy (배송·
 * 교환 규정, CS tone, 브랜드 규칙). Those vary per seller and belong to a system this package does not
 * build; keeping them out is what stops one seller's shipping rule being told to another.
 *
 * <p><b>Why entries and not a system prompt.</b> A prompt is unversioned, unattributed, and either
 * entirely present or entirely absent. These are retrieved on demand, each one naming its own source
 * and verification date, so an Agent answer can say where a claim came from and a reader can tell a
 * fact proven on a live run from one read off a vendor's documentation.
 *
 * @param id           stable slug, unique within the pack
 * @param channel      channel code (NAVER / COUPANG / CAFE24)
 * @param topic        which of the knowledge areas this belongs to
 * @param kind         what shape of knowledge it is
 * @param title        one line, in seller language
 * @param summary      one or two sentences — what a retrieval result shows
 * @param body         the full text, optional
 * @param capabilities data types this applies to; empty means channel-wide
 * @param tags         extra retrieval terms
 * @param source       provenance class
 * @param sourceRef    the document, URL, or evidence path behind it
 * @param verifiedAt   when this was last confirmed true. Absent is not "always true" — it is unknown.
 */
public record ChannelKnowledgeEntry(
        String id,
        String channel,
        ChannelKnowledgeTopic topic,
        ChannelKnowledgeKind kind,
        String title,
        String summary,
        String body,
        List<String> capabilities,
        List<String> tags,
        ChannelKnowledgeSource source,
        String sourceRef,
        LocalDate verifiedAt) {

    /** Everything a lexical search should look at, lower-cased. */
    public String searchableText() {
        return String.join(" ",
                title == null ? "" : title,
                summary == null ? "" : summary,
                body == null ? "" : body,
                String.join(" ", tags == null ? List.of() : tags),
                String.join(" ", capabilities == null ? List.of() : capabilities),
                topic.name(), kind.name(), channel).toLowerCase();
    }
}
