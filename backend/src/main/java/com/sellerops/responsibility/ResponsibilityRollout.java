package com.sellerops.responsibility;

import java.util.Arrays;
import java.util.Collection;
import java.util.LinkedHashSet;
import java.util.Set;
import java.util.UUID;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * <b>Which organisations this deployment runs the responsibility runtime for</b> — the rollout half of the two
 * conditions a run needs (product-owner decision, Package B §1-2).
 *
 * <p>A seller accepting «고객 운영 관리» is necessary and not sufficient: the runtime works a window only for an
 * organisation named in {@code RESPONSIBILITY_RUNTIME_ORG_IDS} AND whose responsibility is ACTIVE. The list is
 * explicit UUIDs — the QA organisation and the first pilot organisation — and nothing else:
 *
 * <ul>
 *   <li><b>Blank means nobody</b>, never everybody. An unset deployment runs no one's job.</li>
 *   <li><b>No wildcard, no policy.</b> Not {@code *}, not «connected sellers»: this is a rollout of a job that makes
 *   model calls and sends mail while nobody is looking, and an operator names each organisation it is opened for.
 *   It is deliberately not a generic entitlement mechanism.</li>
 *   <li><b>A typo refuses to boot.</b> A misspelled UUID silently dropping an organisation would be a pilot whose job
 *   never starts with nothing saying why.</li>
 * </ul>
 */
@Component
public class ResponsibilityRollout {

    static final String ENV = "RESPONSIBILITY_RUNTIME_ORG_IDS";

    private final Set<UUID> orgIds;

    @Autowired
    public ResponsibilityRollout(@Value("${sellerops.responsibility.runtime-org-ids:}") String csv) {
        this(parse(csv));
    }

    private ResponsibilityRollout(Set<UUID> orgIds) {
        this.orgIds = Set.copyOf(orgIds);
    }

    public static ResponsibilityRollout of(Collection<UUID> orgIds) {
        return new ResponsibilityRollout(new LinkedHashSet<>(orgIds));
    }

    public boolean allows(UUID orgId) {
        return orgId != null && orgIds.contains(orgId);
    }

    public Set<UUID> orgIds() {
        return orgIds;
    }

    private static Set<UUID> parse(String csv) {
        Set<UUID> ids = new LinkedHashSet<>();
        if (csv == null || csv.isBlank()) {
            return ids;
        }
        for (String raw : Arrays.stream(csv.split(",")).map(String::trim).filter(s -> !s.isEmpty()).toList()) {
            try {
                ids.add(UUID.fromString(raw));
            } catch (IllegalArgumentException e) {
                throw new IllegalStateException(ENV + " — 조직 ID 형식이 아닌 값이 있습니다. "
                        + "쉼표로 구분한 조직 UUID만 쓸 수 있습니다.");
            }
        }
        return ids;
    }
}
