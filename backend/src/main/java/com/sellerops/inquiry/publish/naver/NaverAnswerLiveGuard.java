package com.sellerops.inquiry.publish.naver;

import java.net.URI;
import java.util.Locale;
import java.util.Set;

/**
 * The interlock that keeps a NAVER answer from reaching a real store without an armed live-run
 * approval id.
 *
 * <p>The same rule the Coupang write already runs under ({@code CoupangLiveCallGuard}), restated for
 * this transport rather than shared, because the two read their approval id from different
 * configuration keys and a shared class would need to know both. It is the code half of
 * {@code docs/sellerops_live_approval_contract.md}: an approval id is an ENVIRONMENT-binding token,
 * never a credential, and its absence must look like an unarmed deployment rather than like NAVER
 * refusing the seller.
 *
 * <p><b>Fail closed.</b> A loopback / {@code *.test} / {@code *.local} base URL is the offline unit
 * shape and needs nothing. Every other host — including an un-parseable base URL, which is not
 * evidence of anything — requires a non-blank {@code sellerops.inquiry.publish.naver.live-approval-id}
 * or the call throws before a byte leaves the process.
 */
public final class NaverAnswerLiveGuard {

    private NaverAnswerLiveGuard() {
    }

    private static final Set<String> LOOPBACK_HOSTS = Set.of("localhost", "127.0.0.1", "::1", "[::1]");

    static boolean isOfflineHost(String baseUrl) {
        String host = hostOf(baseUrl);
        if (host == null || host.isBlank()) {
            return false;
        }
        host = host.toLowerCase(Locale.ROOT);
        return LOOPBACK_HOSTS.contains(host)
                || host.endsWith(".localhost") || host.endsWith(".test") || host.endsWith(".local");
    }

    /** Throws unless this write is either offline or covered by an armed approval id. */
    public static void ensureLiveWriteAllowed(String baseUrl, String liveApprovalId) {
        if (isOfflineHost(baseUrl)) {
            return;
        }
        if (liveApprovalId == null || liveApprovalId.isBlank()) {
            throw new NaverAnswerLiveApprovalRequired();
        }
    }

    private static String hostOf(String baseUrl) {
        if (baseUrl == null || baseUrl.isBlank()) {
            return null;
        }
        try {
            return URI.create(baseUrl.trim()).getHost();
        } catch (Exception unparseable) {
            return null;
        }
    }
}
