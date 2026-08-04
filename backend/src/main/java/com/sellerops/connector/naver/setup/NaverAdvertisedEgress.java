package com.sellerops.connector.naver.setup;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The fixed public egress IPv4(s) the backend makes NAVER API calls from — the value a seller must
 * register in their app's 'API 호출 IP'. This is a <b>deployment-global</b> fact (the same for every
 * org), not account-scoped state, so it is held here once and served by the setup endpoint before any
 * account exists.
 *
 * <p><b>Not a secret, never fabricated.</b> The value is one a seller registers publicly, so surfacing
 * it is safe. It is injected ONLY from configuration ({@code SELLEROPS_CONNECTOR_NAVER_ADVERTISED_EGRESS_IPS},
 * default empty) — no real IP is committed — and sanitized once at startup: trimmed, IPv4-validated,
 * de-duplicated, and capped at NAVER's 3-IP-per-app limit. An absent/empty/all-invalid value yields an
 * empty list, which the UI treats as "not yet advertised" and shows generic guidance rather than a
 * fabricated IP.
 */
@Component
public class NaverAdvertisedEgress {

    /** NAVER caps an app's 'API 호출 IP' registrations at 3. */
    private static final int MAX_IPS = 3;
    /** Dotted IPv4, each octet 0–255 — a shape check so misconfigured junk never surfaces. */
    private static final Pattern IPV4 = Pattern.compile(
            "^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$");

    private final List<String> ips;

    public NaverAdvertisedEgress(
            @Value("${sellerops.connector.naver.advertised-egress-ips:}") String advertisedEgressIpsRaw) {
        this.ips = sanitize(advertisedEgressIpsRaw);
    }

    /** The sanitized advertised egress IPv4(s); empty when none is configured (never null). */
    public List<String> ips() {
        return ips;
    }

    static List<String> sanitize(String raw) {
        if (raw == null || raw.isBlank()) {
            return List.of();
        }
        List<String> out = new ArrayList<>();
        for (String part : raw.split(",")) {
            String ip = part.trim();
            if (!ip.isEmpty() && IPV4.matcher(ip).matches() && !out.contains(ip)) {
                out.add(ip);
                if (out.size() == MAX_IPS) {
                    break;
                }
            }
        }
        return List.copyOf(out);
    }
}
