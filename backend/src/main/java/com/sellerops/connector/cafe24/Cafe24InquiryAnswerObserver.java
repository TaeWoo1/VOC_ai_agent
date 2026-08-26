package com.sellerops.connector.cafe24;

import java.time.Instant;
import java.time.LocalDate;
import java.util.ArrayList;
import java.util.HashMap;
import java.util.HashSet;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.Set;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * The second way a Cafe24 문의 can already be answered: a COMMENT written by the shop.
 *
 * <p><b>The defect this closes.</b> Cafe24 publishes more than one representation of an answer, and
 * SellerOps could see exactly one of them. A seller answering board-6 article 3674 from the admin UI
 * on 2026-08-26 produced a comment — {@code member_id == mall_id}, 14:56 KST — and produced NEITHER
 * a child reply article NOR a {@code reply_status} change: the article still read {@code N} when the
 * routine sweep re-read it at 17:43, so every signal SellerOps owned said 미답변 while the customer
 * had been answered nearly three hours earlier. Verdict {@code STANDARD_BOARD_COMMENT}, approved
 * bounded READ {@code apr-c24-a3674-obs}, 7 requests, WRITE 0.
 *
 * <p><b>A comment is never ingested as an inquiry.</b> Nothing here produces a canonical record. This
 * class answers one question about articles the connector is ALREADY collecting — "has the shop
 * answered this one in the other place?" — and returns a time. A customer's comment produces no
 * entry, so no customer question is ever silently marked handled, and no comment ever becomes a row
 * a seller has to answer.
 *
 * <p><b>Authorship is proven, not assumed.</b> The only accepted proof is
 * {@link Cafe24BoardCommentRow#authoredByMall()} — the platform's own 상점명 condition — plus a
 * parseable timestamp. An unknown author, a blank member id, or a timezone-less date yields nothing:
 * the article stays 미답변, which is the recoverable error.
 *
 * <p><b>Bounded, and it says when it stopped.</b> One discovery request narrows the window to the
 * articles that have any comment at all ({@code comment=T}); at most {@link #MAX_COMMENT_READS}
 * comment reads follow. Reaching the cap is logged as a count rather than absorbed, because a
 * truncated read that stayed quiet would be indistinguishable from a board where nobody comments.
 */
public class Cafe24InquiryAnswerObserver {

    private static final Logger log = LoggerFactory.getLogger(Cafe24InquiryAnswerObserver.class);

    /** How many articles' comments one page may read. Exceeding it is reported, never hidden. */
    static final int MAX_COMMENT_READS = 20;

    /** How many rows the one discovery request asks for. The platform's own maximum is 100. */
    static final int DISCOVERY_LIMIT = 100;

    /**
     * The comment-read ceiling for a historical run over an EXACT named set.
     *
     * <p>Higher than {@link #MAX_COMMENT_READS} because the two are bounded by different things. The
     * routine cap protects a sweep page whose candidate count nobody chose; a historical run names
     * every article in its approval manifest, so its ceiling is the manifest's, and exceeding it is a
     * refusal rather than a truncation.
     */
    static final int MAX_EXACT_COMMENT_READS = 25;

    private final Cafe24BoardArticlesClient articles;
    private final Cafe24BoardCommentsClient comments;

    public Cafe24InquiryAnswerObserver(Cafe24BoardArticlesClient articles,
                                       Cafe24BoardCommentsClient comments) {
        this.articles = articles;
        this.comments = comments;
    }

    /**
     * For the given candidate articles, when the shop answered each one by comment.
     *
     * <p>{@code candidates} is what the caller would otherwise store as 미답변 — already-answered
     * articles and thread replies are excluded by the caller, so this never spends a request to
     * re-confirm something the article itself already states. An empty candidate set makes zero
     * requests, including the discovery one.
     *
     * @return article number → the earliest proven shop-comment instant; never null, possibly empty
     */
    public Map<Long, Instant> observe(String accessToken, String mallId, int boardNo,
                                      LocalDate windowStart, LocalDate windowEnd,
                                      Set<Long> candidates) {
        if (candidates == null || candidates.isEmpty()) {
            return Map.of();
        }
        List<Long> commented;
        try {
            commented = articles.fetchCommentedArticleNumbers(
                    accessToken, mallId, boardNo, windowStart, windowEnd, DISCOVERY_LIMIT);
        } catch (Cafe24RateLimitedException e) {
            // The ordinary sweep already succeeded; losing the comment lane must not lose the page.
            log.info("카페24 댓글 답변 관측 생략: board={} 사유=RATE_LIMITED", boardNo);
            return Map.of();
        }
        if (commented.size() >= DISCOVERY_LIMIT) {
            log.info("카페24 댓글 후보 조회가 상한에 도달: board={} 상한={} — 이 창의 일부만 확인됨",
                    boardNo, DISCOVERY_LIMIT);
        }
        return read(accessToken, mallId, boardNo, candidates, commented, MAX_COMMENT_READS);
    }

    /**
     * The same observation over an EXACT named set of articles, with no date window.
     *
     * <p><b>Why a second entry point rather than a wider window.</b> The routine form asks "which
     * articles in the last fortnight have comments?"; this one asks "which of THESE 25 have comments?"
     * The distinction is the whole bound: a historical backlog spanning eleven years cannot be reached
     * by a windowed discovery in one request (the contract caps a call at one year), and widening the
     * routine path to do it would put an eleven-year question on the sweep's critical path forever.
     *
     * <p>Requests: <b>1 + (candidates that have comments)</b>, ceiling
     * {@code 1 + }{@link #MAX_EXACT_COMMENT_READS}. Over-cap is a refusal, not a silent truncation —
     * a bounded run that quietly read fewer rows than its manifest named would report a "true"
     * unanswered count computed from a partial read.
     *
     * @throws IllegalArgumentException when more articles are named than the ceiling allows
     */
    public Map<Long, Instant> observeExact(String accessToken, String mallId, int boardNo,
                                           List<Long> candidates) {
        if (candidates == null || candidates.isEmpty()) {
            return Map.of();
        }
        if (candidates.size() > MAX_EXACT_COMMENT_READS) {
            throw new IllegalArgumentException("승인된 상한을 초과하는 대상 수입니다 ("
                    + candidates.size() + " > " + MAX_EXACT_COMMENT_READS + ").");
        }
        List<Long> commented =
                articles.fetchCommentedArticleNumbers(accessToken, mallId, boardNo, candidates);
        return read(accessToken, mallId, boardNo, new HashSet<>(candidates), commented,
                MAX_EXACT_COMMENT_READS);
    }

    /** The shared read: intersect, cap, fetch comments, and accept only proven shop authorship. */
    private Map<Long, Instant> read(String accessToken, String mallId, int boardNo,
                                    Set<Long> candidates, List<Long> commented, int maxReads) {
        // Order-stable intersection: only articles we were going to store as unanswered.
        List<Long> targets = new ArrayList<>();
        Set<Long> taken = new HashSet<>();
        for (Long articleNo : commented) {
            if (candidates.contains(articleNo) && taken.add(articleNo)) {
                targets.add(articleNo);
            }
        }
        int capped = 0;
        if (targets.size() > maxReads) {
            capped = targets.size() - maxReads;
            targets = targets.subList(0, maxReads);
        }

        Map<Long, Instant> answered = new LinkedHashMap<>();
        int unknownActor = 0;
        int unparseableDate = 0;
        for (Long articleNo : targets) {
            List<Cafe24BoardCommentRow> rows;
            try {
                rows = comments.fetchComments(accessToken, mallId, boardNo, articleNo);
            } catch (Cafe24RateLimitedException e) {
                log.info("카페24 댓글 답변 관측 중단: board={} 사유=RATE_LIMITED 확인완료={}",
                        boardNo, answered.size());
                break;
            } catch (RuntimeException e) {
                // One unreadable article must not lose the others; it simply stays 미답변.
                log.info("카페24 댓글 조회 실패 1건 건너뜀: board={}", boardNo);
                continue;
            }
            for (Cafe24BoardCommentRow row : rows) {
                if (!row.authoredByMall()) {
                    unknownActor++;
                    continue;
                }
                Instant at = Cafe24BoardArticleMapper.parseOffsetInstant(row.createdDate());
                if (at == null) {
                    // Proven author, unusable time. "Answered at an unknown moment" is not a fact
                    // this lane can state, so it states nothing.
                    unparseableDate++;
                    continue;
                }
                answered.merge(articleNo, at, (a, b) -> a.isBefore(b) ? a : b);
            }
        }
        if (!targets.isEmpty() || capped > 0) {
            // Counts only — never an article id, a comment, a member id, or a date.
            log.info("카페24 댓글 답변 관측: board={} 후보={} 댓글보유={} 조회={} 판매자답변확인={} "
                            + "작성자불명={} 시각해석불가={} 상한초과미조회={}",
                    boardNo, candidates.size(), commented.size(), targets.size(), answered.size(),
                    unknownActor, unparseableDate, capped);
        }
        return new HashMap<>(answered);
    }
}
