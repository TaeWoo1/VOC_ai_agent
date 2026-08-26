package com.sellerops.inquiry.draft.dto;

import java.util.UUID;

/**
 * One citation line under a generated draft.
 *
 * <p>{@code scopeLabel} is the seller-facing group this citation belongs to — 상품 정보 / 운영 정책 /
 * 과거 답변. It is here rather than derived on the screen from {@code kind} because {@code kind} is a
 * storage vocabulary that may gain a value the frontend has no label for, and an unlabelled citation
 * is worse than a plainly named one.
 *
 * <p><b>{@code snippet} was added on 2026-08-26, reversing this record's original position.</b> It
 * used to say the passage text was deliberately absent — "the reply already says the thing, and a
 * citation is a pointer, not a second copy". The live NAVER case disproved that. The draft answered
 * 「몇 가닥까지 들어가나요?」 from a source whose title is 「자주 묻는 질문 - 접착과 재부착」, and the
 * seller reading the screen had a title about 접착 next to an answer about 가닥 수 and no way to see
 * that the chunk contained exactly that Q&amp;A. A title is a pointer; it is not a check. What makes
 * a citation checkable is the sentence the drafter was actually shown.
 *
 * <p>It is a short excerpt, not the document: enough to recognise, and the seller's knowledge screen
 * still owns the whole text. {@code sourceId} remains so a screen can link there.
 */
public record DraftEvidenceView(String kind, String scopeLabel, String title, String locator,
                                UUID sourceId, UUID chunkId, String snippet) {

    /** How much of a passage a seller needs in order to recognise it. Two or three sentences. */
    public static final int SNIPPET_CHARS = 240;

    /**
     * The excerpt as it goes on the screen — collapsed whitespace, cut on a character budget.
     *
     * <p>Cut with an ellipsis rather than at a sentence boundary: a boundary-aware cut that lands
     * early would silently drop the line the seller is looking for, and the ellipsis is what says
     * "there is more of this document than you are seeing".
     */
    public static String snippetOf(String text) {
        if (text == null) {
            return null;
        }
        String flat = text.replaceAll("\\s+", " ").strip();
        if (flat.isEmpty()) {
            return null;
        }
        return flat.length() <= SNIPPET_CHARS ? flat : flat.substring(0, SNIPPET_CHARS) + "…";
    }
}
