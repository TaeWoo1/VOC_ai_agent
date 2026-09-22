package com.sellerops.preflight;

import com.fasterxml.jackson.databind.ObjectMapper;
import com.sellerops.channel.ChannelRepository;
import com.sellerops.config.PilotConfigValidator;
import com.sellerops.connector.ConnectorRegistry;
import com.sellerops.responsibility.ResponsibilitySources;
import com.sellerops.selleraccount.SellerAccountRepository;
import java.time.Clock;
import org.springframework.beans.factory.annotation.Value;
import org.springframework.boot.autoconfigure.condition.ConditionalOnProperty;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Wires the REAL API read preflight — only when {@code sellerops.preflight.api-read.approval-id} is set. An
 * ordinary boot has no such property and no such bean: nothing here can reach a marketplace by default.
 */
@Configuration
@ConditionalOnProperty(name = "sellerops.preflight.api-read.approval-id")
public class ApiReadPreflightConfiguration {

    @Bean
    ApiReadPreflightRunner apiReadPreflightRunner(
            ConnectorRegistry registry, SellerAccountRepository accounts, ChannelRepository channels,
            ResponsibilitySources sources, ObjectMapper json, PilotConfigValidator validator,
            @Value("${sellerops.preflight.api-read.approval-id}") String approvalId,
            @Value("${sellerops.preflight.api-read.org-id:}") String orgId,
            @Value("${sellerops.preflight.api-read.days:7}") int days,
            @Value("${sellerops.preflight.api-read.limit:50}") int limit,
            @Value("${sellerops.preflight.api-read.output:}") String output,
            @Value("${sellerops.collect.scheduler-enabled:false}") boolean collectScheduler,
            @Value("${sellerops.responsibility.scheduler-enabled:false}") boolean responsibilityScheduler,
            @Value("${sellerops.self-pilot.enabled:false}") boolean selfPilot,
            @Value("${sellerops.proactive.enabled:false}") boolean proactive) {
        ApiReadPreflight preflight = new ApiReadPreflight(registry, accounts, channels, sources, Clock.systemUTC());
        return new ApiReadPreflightRunner(preflight, approvalId, orgId, days, limit, output,
                collectScheduler || responsibilityScheduler || selfPilot || proactive, validator::passed, json);
    }
}
