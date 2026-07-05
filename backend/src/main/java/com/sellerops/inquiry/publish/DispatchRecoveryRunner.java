package com.sellerops.inquiry.publish;

import org.springframework.boot.ApplicationArguments;
import org.springframework.boot.ApplicationRunner;
import org.springframework.stereotype.Component;

/**
 * On startup, reclassify any execution left in {@link InquiryExecutionStatus#DISPATCHING}
 * (a process crashed mid-POST) to {@link InquiryExecutionStatus#DELIVERY_UNKNOWN}. It
 * NEVER resends — the delivery is ambiguous, so the next resume/verify must re-query
 * {@code informStatus} first. Reclassify-only; safe to run every boot.
 */
@Component
public class DispatchRecoveryRunner implements ApplicationRunner {

    private final InquiryPublishService publish;

    public DispatchRecoveryRunner(InquiryPublishService publish) {
        this.publish = publish;
    }

    @Override
    public void run(ApplicationArguments args) {
        publish.recoverAbandonedDispatching();
    }
}
