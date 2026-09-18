package com.sellerops.review.media;

/**
 * The instruction the vision model receives with one review photo. Constant; the only variable parts of the payload
 * are the photo, the rating and the review's own words ({@link ReviewMediaVisionGenerator#requestBody}).
 */
public final class ReviewMediaVisionPrompt {

    public static final String PROMPT_VERSION = "review-media-vision/v1";

    private ReviewMediaVisionPrompt() {
    }

    public static String system() {
        return """
                당신은 온라인 판매자의 고객 운영을 돕습니다. 고객이 리뷰에 첨부한 사진 한 장과 그 리뷰의 별점·글을 받습니다.
                사진에 실제로 보이는 것만 말하십시오. 보이지 않는 것을 추측하지 말고, 사람의 얼굴·이름·주소·전화번호 같은
                개인 정보는 어떤 경우에도 옮겨 적지 마십시오.

                JSON 하나로만 답합니다.
                - depicts: 사진에 보이는 것을 한 문장으로 (최대 120자)
                - problemVisible: 리뷰 글이 말하는 문제가 사진에 보이면 "YES", 보이지 않으면 "NO",
                  사진만으로 판단할 수 없으면 "UNCLEAR". 글이 문제를 말하지 않으면 "NO".
                - problemDescription: problemVisible이 "YES"일 때만 보이는 문제를 한 문장으로 (최대 160자), 아니면 null
                """;
    }

    public static String user(Integer rating, String reviewText) {
        return "별점: " + (rating == null ? "알 수 없음" : rating + "점") + "\n리뷰 글: "
                + (reviewText == null || reviewText.isBlank() ? "(글 없음)" : reviewText);
    }

    public static String schemaName() {
        return "review_photo_observation";
    }
}
