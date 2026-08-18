// Presentation-only: turns the backend's honest support FACTS (ChannelResponse.support)
// into operator-facing Korean copy. No business logic — the truth (flag-aware capability)
// is decided server-side. The only product judgment here is WORDING, governed by two rules:
//
//   1. Conservative file-upload wording. Structural file-upload support must NOT read as a
//      verified, ready-made format. Generic channels say "엑셀 업로드 지원" + a "양식 채널별
//      확인 필요" caveat — never "엑셀 업로드로 수집: 리뷰·문의·주문" (over-confirms).
//   2. NAVER is the one verified-upload exception (its review-export parser shipped in
//      f9aec15): NAVER alone may name a specific format — "네이버 리뷰 export 업로드 지원".
//   3. Only what the seller GETS is shown (product assembly A6). The server also reports
//      connector facts — "connection check supported", "credential template exists" — that
//      describe how SellerOps is built, not what the channel row does for the seller; they used
//      to render as boilerplate chips on every row and no longer render at all.
//
// Banned wording (coming-soon / completion / "operations normalized") never appears here.

import type { ChannelResponse } from "./types";

export const SUPPORT_COPY = {
  autoCollect: "자동 수집 지원",
  fileUpload: "엑셀 업로드 지원",
  fileUploadQualifier: "리뷰·문의·주문 양식은 채널별 확인 필요",
  naverVerifiedUpload: "네이버 리뷰 export 업로드 지원",
  preparing: "지금은 연결할 수 없음",
  footnote: "수집 가능 여부는 채널별 지원 상태에 따라 다릅니다.",
} as const;

/** Strings that must never render in channel-coverage UI (over-claim / roadmap language). */
export const BANNED_SUPPORT_PHRASES = [
  "연동 완료",
  "자동 수집 완료",
  "전체 채널 지원 완료",
  "운영 정상화",
  "다음 단계에서",
] as const;

const NAVER_CODE = "NAVER";

export interface ChannelSupportDisplay {
  /** Headline support-mode chip. */
  primaryLabel: string;
  /** Honest secondary chips — today only the verified upload path beside an auto-collect headline. */
  chips: string[];
  /** Conservative caveat shown under the upload representation; null for NAVER (verified)
   *  and for channels with no upload path. */
  uploadQualifier: string | null;
}

export function channelSupportDisplay(channel: ChannelResponse): ChannelSupportDisplay {
  const s = channel.support;
  const isNaver = channel.code === NAVER_CODE;
  // The literal FILE_UPLOAD meta-channel reports fileUploadSupported=false (it is the upload
  // sink, not a pull-connector channel) but is obviously uploadable — fall back to its status.
  const uploadable = s.fileUploadSupported || channel.status === "FILE_UPLOAD_SUPPORTED";
  const autoCollects = s.autoCollectSupported && s.autoCollectDataTypes.length > 0;
  const uploadLabel = isNaver ? SUPPORT_COPY.naverVerifiedUpload : SUPPORT_COPY.fileUpload;

  let primaryLabel: string;
  if (autoCollects) {
    primaryLabel = `${SUPPORT_COPY.autoCollect}: ${s.autoCollectDataTypes.join("·")}`;
  } else if (uploadable) {
    primaryLabel = uploadLabel;
  } else {
    primaryLabel = SUPPORT_COPY.preparing;
  }

  const chips: string[] = [];
  // When a channel both auto-collects and accepts uploads (e.g. NAVER: order auto-collect +
  // verified review export), surface the upload path as a secondary chip.
  if (autoCollects && uploadable) {
    chips.push(uploadLabel);
  }

  const uploadQualifier = uploadable && !isNaver ? SUPPORT_COPY.fileUploadQualifier : null;

  return { primaryLabel, chips, uploadQualifier };
}
