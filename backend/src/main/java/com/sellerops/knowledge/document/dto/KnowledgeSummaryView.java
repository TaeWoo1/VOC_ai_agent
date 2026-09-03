package com.sellerops.knowledge.document.dto;

/**
 * <b>What reviewnary knows about this company, as five numbers.</b>
 * (Knowledge Setup &amp; Inbox UX v1 §2, §7)
 *
 * <p>The screen that carries the title 「reviewnary가 알고 있는 정보」 could not say what it knew: it
 * listed the material the seller had handed over and nothing else, so a company with 38 written
 * product facts, 6 operating rules and 23 past answers read as a company with three files. These are
 * the numbers that make the title true.
 *
 * <p><b>They partition the corpora — nothing is counted twice.</b> A knowledge source is either
 * something a person typed or something that came out of a file, so {@code productKnowledge} and
 * {@code operatingRules} count the hand-written rows and {@code documents} counts the uploaded ones.
 * A seller can add them up and get the size of their library, which is the only reason to show four
 * numbers instead of one.
 *
 * <p><b>{@code products} is not part of that sum, and that is the point.</b> It is what reviewnary
 * already read from the channels without being taught anything — the answer to 「처음부터 다 입력해야
 * 하나요」. {@code pastAnswers} is Answer Memory, which is neither: past answers are consulted, never
 * official, and the screen says so in words rather than by putting them in the same group.
 *
 * <p>Deterministic counts over rows this org owns. No model, no marketplace.
 */
public record KnowledgeSummaryView(long productKnowledge, long operatingRules, long documents,
                                   long pastAnswers, long products, long needsConfirmation) {
}
