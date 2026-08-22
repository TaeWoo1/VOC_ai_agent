package com.sellerops.connector.coupang;

import com.fasterxml.jackson.databind.JsonNode;
import java.util.ArrayList;
import java.util.LinkedHashMap;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Map;
import java.util.Set;
import java.util.TreeMap;

/**
 * <b>Schema observation for a Coupang response — key names and counts, never a value.</b>
 *
 * <p>It exists because the seller-product mapper makes four NEGATIVE claims about the wire —
 * no manufacturer, no description, no storefront URL, no last-modified — and not one of them had
 * ever been held against a real response. A mapper cannot report a field it does not read, so the
 * only way to answer "what does Coupang actually return, and how much of it is filled in" is to look
 * at the parsed body itself.
 *
 * <p><b>The sanitization contract is {@link CoupangResponseDiagnostics}', restated for a body that
 * parsed successfully:</b> object KEY names, JSON node kinds, array cardinalities and counts may be
 * recorded, because they are the platform's API schema. A value may not — not a product title, not a
 * price, not a description, not an identifier, not one character of the raw body. Nothing this class
 * holds can be turned back into seller or customer data, which is why its output is safe to put in an
 * evidence document.
 *
 * <p><b>Default off.</b> One flag, one proof. This is instrumentation for a first live observation of
 * a wire shape, not a permanent tap on a collection path.
 */
final class CoupangWireShapeObserver {

    /**
     * The identifiers and content blocks whose presence the PRODUCT proof set out to settle. Reported
     * by leaf name even when absent — an ABSENT row is the whole point, and a key that never appears
     * can never show up in the observed-path list on its own.
     */
    static final List<String> WATCHED_KEYS = List.of(
            "sellerProductId", "productId", "sellerProductItemId", "vendorItemId", "itemId",
            "externalVendorSku", "itemName", "salePrice", "displayCategoryCode", "brand",
            "manufacture", "attributes", "notices", "contents", "images", "statusName");

    /** A body deep or wide beyond this stops being recorded. A runaway schema map is still a leak risk. */
    private static final int MAX_PATHS = 500;
    private static final int MAX_DEPTH = 12;

    /** Per stream ("list" / "detail"): how many bodies were observed. */
    private final Map<String, Integer> bodies = new LinkedHashMap<>();
    /** stream → object path → how many times an object existed at that path. */
    private final Map<String, Map<String, Counter>> objects = new LinkedHashMap<>();
    /** stream → field path → present / non-null tallies. */
    private final Map<String, Map<String, Field>> fields = new LinkedHashMap<>();
    /** stream → array path → occurrences and element counts. */
    private final Map<String, Map<String, Cardinality>> arrays = new LinkedHashMap<>();
    private boolean truncated;

    /** Record one successfully parsed response body. */
    void observe(String stream, JsonNode root) {
        if (root == null || root.isMissingNode()) {
            return;
        }
        bodies.merge(stream, 1, Integer::sum);
        walk(stream, "$", root, 0);
    }

    private void walk(String stream, String path, JsonNode node, int depth) {
        if (depth > MAX_DEPTH) {
            truncated = true;
            return;
        }
        if (node.isObject()) {
            counter(objects, stream, path).count++;
            var names = node.fieldNames();
            while (names.hasNext()) {
                String name = names.next();
                String childPath = path + "." + name;
                Map<String, Field> streamFields = fields.computeIfAbsent(stream, s -> new TreeMap<>());
                if (!streamFields.containsKey(childPath) && streamFields.size() >= MAX_PATHS) {
                    truncated = true;
                    continue;
                }
                Field field = streamFields.computeIfAbsent(childPath, p -> new Field());
                JsonNode child = node.get(name);
                field.present++;
                if (isFilled(child)) {
                    field.nonNull++;
                }
                field.kinds.add(kindOf(child));
                walk(stream, childPath, child, depth + 1);
            }
        } else if (node.isArray()) {
            Cardinality cardinality = arrays.computeIfAbsent(stream, s -> new TreeMap<>())
                    .computeIfAbsent(path, p -> new Cardinality());
            cardinality.occurrences++;
            cardinality.elements += node.size();
            cardinality.min = Math.min(cardinality.min, node.size());
            cardinality.max = Math.max(cardinality.max, node.size());
            for (JsonNode element : node) {
                walk(stream, path + "[]", element, depth + 1);
            }
        }
    }

    /** Present AND carrying something: null, an empty string and an empty array are all "not filled". */
    private static boolean isFilled(JsonNode node) {
        if (node == null || node.isNull()) {
            return false;
        }
        if (node.isTextual()) {
            return !node.asText().isBlank();
        }
        if (node.isArray() || node.isObject()) {
            return node.size() > 0;
        }
        return true;
    }

    /** The node KIND — a type name, never the value it holds. */
    private static String kindOf(JsonNode node) {
        if (node == null || node.isNull()) {
            return "null";
        }
        if (node.isObject()) {
            return "object";
        }
        if (node.isArray()) {
            return "array";
        }
        if (node.isTextual()) {
            return "string";
        }
        if (node.isNumber()) {
            return "number";
        }
        if (node.isBoolean()) {
            return "boolean";
        }
        return "scalar";
    }

    /** True when nothing was recorded — the observer ran but no body reached it. */
    boolean isEmpty() {
        return bodies.isEmpty();
    }

    /**
     * The aggregate, as log-safe lines: one per observed field path, one per array path, plus the
     * watched-key checklist. Counts and names only.
     */
    List<String> summaryLines() {
        List<String> out = new ArrayList<>();
        for (String stream : bodies.keySet()) {
            out.add("[" + stream + "] bodies=" + bodies.get(stream)
                    + (truncated ? " (truncated: schema wider or deeper than the recording bound)" : ""));
            for (Map.Entry<String, Cardinality> array : arrays.getOrDefault(stream, Map.of()).entrySet()) {
                Cardinality c = array.getValue();
                out.add("[" + stream + "] array " + array.getKey()
                        + " occurrences=" + c.occurrences + " elements=" + c.elements
                        + " min=" + (c.occurrences == 0 ? 0 : c.min) + " max=" + (c.occurrences == 0 ? 0 : c.max));
            }
            for (Map.Entry<String, Field> field : fields.getOrDefault(stream, Map.of()).entrySet()) {
                Field f = field.getValue();
                int parents = parentCount(stream, field.getKey());
                out.add("[" + stream + "] key " + field.getKey()
                        + " present=" + f.present + "/" + parents
                        + " nonNull=" + f.nonNull
                        + " kinds=" + String.join("|", f.kinds));
            }
        }
        out.addAll(watchedKeyLines());
        return out;
    }

    /** Every watched key, present or not — an absent one is a measurement, not a gap in the report. */
    List<String> watchedKeyLines() {
        List<String> out = new ArrayList<>();
        for (String key : WATCHED_KEYS) {
            List<String> hits = new ArrayList<>();
            for (Map.Entry<String, Map<String, Field>> stream : fields.entrySet()) {
                for (Map.Entry<String, Field> field : stream.getValue().entrySet()) {
                    if (leafOf(field.getKey()).equals(key)) {
                        hits.add(stream.getKey() + " " + field.getKey()
                                + " present=" + field.getValue().present + "/" + parentCount(stream.getKey(), field.getKey())
                                + " nonNull=" + field.getValue().nonNull);
                    }
                }
            }
            out.add("watched " + key + " = " + (hits.isEmpty() ? "ABSENT" : String.join(" ; ", hits)));
        }
        return out;
    }

    /** How many objects existed that COULD have carried this key — the honest denominator. */
    private int parentCount(String stream, String fieldPath) {
        String parent = fieldPath.substring(0, fieldPath.lastIndexOf('.'));
        Map<String, Counter> streamObjects = objects.get(stream);
        Counter counter = streamObjects == null ? null : streamObjects.get(parent);
        return counter == null ? 0 : counter.count;
    }

    private static String leafOf(String path) {
        String leaf = path.substring(path.lastIndexOf('.') + 1);
        return leaf.endsWith("[]") ? leaf.substring(0, leaf.length() - 2) : leaf;
    }

    private static Counter counter(Map<String, Map<String, Counter>> map, String stream, String path) {
        return map.computeIfAbsent(stream, s -> new TreeMap<>()).computeIfAbsent(path, p -> new Counter());
    }

    private static final class Counter {
        private int count;
    }

    private static final class Field {
        private int present;
        private int nonNull;
        private final Set<String> kinds = new LinkedHashSet<>();
    }

    private static final class Cardinality {
        private int occurrences;
        private int elements;
        private int min = Integer.MAX_VALUE;
        private int max;
    }
}
