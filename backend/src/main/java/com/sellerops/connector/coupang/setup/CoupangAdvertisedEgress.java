package com.sellerops.connector.coupang.setup;

import java.util.ArrayList;
import java.util.List;
import java.util.regex.Pattern;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * The fixed public egress IPv4(s) the backend makes Coupang API calls from — the value a seller
 * must register in their Coupang app's calling-IP allowlist. This is a <b>deployment-global</b>
 * fact (the same for every org), not account-scoped state, so it is held here once and served by
 * the setup endpoint before any account exists.
 *
 * <p><b>Not a secret, never fabricated.</b> The value is one a seller registers publicly, so
 * surfacing it is safe. It is injected ONLY from configuration
 * ({@code SELLEROPS_CONNECTOR_COUPANG_ADVERTISED_EGRESS_IPS}, default empty) — no real IP is
 * committed — and sanitized once at startup: trimmed, IPv4-validated, de-duplicated, and capped.
 * An absent/empty/all-invalid value yields an empty list, which the UI treats as "not yet
 * advertised" and shows generic guidance rather than a fabricated IP.
 *
 * <p>Coupang lets a seller register up to 20 calling IPs, but our deployment egress is a small
 * fixed set; the {@link #MAX_IPS} cap reflects that (aligned with the fixed-egress deployment
 * decision), never the seller-side registration ceiling.
 */
@Component
public class CoupangAdvertisedEgress {

    /** Our fixed deployment egress is small; cap defensively so misconfigured junk never floods. */
    private static final int MAX_IPS = 3;
    /** Dotted IPv4, each octet 0–255 — a shape check so misconfigured junk never surfaces. */
    private static final Pattern IPV4 = Pattern.compile(
            "^(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)(\\.(25[0-5]|2[0-4]\\d|1\\d\\d|[1-9]?\\d)){3}$");

    private final List<String> ips;

    public CoupangAdvertisedEgress(
            @Value("${sellerops.connector.coupang.advertised-egress-ips:}") String advertisedEgressIpsRaw) {
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
