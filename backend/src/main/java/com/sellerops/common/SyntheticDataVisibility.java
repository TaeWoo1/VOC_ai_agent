package com.sellerops.common;

import java.util.function.Supplier;
import org.springframework.beans.factory.annotation.Autowired;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.stereotype.Component;

/**
 * Whether synthetic rows are visible to ordinary reads — resolved once at boot, read by Hibernate on
 * every session.
 *
 * <p>Bound to the same flag that decides whether synthetic content is ever <i>written</i>
 * ({@code sellerops.seed.demo-content}). One switch for both halves, because the alternative — seeding
 * demo content and then hiding it, or hiding data a deployment deliberately created — is a
 * configuration that means nothing. A demo deployment shows its demo data; every other deployment
 * reads only the seller's own.
 *
 * <p>The static handoff is Hibernate's requirement, not a preference: {@code @ParamDef}
 * instantiates its resolver directly, outside the Spring context, so the value has to be parked
 * somewhere reachable without injection. It is written once during bean construction and only ever
 * read afterwards.
 */
@Component
public class SyntheticDataVisibility implements Supplier<Boolean> {

    /** Defaults to hidden, so a context that never configured this reads real data only. */
    private static volatile boolean visible = false;

    @Autowired
    public SyntheticDataVisibility(
            @Value("${sellerops.seed.demo-content:false}") boolean demoContentEnabled) {
        visible = demoContentEnabled;
    }

    /**
     * No-arg constructor for Hibernate, which instantiates the resolver itself and cannot inject.
     * Spring must NOT choose this one — without {@code @Autowired} above marking the real one, it
     * silently would, and the configured value would never reach the filter at all.
     */
    public SyntheticDataVisibility() {
    }

    @Override
    public Boolean get() {
        return visible;
    }

    /** What the current deployment shows. For diagnostics and tests. */
    public static boolean syntheticVisible() {
        return visible;
    }

    /**
     * Test-only override. Production visibility is decided by configuration at boot; a test that
     * needs both sides of the switch has no other way to reach it.
     */
    public static void overrideForTest(boolean value) {
        visible = value;
    }
}
