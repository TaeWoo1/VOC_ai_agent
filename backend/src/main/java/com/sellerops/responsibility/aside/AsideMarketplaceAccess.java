package com.sellerops.responsibility.aside;

import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * <b>Whether an unattended helper may point a browser at a real marketplace for this organisation and this
 * seller account.</b>
 *
 * <p>The loopback recipe's gate ({@code AsideSourceObserver#enabledFor}) asks one question — is this lane open
 * for this organisation. That was the right size for a surface Reviewnary serves itself. It is not the right
 * size here: this lane reads a seller's own store with their own authenticated session, so the deployment has to
 * name the <b>account</b> as well, and naming it is the act that says «this specific store may be read while
 * nobody is watching».
 *
 * <p>Four conditions, all required, none of them a default:
 *
 * <ul>
 *   <li>the recipe reads a marketplace at all ({@link AsideRecipe#readsMarketplace()}) — a loopback recipe never
 *   consults this gate, so turning this on widens nothing that was already running;</li>
 *   <li>the flag is on. Off is the shipped value;</li>
 *   <li>the organisation is named. Blank is nobody;</li>
 *   <li>the seller account is named. Blank is nobody.</li>
 * </ul>
 *
 * <p><b>There is no wildcard and a typo is fatal at boot, not silent.</b> Both are the same rule the loopback
 * gate states and for the same reason: {@code *} would mean «every seller's computer, every store», which is not
 * a thing a configuration value may say; and an unparsable id that quietly became «nobody» would read as «off»
 * while actually being a misconfiguration nobody was told about.
 */
@Component
public class AsideMarketplaceAccess {

    private final boolean enabled;
    private final Set<UUID> orgs;
    private final Set<UUID> accounts;

    /**
     * The configuration constructor, and the one the container uses.
     *
     * <p>Annotated because there are two: with more than one candidate and none marked, Spring falls back to
     * looking for a no-arg constructor and the context fails to start. Naming the injection point is also the
     * honest arrangement — the other constructor states the four conditions directly, for tests, and must never
     * become a way for the container to build this gate from something other than configuration.
     */
    @Autowired
    public AsideMarketplaceAccess(
            @Value("${sellerops.responsibility.aside.marketplace.enabled:false}") boolean enabled,
            @Value("${sellerops.responsibility.aside.marketplace.enabled-org-ids:}") String orgIds,
            @Value("${sellerops.responsibility.aside.marketplace.enabled-account-ids:}") String accountIds) {
        this.enabled = enabled;
        this.orgs = parse(orgIds, "enabled-org-ids");
        this.accounts = parse(accountIds, "enabled-account-ids");
    }

    /** Test seam: the same four conditions, stated directly. */
    public AsideMarketplaceAccess(boolean enabled, Set<UUID> orgs, Set<UUID> accounts) {
        this.enabled = enabled;
        this.orgs = Set.copyOf(orgs);
        this.accounts = Set.copyOf(accounts);
    }

    /**
     * Whether this organisation may have marketplace work queued for its helper at all.
     *
     * <p>A recipe that reads no marketplace is admitted unconditionally — this gate has no opinion about the
     * loopback lane, which has its own switch and its own list.
     */
    public boolean allows(AsideRecipe recipe, UUID orgId) {
        if (recipe == null || !recipe.readsMarketplace()) {
            return true;
        }
        return enabled && orgId != null && orgs.contains(orgId);
    }

    /** Whether this exact seller account is one the deployment named. Asked per account, never per channel. */
    public boolean allowsAccount(UUID sellerAccountId) {
        return enabled && sellerAccountId != null && accounts.contains(sellerAccountId);
    }

    private static Set<UUID> parse(String raw, String key) {
        if (raw == null || raw.isBlank()) {
            return Set.of();
        }
        Set<UUID> parsed = new LinkedHashSet<>();
        for (String token : raw.split(",")) {
            String trimmed = token.trim();
            if (trimmed.isEmpty()) {
                continue;
            }
            if ("*".equals(trimmed)) {
                throw new IllegalStateException(
                        "sellerops.responsibility.aside.marketplace." + key + "에 와일드카드는 쓸 수 없습니다.");
            }
            try {
                parsed.add(UUID.fromString(trimmed));
            } catch (IllegalArgumentException e) {
                throw new IllegalStateException(
                        "sellerops.responsibility.aside.marketplace." + key + " 값이 id 형식이 아닙니다.");
            }
        }
        return parsed;
    }
}
