package com.sellerops.collect;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;
import static org.mockito.Mockito.when;

import com.sellerops.collect.dto.CollectionPostureView;
import com.sellerops.proactive.ProactiveScheduler;
import com.sellerops.selfpilot.SelfPilotProperties;
import org.junit.jupiter.api.Test;
import org.springframework.beans.factory.ObjectProvider;

/**
 * <b>Does this deployment collect on its own — the runtime layer of a 「자동」 sentence.</b>
 *
 * <p>Three different facts were being answered by one word. A channel's connector can serve a data
 * type on a schedule (a CHANNEL capability); a deployment may or may not be running the scheduler that
 * would tick it (this); and a seller may or may not have connected the channel and had a routine
 * schedule provisioned ({@code ChannelCoverageRow.routineEnabled}). Only the third was readable, and it
 * reports an enabled schedule ROW — which stays true in a process whose {@code SyncScheduler} bean does
 * not exist. That is the combination the machine running this QA is in, and it is how
 * 「정기적으로 다시 확인하고 있어」 could be said while nothing ticked.
 *
 * <p>The answer is BEAN PRESENCE rather than a re-read of the flag: the bean is what actually ticks,
 * and it is created by the condition rather than by anyone reading the property a second time.
 */
class CollectionPostureControllerTest {

    @SuppressWarnings("unchecked")
    private static ObjectProvider<SyncScheduler> scheduler(boolean present) {
        ObjectProvider<SyncScheduler> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(present ? mock(SyncScheduler.class) : null);
        return provider;
    }

    @SuppressWarnings("unchecked")
    private static ObjectProvider<ProactiveScheduler> proactive(boolean present) {
        ObjectProvider<ProactiveScheduler> provider = mock(ObjectProvider.class);
        when(provider.getIfAvailable()).thenReturn(present ? mock(ProactiveScheduler.class) : null);
        return provider;
    }

    private static SelfPilotProperties selfPilot(boolean enabled) {
        SelfPilotProperties props = mock(SelfPilotProperties.class);
        when(props.enabled()).thenReturn(enabled);
        return props;
    }

    @Test
    void aDeploymentWithNoSchedulerBeanReportsThatNothingTicks() {
        CollectionPostureView view =
                new CollectionPostureController(scheduler(false), proactive(false), selfPilot(false)).posture();

        assertThat(view.schedulerRunning()).isFalse();
        assertThat(view.routineProvisioning()).isFalse();
        assertThat(view.proactiveRunning()).isFalse();
    }

    @Test
    void aDeploymentThatRunsBothReportsBoth() {
        CollectionPostureView view =
                new CollectionPostureController(scheduler(true), proactive(true), selfPilot(true)).posture();

        assertThat(view.schedulerRunning()).isTrue();
        assertThat(view.routineProvisioning()).isTrue();
        assertThat(view.proactiveRunning()).isTrue();
    }

    @Test
    void theTwoSwitchesAreSeparateFactsAndNeitherStandsInForTheOther() {
        // Provisioning creates a schedule; the scheduler ticks it. A deployment with schedules and no
        // scheduler collects nothing, and a deployment with a scheduler and no provisioning never gets
        // a schedule for a newly connected account. Folding them into one boolean loses one of those.
        assertThat(new CollectionPostureController(scheduler(true), proactive(false), selfPilot(false)).posture())
                .isEqualTo(new CollectionPostureView(true, false, false));
        assertThat(new CollectionPostureController(scheduler(false), proactive(false), selfPilot(true)).posture())
                .isEqualTo(new CollectionPostureView(false, true, false));
    }
}
