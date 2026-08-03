// Every word on the public product page, as data.
//
// WHY A CONTENT MODULE, NOT COPY IN JSX. Two reasons, both practical:
//   1. The honesty rules that govern this surface (no channel names, no unbacked metrics, no
//      roadmap wording, no implementation mechanism) are enforceable only if the copy is scannable
//      in one place — see `landingContent.test.ts`.
//   2. Section order is a product decision, not a layout accident. `SECTION_ORDER` owns it and the
//      page renders from it.
//
// NARRATIVE SHAPE (StoryBrand). The seller is the protagonist; SellerOps is the guide.
//   character → problem → stakes → guide → plan → change → (de-risk) → call to action.
// The page never opens with what SellerOps is. It opens with where the seller is standing.

import { CTA_DEMO_LABEL, CTA_DIAGNOSIS_LABEL } from "./publicCta";

export const SECTION_ORDER = [
  "hero",
  "problem",
  "cost",
  "guide",
  "how",
  "connect",
  "assisted",
  "change",
  "safety",
  "fit",
  "faq",
  "closing",
] as const;

export type SectionId = (typeof SECTION_ORDER)[number];

/** Re-exported so callers get labels and order from one module. */
export const CTA_LABELS = {
  primary: CTA_DIAGNOSIS_LABEL,
  secondary: CTA_DEMO_LABEL,
} as const;

// ─── 1. Hero — the character, and where they are standing ──────────────────────────────────────

export const HERO = {
  eyebrow: "다채널 온라인 판매자를 위한 AI 고객운영",
  titleLines: ["채널은 늘었는데,", "고객의 말을 기억하는 건 여전히 사람입니다."],
  body: "문의도 리뷰도 채널마다 흩어져 있습니다. SellerOps는 흩어진 고객의 말을 한곳에 모아 정리하고, 반복되는 문제를 기억해 두었다가, 판매자가 놓치면 안 되는 신호만 남깁니다.",
  ctaNote: "데모 계정으로 실제 화면을 둘러볼 수 있습니다.",
} as const;

// ─── 2. Problem — concrete scenes, not adjectives ──────────────────────────────────────────────

export const PROBLEM = {
  heading: "판매가 늘수록, 고객 응대는 사람 손에 남습니다",
  lead: "아래 중 하나라도 익숙하다면, 지금 겪고 계신 문제입니다.",
  scenes: [
    {
      title: "채널마다 따로 들어가서 봅니다",
      body: "문의는 이 창, 리뷰는 저 창. 어디까지 확인했는지는 사람 기억에 남습니다.",
    },
    {
      title: "놓친 문의를 나중에 발견합니다",
      body: "답을 안 한 것이 아니라, 들어와 있는 줄 몰랐습니다.",
    },
    {
      title: "같은 질문에 매번 새로 답합니다",
      body: "지난달에 잘 써둔 답변이 어디 있는지 찾지 못합니다.",
    },
    {
      title: "사람마다 답변이 다릅니다",
      body: "담당자가 바뀌면 응대의 온도와 내용도 같이 바뀝니다.",
    },
    {
      title: "부정 리뷰를 뒤늦게 봅니다",
      body: "같은 불만이 몇 번째인지 세고 있는 사람이 없습니다.",
    },
  ],
} as const;

// ─── 3. Stakes — what it costs to leave it alone ───────────────────────────────────────────────

export const COST = {
  heading: "놓친 하나는 하나로 끝나지 않습니다",
  items: [
    {
      title: "답 없는 문의는 이탈로 끝납니다",
      body: "구매 직전에 들어온 질문일수록 더 그렇습니다. 기다리다 다른 곳에서 삽니다.",
    },
    {
      title: "방치된 부정 리뷰는 다음 구매자가 먼저 읽습니다",
      body: "그 사이에도 판매는 계속됩니다. 읽은 사람의 수는 뒤늦게 알 수 없습니다.",
    },
    {
      title: "반복되는 질문은 같은 자리에서 계속 생깁니다",
      body: "상세페이지가 답을 못 하고 있기 때문입니다. 응대로는 원인이 줄지 않습니다.",
    },
  ],
  closing:
    "사람이 게을러서 생기는 일이 아닙니다. 흩어진 것을 사람이 기억해야 하는 구조여서 생기는 일입니다.",
} as const;

// ─── 4. Guide — SellerOps takes a role, not the wheel ──────────────────────────────────────────

export const GUIDE = {
  heading: "SellerOps는 판매를 대신하지 않습니다. 고객운영을 맡습니다.",
  body: "주문과 배송은 이미 쓰고 계신 도구가 합니다. SellerOps는 그 위에 얹히는 고객운영 레이어입니다 — 문의와 리뷰를 모아 정리하고, 반복되는 문제를 기억하고, 오늘 확인할 것을 골라 둡니다.",
  principle: "결정은 판매자가 합니다. SellerOps는 결정과 결정 사이의 일을 옮깁니다.",
  notHeading: "SellerOps가 아닌 것",
  notItems: [
    "주문·배송·정산을 처리하는 도구",
    "판매자를 대신해 고객에게 답변을 보내는 도구",
    "판매자 몰래 플랫폼을 조작하는 도구",
  ],
} as const;

// ─── 5. Plan (a) — how it moves ────────────────────────────────────────────────────────────────

export const HOW = {
  heading: "이렇게 움직입니다",
  lead: "판매자가 하는 일은 앞의 한 걸음과, 마지막 결정입니다.",
  steps: [
    {
      title: "자료를 연결하거나 가져옵니다",
      body: "연결할 수 있는 채널은 연결하고, 어려운 채널은 정기 자료 가져오기로 넘깁니다.",
    },
    {
      title: "문의와 리뷰를 한 형태로 정리합니다",
      body: "채널마다 다른 형식을 같은 기준으로 맞추고, 중복은 걸러냅니다.",
    },
    {
      title: "오늘 확인할 고객 이슈를 보여줍니다",
      body: "전부가 아니라, 지금 사람이 봐야 할 것만 앞에 둡니다.",
    },
    {
      title: "과거 응대와 근거를 함께 붙입니다",
      body: "이 질문에 지난번엔 어떻게 답했는지, 이 불만이 몇 번째인지 같이 보여줍니다.",
    },
    {
      title: "답변 초안과 리포트로 정리합니다",
      body: "초안을 준비하는 데까지가 SellerOps의 몫입니다. 고객에게 보내는 것은 판매자가 확인하고 누릅니다.",
    },
  ],
} as const;

// ─── 6. Plan (b) — connection methods, stated honestly ─────────────────────────────────────────
//
// This section is the honest answer to "which channels do you support?" WITHOUT naming a
// marketplace. Capability truth lives in the connector roadmap's living table, and today's
// production-supported level does not back a logo wall. Naming methods instead of channels is
// both accurate and a better qualifier — it routes the reader to the diagnosis.

export const CONNECT = {
  heading: "채널마다 연결 방식이 다릅니다. 그대로 알려드립니다.",
  lead: "모든 채널이 같은 방식으로 붙지는 않습니다. SellerOps는 채널별로 가능한 방식만 표시하고, 안 되는 것은 안 된다고 씁니다.",
  modes: [
    {
      title: "연결로 가져오기",
      body: "공식 연동이 열려 있는 채널입니다. 한 번 연결하면 이후 반복 조작이 없습니다.",
    },
    {
      title: "화면 안내로 가져오기",
      body: "플랫폼이 사람의 확인을 요구하는 채널입니다. 필요한 한 번의 확인은 판매자가 직접 하고, 그 뒤는 SellerOps가 잇습니다.",
    },
    {
      title: "정기 자료 가져오기",
      body: "연동이 어려운 채널입니다. 정해진 주기에 자료를 넘겨주면 이어서 정리합니다.",
    },
    {
      title: "확인 중",
      body: "아직 확인되지 않은 채널입니다. 되는 것처럼 미리 표시하지 않습니다.",
    },
  ],
  note: "어떤 채널이 어느 방식에 해당하는지는 무료 운영 진단에서 판매자님 기준으로 확인해 드립니다.",
} as const;

// ─── 7. Plan (c) — the assisted-import journey ─────────────────────────────────────────────────
//
// Seller-facing name is "정기 자료 가져오기" (PO decision). Internally this maps to FILE_IMPORT.
// It is deliberately NOT called "엑셀 업로드": the seller's job is a rhythm, not a file format.

export const ASSISTED = {
  heading: "연동이 어려운 채널을 포기하지 않습니다",
  lead: "연결되는 채널만 보는 도구는 결국 절반만 봅니다. 정기 자료 가져오기는 나머지 절반을 위한 길입니다.",
  steps: [
    {
      title: "주기를 정합니다",
      body: "매주처럼, 판매자의 리듬에 맞춰 가져올 주기를 정합니다.",
    },
    {
      title: "때가 되면 알려드립니다",
      body: "무엇을 어디서 받아오면 되는지 단계로 안내합니다. 찾아 헤맬 일이 없습니다.",
    },
    {
      title: "받은 자료를 확인합니다",
      body: "형식이 맞는지, 빠진 기간은 없는지 먼저 검사하고 알려드립니다.",
    },
    {
      title: "같은 기준으로 정리합니다",
      body: "중복을 걸러내고, 채널이 달라도 같은 형태로 맞춥니다.",
    },
    {
      title: "인박스와 리포트에 반영됩니다",
      body: "연결된 채널과 같은 자리에서 함께 보입니다. 따로 관리하지 않습니다.",
    },
  ],
} as const;

// ─── 8. Change — before / after ────────────────────────────────────────────────────────────────

export const CHANGE = {
  heading: "무엇이 달라지는가",
  beforeTitle: "지금",
  before: [
    "채널마다 열어서 확인합니다",
    "놓친 것을 나중에 발견합니다",
    "지난 답변은 사람 기억에 의존합니다",
    "같은 불만이 몇 번째인지 모릅니다",
    "담당자가 바뀌면 응대도 바뀝니다",
  ],
  afterTitle: "SellerOps와 함께",
  after: [
    "한 자리에서 확인합니다",
    "확인할 것이 먼저 올라옵니다",
    "지난 응대가 함께 붙어 옵니다",
    "반복되는 문제가 기록으로 남습니다",
    "같은 기준을 두고 응대합니다",
  ],
} as const;

// ─── 9. De-risk — the fences, stated as a feature ──────────────────────────────────────────────

export const SAFETY = {
  heading: "하지 않는 것을 먼저 정해두었습니다",
  lead: "운영 도구가 판매자 모르게 움직이면, 편리함보다 사고가 먼저 옵니다.",
  items: [
    {
      title: "판매자 대신 보내지 않습니다",
      body: "답변은 준비까지입니다. 고객에게 나가는 것은 판매자가 확인하고 누릅니다.",
    },
    {
      title: "로그인과 인증을 대신하거나 우회하지 않습니다",
      body: "계정 인증은 언제나 사람이 직접 합니다.",
    },
    {
      title: "확실하지 않으면 멈춥니다",
      body: "화면이나 자료가 예상과 다르면 진행하지 않고, 무엇이 달랐는지 알려드립니다.",
    },
    {
      title: "민감한 정보는 운영 화면에 올리지 않습니다",
      body: "고객 개인정보와 계정 정보는 운영 화면에 노출하지 않습니다.",
    },
  ],
} as const;

// ─── 10. Qualify — who this is for, and who it is not for ──────────────────────────────────────

export const FIT = {
  heading: "맞는 곳과, 아직 아닌 곳",
  fitTitle: "이런 팀에 맞습니다",
  fit: [
    "여러 채널에서 팔고 있고, 문의와 리뷰를 사람이 나눠 보고 있는 팀",
    "응대가 특정 담당자 한 명에게 몰려 있는 팀",
    "같은 질문이 반복되는데 상세페이지를 언제 고쳐야 할지 판단이 서지 않는 팀",
  ],
  notFitTitle: "아직 맞지 않을 수 있습니다",
  notFit: [
    "주문·배송·정산을 처리할 도구를 찾고 계신 경우 — SellerOps는 그 자리를 대신하지 않습니다.",
    "문의와 리뷰가 아직 거의 없는 초기 단계 — 정리할 기록이 쌓인 뒤가 더 낫습니다.",
    "모든 채널이 사람 손 없이 붙기를 기대하시는 경우 — 채널에 따라 사람의 확인 단계가 남습니다.",
  ],
} as const;

// ─── 11. FAQ ───────────────────────────────────────────────────────────────────────────────────

export const FAQ = {
  heading: "자주 묻는 질문",
  items: [
    {
      q: "무료 운영 진단은 무엇인가요?",
      a: "자동으로 돌아가는 기능이 아닙니다. 보내주신 공개 리뷰 주소나 문의·리뷰 자료를 사람이 직접 살펴보고, 반복해서 들어오는 문의·방치된 부정 리뷰·FAQ로 만들 후보·상세페이지에서 고칠 후보를 한 장으로 정리해 드리는 초기 진단입니다.",
    },
    {
      q: "무엇을 준비해야 하나요?",
      a: "공개된 상품 리뷰 주소나, 이미 가지고 계신 문의·리뷰 자료면 충분합니다. 계정 정보나 비밀번호는 필요하지 않습니다.",
    },
    {
      q: "어떤 채널을 지원하나요?",
      a: "채널마다 가능한 연결 방식이 다릅니다. 되는 것처럼 미리 적어두지 않고, 진단에서 판매자님이 쓰시는 채널 기준으로 확인해 알려드립니다.",
    },
    {
      q: "답변을 대신 보내주나요?",
      a: "보내지 않습니다. 초안을 준비하는 데까지가 SellerOps의 몫이고, 고객에게 나가는 것은 판매자가 확인하고 직접 누릅니다.",
    },
    {
      q: "설치가 필요한가요?",
      a: "운영 화면은 웹 브라우저에서 사용합니다. 채널에 따라 연결 과정에 사람의 확인 단계가 필요할 수 있으며, 그런 경우 진단에서 미리 알려드립니다.",
    },
    {
      q: "고객 개인정보는 어떻게 다루나요?",
      a: "운영에 필요한 최소한만 다룹니다. 고객 개인정보와 계정 정보는 운영 화면에 노출하지 않습니다.",
    },
    {
      q: "지금 바로 쓸 수 있나요?",
      a: "쓰시는 채널과 자료 상태에 따라 다릅니다. 진단에서 지금 가능한 범위를 먼저 확인해 드립니다.",
    },
  ],
} as const;

// ─── 12. Call to action ────────────────────────────────────────────────────────────────────────

export const CLOSING = {
  heading: "먼저 무엇이 쌓여 있는지부터 보시죠",
  body: "자료를 보내주시면, 운영자가 확인할 수 있는 고객 이슈를 한 장으로 정리해 드립니다.",
  deliverablesTitle: "정리해 드리는 것",
  deliverables: [
    "반복해서 들어오는 문의",
    "방치되고 있는 부정 리뷰",
    "FAQ로 만들 후보",
    "상세페이지에서 고칠 후보",
  ],
  note: "계정 정보나 비밀번호는 필요하지 않습니다.",
} as const;

// ─── Page metadata ─────────────────────────────────────────────────────────────────────────────

export const PAGE_META = {
  title: "SellerOps — 온라인 판매자를 위한 AI 고객운영 도구",
  description:
    "채널마다 흩어진 문의와 리뷰를 한곳에 모아 정리하고, 반복되는 고객 문제를 기억해 놓치면 안 되는 신호만 남깁니다.",
} as const;
