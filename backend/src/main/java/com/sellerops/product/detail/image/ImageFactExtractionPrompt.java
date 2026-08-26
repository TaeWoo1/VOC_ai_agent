package com.sellerops.product.detail.image;

/**
 * The constant half of every image-extraction call. <b>Nothing about this seller, this product or
 * this customer is in here, and there is nowhere for it to enter</b> — the methods take no argument.
 *
 * <p>That is the payload floor stated as a type. The model is shown one picture and this text; it is
 * NOT shown the product title, the option list, the customer's question, a past answer, an operating
 * policy, the seller's identity, or any id. It therefore cannot associate what it reads with a
 * 규격 it was never told about, which is the point: association is arithmetic done afterwards in
 * {@link ImageFactAssociation}, on exact tokens, where it can be checked.
 *
 * <p><b>What the model is asked for is transcription, not understanding.</b> Every instruction below
 * exists because its opposite is a way to be confidently wrong: inferring, converting units,
 * computing, and — the one that caused this whole lane — reading a number as a capacity when the
 * picture only put a number next to a name.
 */
public final class ImageFactExtractionPrompt {

    /** Part of the extractor version string, so a stored receipt says which words produced it. */
    public static final String PROMPT_VERSION = "image-fact-prompt/v1";

    private ImageFactExtractionPrompt() {
    }

    public static String system() {
        return """
            You transcribe product specifications that are ALREADY WRITTEN on one product image.

            Return JSON only, in exactly this shape:
            {"facts":[{"specLabel":"...","attribute":"...","value":"..."}]}

            - specLabel: the 규격/옵션/모델 name the row or column is labelled with, copied exactly \
            as printed.
            - attribute: what is being stated about it, copied exactly as printed.
            - value: the stated value, copied exactly as printed, including its unit.

            Rules, all mandatory:
            1. Transcribe only what is explicitly printed in the image. If it is not written, it does \
            not exist.
            2. Preserve the original wording of specLabel, attribute and value. Do not translate, \
            normalise, abbreviate or expand them.
            3. Do not infer. Do not derive one value from another.
            4. Do not convert units. Do not compute, add, average or round.
            5. Do not guess which specLabel a value belongs to. If a value is printed without a \
            label that clearly governs it, omit that value entirely.
            6. Output no explanation, no commentary, no description of the image, and no text \
            outside the JSON.
            7. If the image states no product specification, return {"facts":[]}. An empty list is a \
            correct and expected answer.
            """;
    }

    /**
     * The strict response schema, as the vendor's {@code json_schema} object.
     *
     * <p>Closed on purpose: {@code additionalProperties:false} everywhere and all three fields
     * required. A schema that permitted extra keys would let the model return the free-form OCR dump
     * this lane exists not to have, in a field nobody reads but everything stores.
     */
    public static String schemaName() {
        return "product_image_specifications";
    }
}
