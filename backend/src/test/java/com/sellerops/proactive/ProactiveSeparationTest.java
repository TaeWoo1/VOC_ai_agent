package com.sellerops.proactive;

import static org.assertj.core.api.Assertions.assertThat;

import com.sellerops.selfpilot.SelfPilotProperties;
import java.nio.file.Files;
import java.nio.file.Path;
import java.util.List;
import java.util.UUID;
import org.junit.jupiter.api.Test;

/**
 * <b>Keeping a seller's data fresh and having an agent prepare work are two decisions</b> — Pilot
 * Runtime Foundation v1 §8 / §15-F.
 *
 * <p>Routine marketplace acquisition is an ordinary Seller Operations capability: a seller connected
 * a channel and expects it to stay current. Proactive investigation spends the org's AI budget to
 * manufacture work before the seller looks for it. The first must not switch the second on, and the
 * scope that made routine collection reach every connected seller is exactly the change that could
 * have done so by accident.
 */
class ProactiveSeparationTest {

    private static final String REMOTE_DB = "jdbc:postgresql://db.internal.example:5432/sellerops";

    /** F — the widest routine scope leaves the proactive loop with no org at all. */
    @Test
    void connectedSellersScopeGivesTheProactiveLoopNothing() {
        SelfPilotProperties routine =
                new SelfPilotProperties(true, "CONNECTED_SELLERS", "", "", 60, false, 20, 50, REMOTE_DB);
        // Proactive's own list is the SOURCE and it is empty by default.
        ProactiveProperties proactive = new ProactiveProperties(false, 50, 200, 50, List.of());

        assertThat(proactive.enabled()).isFalse();
        assertThat(proactive.orgIds().stream().filter(routine::isEnabledFor).toList()).isEmpty();
    }

    /**
     * F — and even with the proactive flag on, an org only becomes a target by being NAMED. The
     * intersection can only narrow the named list; it can never widen it into "every connected org".
     */
    @Test
    void proactiveStillRequiresItsOwnExplicitOrgList() {
        SelfPilotProperties routine =
                new SelfPilotProperties(true, "CONNECTED_SELLERS", "", "", 60, false, 20, 50, REMOTE_DB);
        UUID named = UUID.randomUUID();
        ProactiveProperties none = new ProactiveProperties(true, 50, 200, 50, List.of());
        ProactiveProperties one = new ProactiveProperties(true, 50, 200, 50, List.of(named));

        assertThat(none.orgIds().stream().filter(routine::isEnabledFor).toList()).isEmpty();
        assertThat(one.orgIds().stream().filter(routine::isEnabledFor).toList()).containsExactly(named);
    }

    /** The loop does not exist at all unless its own flag says so — read off the source, not inferred. */
    @Test
    void theProactiveSchedulerBeanIsGatedOnItsOwnFlag() throws Exception {
        String source = Files.readString(
                Path.of("src/main/java/com/sellerops/proactive/ProactiveScheduler.java"));
        assertThat(source).contains(
                "@ConditionalOnProperty(name = \"sellerops.proactive.enabled\", havingValue = \"true\")");
    }

    /** And the shipped default of that flag is off. */
    @Test
    void theShippedDefaultIsOff() throws Exception {
        String yml = Files.readString(Path.of("src/main/resources/application.yml"));
        assertThat(yml).contains("enabled: ${SELLEROPS_PROACTIVE_ENABLED:false}");
        assertThat(yml).contains("enabled: ${SELLEROPS_SELF_PILOT_ENABLED:false}");
    }
}
