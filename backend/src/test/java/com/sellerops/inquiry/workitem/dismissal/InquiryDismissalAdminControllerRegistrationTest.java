package com.sellerops.inquiry.workitem.dismissal;

import static org.assertj.core.api.Assertions.assertThat;
import static org.mockito.Mockito.mock;

import com.sellerops.user.UserRepository;
import org.junit.jupiter.api.Test;
import org.springframework.boot.test.context.runner.ApplicationContextRunner;

/**
 * Feature-flag behavior for the admin dismissal endpoints. The controller carries
 * {@code @ConditionalOnProperty(sellerops.admin.inquiry-dismissal.enabled=true)}, so
 * with the flag off (the default) the bean — and therefore both {@code
 * /api/admin/inquiry-dismissals/*} routes — does not exist at all. This is proven
 * with {@link ApplicationContextRunner} (no web boot needed): a missing controller
 * bean means the routes are unmapped (404), never merely unsecured.
 */
class InquiryDismissalAdminControllerRegistrationTest {

    private final ApplicationContextRunner runner = new ApplicationContextRunner()
            .withBean(InquiryWorkItemDismissalService.class,
                    () -> mock(InquiryWorkItemDismissalService.class))
            .withBean(UserRepository.class, () -> mock(UserRepository.class))
            .withUserConfiguration(InquiryDismissalAdminController.class);

    @Test
    void controllerAbsentByDefault() {
        runner.run(ctx -> assertThat(ctx).doesNotHaveBean(InquiryDismissalAdminController.class));
    }

    @Test
    void controllerAbsentWhenFlagExplicitlyFalse() {
        runner.withPropertyValues("sellerops.admin.inquiry-dismissal.enabled=false")
                .run(ctx -> assertThat(ctx).doesNotHaveBean(InquiryDismissalAdminController.class));
    }

    @Test
    void controllerPresentOnlyWhenFlagTrue() {
        runner.withPropertyValues("sellerops.admin.inquiry-dismissal.enabled=true")
                .run(ctx -> assertThat(ctx).hasSingleBean(InquiryDismissalAdminController.class));
    }
}
