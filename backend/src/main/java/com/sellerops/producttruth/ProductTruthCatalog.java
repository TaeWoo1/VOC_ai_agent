package com.sellerops.producttruth;

import com.sellerops.producttruth.dto.ProductTruthView;
import java.util.List;
import org.slf4j.Logger;
import org.slf4j.LoggerFactory;
import org.springframework.stereotype.Component;

/**
 * The one place the canonical ledger becomes readable at runtime.
 *
 * <p><b>Loaded lazily, on purpose.</b> {@link ProductTruthPack} was deliberately not a bean so that a
 * malformed file would fail the build rather than a deployment, and that property is kept here: the
 * first request loads it, a failure is logged once and answered with an empty view, and startup never
 * depends on it. The build still refuses a broken ledger — {@code ProductTruthPackTest} loads it — so
 * the fail-fast is where it was, not in a running process.
 *
 * <p><b>An empty view is not a fallback to guessing.</b> It means the Agent's canonical selection finds
 * nothing and the conversation lane keeps the facts it derives from live reads. Product truth going
 * missing costs breadth, never correctness.
 */
@Component
public class ProductTruthCatalog {

    private static final Logger log = LoggerFactory.getLogger(ProductTruthCatalog.class);

    private static final ProductTruthView EMPTY = new ProductTruthView(
            List.of(), List.of(), List.of(), List.of(), List.of(), List.of());

    private volatile ProductTruthView cached;
    private volatile boolean failed;

    /** The reviewed ledger, or an empty view if it could not be read. Never throws. */
    public ProductTruthView view() {
        ProductTruthView current = cached;
        if (current != null) {
            return current;
        }
        if (failed) {
            return EMPTY;
        }
        synchronized (this) {
            if (cached != null) {
                return cached;
            }
            try {
                cached = render(ProductTruthPack.load());
                return cached;
            } catch (RuntimeException ex) {
                // Once. A ledger that cannot be read is a build-time defect, and repeating it per
                // request would bury the line that says so.
                failed = true;
                log.warn("Canonical Product Source를 읽지 못했습니다 — Agent는 파생 사실만 사용합니다", ex);
                return EMPTY;
            }
        }
    }

    private static ProductTruthView render(ProductTruthPack pack) {
        return new ProductTruthView(
                pack.capabilities().stream().map(ProductTruthCatalog::capability).toList(),
                pack.features().stream()
                        .map(f -> new ProductTruthView.FeatureView(f.id(), f.title(), f.status().name(),
                                f.evidence().name(), f.sellerFacingNotes(), f.limitations()))
                        .toList(),
                pack.invariants().stream()
                        .map(i -> new ProductTruthView.StatementView(i.id(), i.title(), i.statement(), i.notThis()))
                        .toList(),
                pack.narratives().stream()
                        .map(n -> new ProductTruthView.StatementView(n.id(), n.title(), n.body(), List.of()))
                        .toList(),
                pack.directions().stream()
                        .map(d -> new ProductTruthView.StatementView(d.id(), d.title(), d.statement(), List.of()))
                        .toList(),
                pack.roadmap().stream()
                        .map(r -> new ProductTruthView.RoadmapView(r.id(), r.title(), r.status().name(),
                                r.summary(), r.qualifier()))
                        .toList());
    }

    private static ProductTruthView.CapabilityView capability(ProductCapability c) {
        return new ProductTruthView.CapabilityView(
                c.id(), c.channel(), c.object(), c.axis().name(),
                c.status().name(), c.mode().name(), c.evidence().name(),
                c.sellerFacingNotes(), c.limitations(),
                c.requirements().stream()
                        .map(r -> new ProductTruthView.RequirementView(r.kind().name(), r.description()))
                        .toList(),
                c.subtypes().stream()
                        .map(s -> new ProductTruthView.SubtypeView(s.id(), s.key(), s.label(),
                                s.status().name(), s.mode().name(), s.evidence().name(),
                                s.sellerFacingNotes(), s.limitations()))
                        .toList());
    }
}
