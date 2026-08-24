package com.sellerops.inquiry.publish.naver;

import com.sellerops.connector.naver.NaverInquiryCursor;
import com.sellerops.connector.naver.NaverInquiryPage;
import com.sellerops.ingest.canonical.CanonicalInquiry;
import java.time.Duration;
import java.time.Instant;

/**
 * Whether ONE NAVER inquiry now carries an answer — read from the channel, at send time.
 *
 * <p><b>Why paging, and not a lookup.</b> Neither 문의 resource exposes a read by id: the only reads
 * NAVER publishes are the windowed list endpoints the routine sweep already uses. So verification
 * re-opens the window the inquiry lives in and looks for its own external id. That is more work than
 * a lookup and it is the only honest answer available; inventing a by-id path would be inventing an
 * endpoint.
 *
 * <p><b>Bounded on purpose.</b> At most {@link #MAX_PAGES} pages, from a window that starts shortly
 * before the inquiry arrived. A verification that pages a month of history to prove one row would
 * spend a seller's rate limit on a question that has a cheaper wrong answer, and "not found" here is
 * never read as "not answered" — it is read as "not verifiable", which is a different result.
 */
public class NaverAnsweredStateReader {

    /** How far before the inquiry's own timestamp the read window opens. */
    static final Duration WINDOW_LEAD = Duration.ofHours(1);

    /** How far past now the window closes — NAVER's windows are inclusive of the present moment. */
    static final Duration WINDOW_TRAIL = Duration.ofMinutes(1);

    /** A hard page bound, so one verification cannot become a sweep. */
    static final int MAX_PAGES = 10;

    /** One resource's windowed read, as a function. Both NAVER inquiry clients already are one. */
    @FunctionalInterface
    public interface PageReader {
        NaverInquiryPage fetchPage(String accessToken, NaverInquiryCursor.Lane lane);
    }

    /** What a re-read could establish about one inquiry. */
    public enum State {
        /** The channel says this inquiry now carries an answer. */
        ANSWERED,
        /** The channel returned the inquiry and it carries no answer. */
        UNANSWERED,
        /** The row was not in the window, or the read failed. Never treated as either of the above. */
        UNVERIFIABLE
    }

    private NaverAnsweredStateReader() {
    }

    /**
     * Look for {@code externalId} in this resource's window around {@code receivedAt}.
     *
     * @param source {@link NaverInquiryCursor#SOURCE_PRODUCT_QNA} or
     *               {@link NaverInquiryCursor#SOURCE_CUSTOMER} — they take different window shapes
     */
    public static State read(PageReader reader, String accessToken, String source,
                             String externalId, Instant receivedAt, Instant now) {
        if (externalId == null || receivedAt == null) {
            return State.UNVERIFIABLE;
        }
        NaverInquiryCursor.Lane lane = NaverInquiryCursor.readWindow(
                receivedAt.minus(WINDOW_LEAD), now.plus(WINDOW_TRAIL), source);
        try {
            for (int page = 0; page < MAX_PAGES; page++) {
                NaverInquiryPage read = reader.fetchPage(accessToken, lane);
                for (CanonicalInquiry row : read.rows()) {
                    if (externalId.equals(row.externalId())) {
                        return "ANSWERED".equals(row.status()) ? State.ANSWERED : State.UNANSWERED;
                    }
                }
                if (read.last() || read.rows().isEmpty()) {
                    break;
                }
                lane = new NaverInquiryCursor.Lane(lane.from(), lane.to(), lane.page() + 1, false);
            }
        } catch (RuntimeException unreadable) {
            // A read that could not run has disproved nothing — rate limit, expired token, a
            // permission the seller has to grant. The caller must not turn this into "unanswered".
            return State.UNVERIFIABLE;
        }
        return State.UNVERIFIABLE;
    }
}
