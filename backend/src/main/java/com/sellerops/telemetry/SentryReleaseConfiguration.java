package com.sellerops.telemetry;

import io.sentry.Sentry;
import io.sentry.SentryOptions;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.beans.factory.ObjectProvider;
import org.springframework.boot.info.BuildProperties;
import org.springframework.context.annotation.Bean;
import org.springframework.context.annotation.Configuration;

/**
 * Sentry `release` = `SELLEROPS_RELEASE` when set, else the git SHA the build recorded (`build.git`,
 * build.gradle), else `unknown` (docs/service_readiness_v1.md §2-7). Applied only when Sentry initialises (a DSN
 * exists); the bean itself is inert otherwise.
 */
@Configuration
public class SentryReleaseConfiguration {

    private static final Logger log = LoggerFactory.getLogger(SentryReleaseConfiguration.class);

    @Bean
    public Sentry.OptionsConfiguration<SentryOptions> sentryReleaseFromBuild(ObjectProvider<BuildProperties> build) {
        return options -> {
            String release = options.getRelease();
            if (release == null || release.isBlank()) {
                BuildProperties props = build.getIfAvailable();
                String git = props == null ? null : props.get("git");
                options.setRelease(git == null || git.isBlank() ? "unknown" : "sellerops-backend@" + git);
            }
            // Operator evidence that monitoring is on (labels only — never the DSN).
            log.info("sentry: enabled environment={} release={} tracesSampleRate={}",
                    options.getEnvironment(), options.getRelease(), options.getTracesSampleRate());
        };
    }
}
