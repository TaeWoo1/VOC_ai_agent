package com.sellerops.inquiry.goal;

import com.sellerops.agent.llm.AgentLlmTransport;
import com.sellerops.agent.llm.JdkAgentLlmTransport;
import java.net.URI;
import java.util.Map;
import java.util.concurrent.atomic.AtomicInteger;

/**
 * <b>Which transport a run uses, and why that is part of the approval</b> (Inquiry v3.5 §23.10).
 *
 * <p>The live approval contract §4 already answers the question this class exists to ask: <i>"a change of the
 * execution TOOL (CLI/driver) ⇒ the existing manifest is immediately REVOKED. The tool is part of the manifest; you
 * cannot approve one tool and run another."</i> A rehearsal against a deterministic fake and a run against a vendor
 * are two different tools, so {@code transport} is a <b>bound field</b> — the fifteenth — and not a flag beside the
 * approval. A manifest prepared for {@link Mode#FAKE} cannot drive a {@link Mode#REAL} run, and the reverse, because
 * {@link GoalRunGuard} compares the mode like it compares the commit.
 *
 * <p>That is the whole safety argument. Without it, a rehearsal manifest is a REAL manifest with a note on it, and a
 * note is exactly what this harness spent two packages establishing cannot authorize anything.
 *
 * <h2>REAL is the default, and FAKE cannot reach a network</h2>
 *
 * <p>{@link #mode} answers {@link Mode#REAL} for an unset variable, a blank one, and anything that is not the exact
 * token {@code FAKE} — a misspelling selects the mode that spends nothing it was not approved to spend only because
 * it also cannot start without an approval, so the default is the one that is refused rather than the one that runs.
 *
 * <p>In {@link Mode#FAKE} the endpoint is <b>not read from the environment at all</b>: it is the constant
 * {@link #FAKE_ENDPOINT}, whose scheme no HTTP client will dial. A rehearsal therefore cannot be pointed at a vendor
 * by a stale variable, which is a stronger claim than "we passed it a fake object".
 */
public final class GoalTransport {

    /** Test-only, and explicit. Absent or anything but {@code FAKE} means {@link Mode#REAL}. */
    public static final String MODE_ENV = "SELLEROPS_INQUIRY_GOAL_TRANSPORT";

    /**
     * Rehearsal only: halt the process hard after this many answers, to prove what survives (§23.10).
     * {@link Runtime#halt} rather than an exception, because an exception unwinds and flushes and would prove the
     * durability of a tidy shutdown instead of the durability of a kill.
     */
    public static final String DIE_AFTER_ENV = "SELLEROPS_INQUIRY_GOAL_FAKE_DIE_AFTER";

    /** Not a network address. The fake never dials anything, and this is how that is structural rather than said. */
    public static final URI FAKE_ENDPOINT = URI.create("fake://goal-smoke-rehearsal/no-network");

    /**
     * One deterministic, schema-legal answer, returned to every request.
     *
     * <p>It is <b>not</b> an imitation of a model and not drawn from the gold: a rehearsal that fed the scorer the
     * right answers would be measuring the fixture. What the fake has to exercise is the path — parse, contract
     * construction, row derivation, scoring, storage — and the smallest valid goal set does all of it.
     */
    public static final String FAKE_ANSWER =
            "{\"goals\":[{\"id\":\"g1\",\"explicit_request\":\"REHEARSAL — deterministic fake transport\","
                    + "\"requested_outcome\":\"INFORMATION\",\"subject\":\"CURRENT_LISTING\",\"basis\":\"STATED\","
                    + "\"explicit_constraints\":[]}],\"relations\":[]}";

    public enum Mode { REAL, FAKE }

    private GoalTransport() {
    }

    /** {@link Mode#REAL} unless the environment says the exact token {@code FAKE}. */
    public static Mode mode(Map<String, String> env) {
        String raw = env == null ? null : env.get(MODE_ENV);
        return "FAKE".equals(raw == null ? null : raw.trim()) ? Mode.FAKE : Mode.REAL;
    }

    /**
     * Where this mode sends. REAL demands the operator's endpoint and refuses without one; FAKE ignores whatever the
     * environment says and uses {@link #FAKE_ENDPOINT}.
     *
     * @throws CustomerGoalRunner.Refused when REAL has no endpoint — before anything is constructed, so zero sends
     */
    public static URI endpoint(Mode mode, Map<String, String> env) {
        if (mode == Mode.FAKE) {
            return FAKE_ENDPOINT;
        }
        String endpoint = env == null ? null : env.get(GoalRunLauncher.ENDPOINT_ENV);
        if (endpoint == null || endpoint.isBlank()) {
            throw new CustomerGoalRunner.Refused(java.util.List.of("ENV_MISSING:" + GoalRunLauncher.ENDPOINT_ENV));
        }
        return URI.create(endpoint);
    }

    /** The transport itself: the real JDK client, or the deterministic fake. */
    public static AgentLlmTransport of(Mode mode, Map<String, String> env) {
        return mode == Mode.FAKE ? new Fake(dieAfter(env)) : new JdkAgentLlmTransport();
    }

    /**
     * The mode of the transport a run is <b>actually holding</b>, which is what the guard compares.
     *
     * <p>Asked of the object rather than of a parameter beside it on purpose: a field saying "this is a real run"
     * can disagree with the thing that does the sending, and the disagreement would favour the rehearsal. Only the
     * fake answers {@link Mode#FAKE}; everything else, including a transport a unit test wrote, is {@code REAL} —
     * the direction that gets refused by a rehearsal manifest rather than admitted by a real one.
     */
    public static String modeOf(AgentLlmTransport transport) {
        return transport instanceof Fake ? Mode.FAKE.name() : Mode.REAL.name();
    }

    private static int dieAfter(Map<String, String> env) {
        String raw = env == null ? null : env.get(DIE_AFTER_ENV);
        if (raw == null || raw.isBlank()) {
            return -1;
        }
        try {
            return Integer.parseInt(raw.trim());
        } catch (NumberFormatException e) {
            return -1;
        }
    }

    /**
     * The rehearsal's vendor. Every request gets the same legal answer in the same envelope shape a vendor uses, so
     * the run reaches the parser, the contract and the scorer by the ordinary road rather than a shortcut past them.
     */
    static final class Fake implements AgentLlmTransport {

        private final AtomicInteger answered = new AtomicInteger();
        private final int dieAfter;

        Fake(int dieAfter) {
            this.dieAfter = dieAfter;
        }

        @Override
        public Response post(URI uri, Map<String, String> headers, String body) {
            if (!FAKE_ENDPOINT.equals(uri)) {
                // Belt and braces: the fake refuses to pretend to be a real address, so a wiring mistake that
                // handed it the operator's endpoint fails loudly instead of producing plausible rehearsal rows.
                throw new IllegalStateException("the fake transport was aimed at " + uri);
            }
            int n = answered.incrementAndGet();
            if (dieAfter > 0 && n > dieAfter) {
                // A kill, not a throw: no unwinding, no finally, no flush. What is on disk is what a crash leaves.
                Runtime.getRuntime().halt(137);
            }
            return new Response(200, envelope(), 1L);
        }

        private static String envelope() {
            return "{\"choices\":[{\"finish_reason\":\"stop\",\"message\":{\"content\":"
                    + quote(FAKE_ANSWER) + "}}]}";
        }

        private static String quote(String s) {
            StringBuilder out = new StringBuilder("\"");
            for (char c : s.toCharArray()) {
                if (c == '"' || c == '\\') {
                    out.append('\\');
                }
                out.append(c);
            }
            return out.append('"').toString();
        }
    }
}
