package com.sellerops.auth.demo;

import org.springframework.beans.factory.annotation.Value;
import org.springframework.web.bind.annotation.GetMapping;
import org.springframework.web.bind.annotation.RequestMapping;
import org.springframework.web.bind.annotation.RestController;

/**
 * <b>Does this deployment have a demo account to open?</b> — `/api/auth/demo/config`, public
 * (Pilot Runtime Foundation v1 §2).
 *
 * <p>The login screen carries a 「데모 화면 보기」 entry that prefills the fixture account
 * `demo@sellerops.ai`. That is the right control on a deployment that seeded the fixture and a
 * pointer to somebody else's login on one that did not — and until now the screen had no way to
 * tell the two apart, because the shortcut was decided entirely in the browser.
 *
 * <p>This answers the one fact the screen needs, and only that fact: whether the demo entry is
 * exposed. It never returns a credential, an org, or a user — the frontend still prefills the same
 * literals it always did, and does so only when this says the deployment is a demo one. A
 * deployment that answers {@code false} therefore renders no way in, whether or not somebody knows
 * the address.
 *
 * <p>The value defaults to {@code sellerops.seed.enabled}: the deployment that creates the fixture
 * is the one that has an account for the shortcut to open. It can be set independently
 * ({@code SELLEROPS_SEED_DEMO_ENTRY}) for the case of a long-lived demo database whose fixture was
 * seeded on some earlier boot.
 */
@RestController
@RequestMapping("/api/auth/demo")
public class DemoEntryController {

    /** One boolean, and it is a statement about this deployment — never about an account. */
    public record DemoEntryView(boolean enabled) {
    }

    private final boolean enabled;

    public DemoEntryController(@Value("${sellerops.seed.demo-entry:false}") boolean enabled) {
        this.enabled = enabled;
    }

    @GetMapping("/config")
    public DemoEntryView config() {
        return new DemoEntryView(enabled);
    }
}
