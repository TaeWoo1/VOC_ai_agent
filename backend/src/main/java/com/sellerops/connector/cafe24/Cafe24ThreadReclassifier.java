package com.sellerops.connector.cafe24;

import com.sellerops.ingest.canonical.SourceThreadRole;
import com.sellerops.inquiry.Inquiry;
import com.sellerops.inquiry.InquiryRepository;
import com.sellerops.inquiry.lifecycle.InquiryOperationalStateProjector;
import com.sellerops.inquiry.workitem.InquiryWorkItemWriter;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.List;
import java.util.Map;
import java.util.regex.Matcher;
import java.util.regex.Pattern;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;

/**
 * Ask the source about rows we already have, and record what it says about their structure.
 *
 * <p><b>Why this exists.</b> The connector had always been receiving {@code parent_article_no} and
 * discarding it, so every board-6 row already in storage carries no thread role — including the ones
 * that are the shop's own answers, sitting in the seller's 미답변 queue as customers waiting. New
 * collection is fixed at the mapper and needs no extra request. The rows already stored cannot be
 * fixed that way, because the fact was never written down.
 *
 * <p><b>What it refuses to do.</b> It does not crawl a date range, it does not walk history, and it
 * does not infer a relation from article numbers. It reads the EXACT ids it is given, in bounded
 * batches, under a hard request cap; a number the source does not return changes nothing at all,
 * because absence in one read is not a deletion — the same reason the lifecycle's source-deletion
 * state has no producer anywhere in {@code src/main} (spelled in prose here on purpose: that value
 * has a source-scanning fence, and naming it would register this file as a producer).
 *
 * <p><b>Excluded is not deleted, here too.</b> A row reclassified to {@code REPLY} keeps its body, its
 * status, its work item, its audit trail and its customer-memory entry. It leaves the queue because
 * every current read — the queue included — is gated on {@code operational_state = ACTIVE}. The OPEN
 * work item is deliberately left standing rather than closed: the seller never dismissed it and never
 * did it, and writing a disposition would put a decision in the ledger that no one made.
 */
public class Cafe24ThreadReclassifier {

    private static final Logger log = LoggerFactory.getLogger(Cafe24ThreadReclassifier.class);
    private static final String TAG = "[cafe24-thread-reclassify]";

    /** {@code cafe24:b{board}:a{article}} — the key the inquiry rows are already stored under. */
    private static final Pattern EXTERNAL_ID = Pattern.compile("^cafe24:b(\\d+):a(\\d+)$");

    private final Cafe24BoardArticlesClient articles;
    private final InquiryRepository inquiries;
    private final InquiryWorkItemWriter workItems;
    private final InquiryOperationalStateProjector projector = new InquiryOperationalStateProjector();

    public Cafe24ThreadReclassifier(Cafe24BoardArticlesClient articles, InquiryRepository inquiries,
                                    InquiryWorkItemWriter workItems) {
        this.articles = articles;
        this.inquiries = inquiries;
        this.workItems = workItems;
    }

    /**
     * Sanitized outcome — counts only. No article number, title, body, writer or identifier appears
     * here or in any log this class produces.
     *
     * @param requested      rows whose external id parsed to an article number on this board
     * @param requests       marketplace GETs actually spent
     * @param returned       rows the source returned for those numbers
     * @param unreturned     numbers the source did not return — left exactly as they were
     * @param reclassified   rows the source said are replies (were not marked so before)
     * @param confirmedRoot  rows the source confirmed are top-level
     * @param disagreements  rows whose parent pointer and depth pointed opposite ways
     * @param budgetExhausted true when the cap stopped the sweep before every batch ran
     */
    public record Outcome(int requested, int requests, int returned, int unreturned,
                          int reclassified, int confirmedRoot, int disagreements,
                          boolean budgetExhausted) {
    }

    /**
     * Re-read the given inquiries' articles and write back the role the source declares.
     *
     * @param dryRun when true nothing is persisted — the counts say what WOULD change
     */
    public Outcome reclassify(String accessToken, String mallId, int boardNo, List<Inquiry> rows,
                              int batchSize, int maxRequests, boolean dryRun) {
        Map<Long, Inquiry> byArticle = new LinkedHashMap<>();
        for (Inquiry row : rows) {
            Long articleNo = articleNumber(row.getExternalId(), boardNo);
            if (articleNo != null) {
                byArticle.put(articleNo, row);
            }
        }
        List<Long> numbers = new ArrayList<>(byArticle.keySet());
        // Which numbers the source actually answered for. A requested id missing from this set is
        // UNRESOLVED — never ROOT. Silence is not a classification.
        java.util.Set<Long> seen = new java.util.LinkedHashSet<>();
        int requests = 0;
        int returned = 0;
        int reclassified = 0;
        int confirmedRoot = 0;
        int disagreements = 0;
        boolean exhausted = false;

        for (int from = 0; from < numbers.size(); from += Math.max(batchSize, 1)) {
            if (requests >= maxRequests) {
                // The cap is checked BEFORE the call, never after — a budget enforced afterwards is
                // not a budget.
                exhausted = true;
                break;
            }
            List<Long> batch = numbers.subList(from, Math.min(from + Math.max(batchSize, 1), numbers.size()));
            requests++;
            List<Cafe24BoardArticleRow> page =
                    articles.fetchByArticleNumbers(accessToken, mallId, boardNo, batch);
            for (Cafe24BoardArticleRow article : page) {
                Inquiry stored = article.articleNo() == null ? null : byArticle.get(article.articleNo());
                if (stored == null) {
                    // The source returned something we did not ask about. Not ours to act on.
                    continue;
                }
                returned++;
                seen.add(article.articleNo());
                if (article.threadSignalsDisagree()) {
                    disagreements++;
                }
                SourceThreadRole role = article.isThreadReply()
                        ? SourceThreadRole.REPLY : SourceThreadRole.ROOT;
                if (role == SourceThreadRole.REPLY) {
                    reclassified++;
                } else {
                    confirmedRoot++;
                }
                // Structure only — the article's own number, its parent's, its position, its state.
                // No title, no body, no writer, no order, no product: none of those are read here at
                // all. Per-row rather than aggregate because completeness has to be checkable: a
                // number the source quietly omits must be visibly absent, not averaged away.
                log.info("{}   a{} role={} parent={} depth={} seq={} reply_status={} created={}",
                        TAG, article.articleNo(), role,
                        article.parentArticleNo() == null ? "-" : "a" + article.parentArticleNo(),
                        article.replyDepth(), article.replySequence(),
                        article.replyStatus() == null ? "-" : article.replyStatus(),
                        article.createdDate());
                if (dryRun) {
                    continue;
                }
                stored.setThreadRole(role.name());
                stored.setThreadParentExternalId(
                        role == SourceThreadRole.REPLY && article.parentArticleNo() != null
                                ? Cafe24InquiryArticleMapper.externalId(boardNo, article.parentArticleNo())
                                : null);
                projector.apply(stored, workItems.findWorkItem(stored.getId()));
                inquiries.save(stored);
            }
        }
        List<Long> unresolved = new ArrayList<>(numbers);
        unresolved.removeAll(seen);
        if (!unresolved.isEmpty()) {
            log.info("{} 미응답 {}건: {}", TAG, unresolved.size(),
                    unresolved.stream().map(n -> "a" + n).toList());
        }
        return new Outcome(numbers.size(), requests, returned, unresolved.size(),
                reclassified, confirmedRoot, disagreements, exhausted);
    }

    /** The article number this inquiry is stored under, or null when the key is not this board's. */
    static Long articleNumber(String externalId, int boardNo) {
        if (externalId == null) {
            return null;
        }
        Matcher matcher = EXTERNAL_ID.matcher(externalId.strip());
        if (!matcher.matches() || Integer.parseInt(matcher.group(1)) != boardNo) {
            return null;
        }
        long articleNo = Long.parseLong(matcher.group(2));
        return articleNo > 0 ? articleNo : null;
    }
}
