package com.sellerops.product.catalogue;

import java.math.BigDecimal;
import java.util.ArrayList;
import java.util.LinkedHashSet;
import java.util.List;
import java.util.Locale;
import java.util.Map;
import java.util.Optional;
import java.util.Set;
import java.util.function.Predicate;
import java.util.regex.Matcher;
import java.util.regex.Pattern;

/**
 * <b>A question about what the seller sells, rather than about the product it was asked on.</b>
 *
 * <p>「종이컵 9oz 크기도 디스펜서 제품 판매하시나요?」 is asked on one listing and is not about it: it asks whether this
 * seller sells a <i>디스펜서</i> in a size the listing does not name. The answer is in the seller's own catalogue — or
 * nowhere — and a draft path that only reads the listing it was asked on can only ever say 「답변 기준이 필요합니다」
 * (inquiry 689162087, 2026-09-18). This record says, deterministically, when a question is that kind and what it asks
 * for, so the catalogue can be read before the seller is asked.
 *
 * <p><b>Three things must all be present</b>, or it is not a catalogue question and nothing is searched:
 * <ul>
 *   <li>an <i>availability</i> verb — 판매·팔다·구매·있나요·따로·별도·다른 … — a closed list. 「들어가나요」 and 「맞나요」
 *       alone ask about THIS product and stay on the current-product path: searching the catalogue for them is how a
 *       fact about another listing would end up answering a question about this one;</li>
 *   <li>a <i>head</i> — the kind of product asked for, as a word that actually occurs in this seller's product names
 *       (the nearest such word before the availability verb). A noun the catalogue never uses cannot be looked up in it;</li>
 *   <li>a <i>target</i> — a measured value (9oz · 250ml · 16mm · 3호), a colour from a closed list, or 「다른/따로 +
 *       크기·색상·옵션」 (the value-less form, answered from this product's own registered options).</li>
 * </ul>
 *
 * <p>No model, no ranking, no threshold. A question this cannot parse is left to the ordinary path, which is where it
 * was before this class existed.
 */
public record CatalogueQuestion(Kind kind, String head, List<Measure> measures, List<String> colors,
                                List<String> qualifiers) {

    public enum Kind {
        /** A measured value or a colour is named: search for a product that states it. */
        VALUE,
        /** 「다른 크기도 있나요」 — no value named: the answer is this product's own registered options. */
        OTHER_OPTION
    }

    /** A measured value, normalised: {@code 9oz}, {@code 9 온스} and {@code 9OZ} are the same measure. */
    public record Measure(BigDecimal value, String unit, String raw) {

        public boolean sameAs(Measure other) {
            return other != null && unit.equals(other.unit) && value.compareTo(other.value) == 0;
        }

        /** How the seller-facing sentence names it: the customer's own spelling. */
        public String label() {
            return raw;
        }
    }

    public CatalogueQuestion {
        measures = measures == null ? List.of() : List.copyOf(measures);
        colors = colors == null ? List.of() : List.copyOf(colors);
        qualifiers = qualifiers == null ? List.of() : List.copyOf(qualifiers);
    }

    public CatalogueQuestion(Kind kind, String head, List<Measure> measures, List<String> colors) {
        this(kind, head, measures, colors, List.of());
    }

    /** 「9oz 디스펜서」 — what the seller is asked about when the catalogue cannot answer. The customer's own words. */
    public String subject() {
        List<String> parts = new ArrayList<>();
        measures.forEach(m -> parts.add(m.label()));
        parts.addAll(colors);
        if (kind == Kind.OTHER_OPTION && parts.isEmpty()) {
            parts.add("다른 옵션");
        }
        parts.addAll(qualifiers);
        parts.add(head);
        return String.join(" ", parts);
    }

    /** The target alone — 「9oz」, 「블랙」 — for the sentence that says what was looked for. */
    public String target() {
        List<String> parts = new ArrayList<>();
        measures.forEach(m -> parts.add(m.label()));
        parts.addAll(colors);
        return parts.isEmpty() ? "다른 옵션" : String.join(" ", parts);
    }

    /** 이/가 for a Korean word; 가 after anything that does not end in a Hangul syllable with a final consonant. */
    public static String subjectParticle(String word) {
        char last = word == null || word.isEmpty() ? 'a' : word.charAt(word.length() - 1);
        return last >= 0xAC00 && last <= 0xD7A3 && (last - 0xAC00) % 28 != 0 ? "이" : "가";
    }

    // ── parsing ─────────────────────────────────────────────────────────────────────────────────────────────────

    /** Units, customer spelling → one canonical unit. Closed; an unlisted unit is not a measure. */
    private static final Map<String, String> UNITS = Map.ofEntries(
            Map.entry("oz", "oz"), Map.entry("온스", "oz"),
            Map.entry("ml", "ml"), Map.entry("밀리리터", "ml"), Map.entry("미리리터", "ml"),
            Map.entry("리터", "l"),
            Map.entry("mm", "mm"), Map.entry("미리", "mm"), Map.entry("밀리", "mm"),
            Map.entry("cm", "cm"), Map.entry("센치", "cm"), Map.entry("센티", "cm"),
            Map.entry("호", "호"),
            Map.entry("인치", "inch"), Map.entry("inch", "inch"));

    /**
     * A number and a unit. The number may not be glued to a preceding digit or dot (so 「19oz」 is never read as 9oz),
     * and the longer spellings are tried first (「밀리리터」 before 「밀리」).
     */
    static final Pattern MEASURE = Pattern.compile(
            "(?<![0-9.])([0-9]+(?:\\.[0-9]+)?)\\s*(밀리리터|미리리터|온스|리터|센치|센티|밀리|미리|인치|inch|oz|ml|mm|cm|호)",
            Pattern.CASE_INSENSITIVE);

    /** Colours, customer spelling → the catalogue's spelling. Closed. */
    static final Map<String, String> COLORS = Map.ofEntries(
            Map.entry("화이트", "화이트"), Map.entry("흰색", "화이트"),
            Map.entry("블랙", "블랙"), Map.entry("검정", "블랙"), Map.entry("검은색", "블랙"),
            Map.entry("그레이", "그레이"), Map.entry("회색", "그레이"),
            Map.entry("아이보리", "아이보리"), Map.entry("베이지", "베이지"), Map.entry("브라운", "브라운"),
            Map.entry("네이비", "네이비"), Map.entry("블루", "블루"), Map.entry("파란색", "블루"),
            Map.entry("레드", "레드"), Map.entry("빨간색", "레드"), Map.entry("핑크", "핑크"),
            Map.entry("퍼플", "퍼플"), Map.entry("보라색", "퍼플"), Map.entry("그린", "그린"),
            Map.entry("초록색", "그린"), Map.entry("옐로우", "옐로우"), Map.entry("노란색", "옐로우"),
            Map.entry("실버", "실버"), Map.entry("골드", "골드"), Map.entry("투명", "투명"));

    /** The availability verbs. A question without one is about the product it was asked on. */
    static final Pattern AVAILABILITY = Pattern.compile(
            "판매|파(?:나요|시나요|는지|세요|시는|나)|팔(?:아|고|까|지|리|린)|구매|구입|살\\s*수|"
                    + "있(?:나요|을까요|는지|으신가요|습니까|으세요|는|을|어요|나)|없(?:나요|을까요|는지|습니까)|"
                    + "나오(?:나요|는지)|출시|따로|별도|다른");

    /** 「다른/따로/별도 … 크기·색상·옵션」 or 「크기·색상·옵션도」 — the value-less option question. */
    static final Pattern OTHER_OPTION = Pattern.compile(
            "(?:다른|따로|별도)\\s*(?:크기|사이즈|색상|컬러|색깔|옵션|용량|규격)|(?:크기|사이즈|색상|컬러|색깔|옵션|용량|규격)(?:도|는)?\\s*"
                    + "(?:다른|더|또)");

    /** Words that are never the kind of product asked for, however often a product name uses them. */
    static final Set<String> NOT_A_HEAD = Set.of("제품", "상품", "물건", "크기", "사이즈", "색상", "컬러", "색깔", "옵션",
            "용량", "규격", "판매", "구매", "구입", "혹시", "문의", "가능", "따로", "별도", "다른", "종류", "모델", "하나",
            "이거", "이것", "그거", "저거", "정도", "혹시요", "사용", "있나요", "없나요", "판매하시나요", "파나요",
            "주문", "배송", "가격", "세트", "구성", "추가", "전용", "용도", "관련");

    /** One-syllable endings stripped from a word before it is looked up — 「디스펜서도」 is the word 「디스펜서」. */
    private static final String[] PARTICLES = {"으로", "에서", "까지", "부터", "이랑", "도", "는", "은", "이", "가", "을",
            "를", "에", "의", "로", "만", "랑", "과", "와", "용"};

    private static final Pattern WORD = Pattern.compile("[가-힣A-Za-z0-9]+");

    /**
     * @param inCatalogue whether a (space-free, lower-case) word occurs in any of this seller's product names — the
     *                    only vocabulary a head may come from
     */
    public static Optional<CatalogueQuestion> parse(String title, String body, Predicate<String> inCatalogue) {
        String text = ((title == null ? "" : title) + " " + (body == null ? "" : body)).strip();
        if (text.isEmpty() || inCatalogue == null) {
            return Optional.empty();
        }
        Matcher verb = AVAILABILITY.matcher(text);
        if (!verb.find()) {
            return Optional.empty();
        }
        int verbAt = lastMatchStart(AVAILABILITY, text);

        List<Measure> measures = measuresIn(text);
        List<String> colors = new ArrayList<>(new LinkedHashSet<>(colorsIn(text)));
        boolean otherOption = OTHER_OPTION.matcher(text).find();
        if (measures.isEmpty() && colors.isEmpty() && !otherOption) {
            return Optional.empty();
        }

        // Every word, in order, marked with whether it names something in this seller's catalogue.
        List<String> tokens = new ArrayList<>();
        List<Boolean> catalogueWord = new ArrayList<>();
        List<Integer> starts = new ArrayList<>();
        Matcher words = WORD.matcher(text);
        while (words.find()) {
            String word = stripParticle(words.group());
            String key = word.toLowerCase(Locale.ROOT);
            tokens.add(word);
            starts.add(words.start());
            catalogueWord.add(word.length() >= 2 && !NOT_A_HEAD.contains(word) && !COLORS.containsKey(word)
                    && !MEASURE.matcher(word).find() && inCatalogue.test(key));
        }
        int headAt = -1;
        int lastAny = -1;
        for (int i = 0; i < tokens.size(); i++) {
            if (!catalogueWord.get(i)) {
                continue;
            }
            lastAny = i;
            if (starts.get(i) < verbAt) {
                headAt = i;
            }
        }
        if (headAt < 0) {
            headAt = lastAny;
        }
        if (headAt < 0) {
            return Optional.empty();
        }
        String head = tokens.get(headAt);
        // The catalogue words written directly before the head qualify it: 「하향식 디스펜서」 is not answered by a
        // dispenser that never says 하향식. A word separated from the head by anything else — 「종이컵 9oz 크기도
        // 디스펜서」 — is what the product is for, not what kind it is, and is not required.
        List<String> qualifiers = new ArrayList<>();
        for (int i = headAt - 1; i >= 0 && catalogueWord.get(i); i--) {
            qualifiers.add(0, tokens.get(i));
        }
        Kind kind = measures.isEmpty() && colors.isEmpty() ? Kind.OTHER_OPTION : Kind.VALUE;
        return Optional.of(new CatalogueQuestion(kind, head, measures, colors, qualifiers));
    }

    /** Every measure in a text, in order, once each. Used on the question and, by the investigator, on stated text. */
    public static List<Measure> measuresIn(String text) {
        List<Measure> out = new ArrayList<>();
        if (text == null) {
            return out;
        }
        Matcher m = MEASURE.matcher(text);
        while (m.find()) {
            String unit = UNITS.get(m.group(2).toLowerCase(Locale.ROOT));
            if (unit == null) {
                continue;
            }
            Measure measure = new Measure(new BigDecimal(m.group(1)), unit, m.group().replaceAll("\\s+", ""));
            if (out.stream().noneMatch(measure::sameAs)) {
                out.add(measure);
            }
        }
        return out;
    }

    /** Every colour a text names, in the catalogue's spelling. */
    public static List<String> colorsIn(String text) {
        List<String> out = new ArrayList<>();
        if (text == null) {
            return out;
        }
        for (Map.Entry<String, String> color : COLORS.entrySet()) {
            if (text.contains(color.getKey()) && !out.contains(color.getValue())) {
                out.add(color.getValue());
            }
        }
        out.sort(null);
        return out;
    }

    /** Whether a colour is named in a text, in any of its spellings. */
    public static boolean namesColor(String text, String color) {
        if (text == null) {
            return false;
        }
        for (Map.Entry<String, String> entry : COLORS.entrySet()) {
            if (entry.getValue().equals(color) && text.contains(entry.getKey())) {
                return true;
            }
        }
        return false;
    }

    static String stripParticle(String word) {
        for (String particle : PARTICLES) {
            if (word.endsWith(particle) && word.length() - particle.length() >= 2) {
                return word.substring(0, word.length() - particle.length());
            }
        }
        return word;
    }

    private static int lastMatchStart(Pattern pattern, String text) {
        Matcher m = pattern.matcher(text);
        int at = -1;
        while (m.find()) {
            at = m.start();
        }
        return at;
    }
}
