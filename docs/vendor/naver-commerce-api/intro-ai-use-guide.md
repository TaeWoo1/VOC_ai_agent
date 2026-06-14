---
id: ai-use-guide
title: "AI 활용 가이드"
description: "LLM 도구에서 커머스API 문서를 더 효율적으로 탐색하고 활용하는 방법을 안내합니다."
hide_title: true
custom_edit_url: null
---

# AI 활용 가이드

커머스API 문서는 사람뿐 아니라 AI 도구도 활용할 수 있는 개발자 문서입니다.  
이 문서에서는 커머스API의 `llms.txt` 파일을 활용해 LLM(대규모 언어 모델) 도구에서 문서를 더 효율적으로 탐색하고, 연동에 필요한 정보를 빠르게 찾는 방법을 안내합니다.

---

## llms.txt란

`llms.txt`는 AI 도구와 에이전트가 웹사이트의 핵심 정보를 효율적으로 이해하고 탐색할 수 있도록 구조화한 마크다운 기반의 안내 파일입니다. `robots.txt`가 검색 엔진 크롤러를 위한 표준이라면, `llms.txt`는 LLM을 위한 문서 접근 표준입니다.

AI 도구가 일반 HTML 페이지를 처리할 때는 내비게이션, 스크립트, 스타일시트 등의 요소를 함께 읽어 컨텍스트 윈도우를 비효율적으로 소모합니다. `llms.txt` 파일은 이러한 노이즈를 제거하고, API 문서의 구조와 핵심 정보만을 LLM이 바로 처리할 수 있는 형태로 제공합니다.

`llms.txt` 표준의 자세한 내용은 [llms-txt](https://llmstxt.org)를 참고하십시오.

---

## 커머스API llms.txt

### 제공 파일

| 파일 | URL | 설명 |
|------|-----|------|
| `llms.txt` | https://apicenter.commerce.naver.com/llms/llms.txt | 커머스API 문서 구조 및 도메인별 상세 문서 링크를 제공하는 인덱스 파일 |

`llms.txt` 파일은 커머스API의 전체 도메인 구조를 마크다운 형식으로 요약하며, 각 API 그룹별 상세 문서 파일(.md) 링크를 포함합니다. AI 도구는 이 파일을 시작점으로 삼아 필요한 API 영역의 상세 스펙을 탐색할 수 있습니다.

### 포함 범위

현재 `llms.txt` 파일에서 접근할 수 있는 API 문서는 다음과 같습니다.

| API 그룹 | 포함 내용 |
|----------|----------|
| 인증 | OAuth 2.0 Client Credentials 방식 인증 토큰 발급 |
| 상품 | 상품 등록, 수정, 조회, 삭제, 카테고리별 속성 조회 |
| 주문 | 주문 조회, 발주/발송 처리, 취소/반품/교환 |
| 정산 | 주문 정산 내역, 매출 합산 데이터, 수수료 조회 |
| 문의 | 고객 문의 조회, 답변 등록/수정 |
| 물류 | 판매자 창고 정보, SKU 단위 물류 데이터 |
| 커머스솔루션 | 솔루션 서비스 연동, 이용 약관 처리 |
| 판매자정보 | 판매자 계정, 스토어, 채널 정보 조회 |
| API데이터솔루션 | 스토어 매출/방문자 통계, 쇼핑 검색 트렌드 |

---

## 활용 상황

### 외부 개발사

- 스마트스토어 연동에 필요한 인증, 상품, 주문 문서를 빠르게 찾고 싶은 경우
- 특정 기능 구현을 위해 어떤 API를 먼저 검토해야 하는지 파악하고 싶은 경우
- 연동 중 발생한 오류 원인이나 FAQ를 빠르게 확인하고 싶은 경우

### 판매자 또는 운영 담당자

- 주문 처리 자동화, 상품 관리 자동화, 정산 조회 자동화에 필요한 API 범위를 파악하고 싶은 경우
- 문의 대응, 물류 연동, 판매자정보 조회 등 운영 업무를 API로 연결할 수 있는지 검토하고 싶은 경우

---

## 권장 활용 방법

커머스API의 `llms.txt` 파일은 **AI 도구에 문서 탐색의 시작점을 제공하는 용도**로 사용하는 것을 권장합니다.

1. 사용하는 AI 도구에 `llms.txt` 파일 주소를 전달합니다.
2. 구현하려는 업무 목적과 조건을 함께 설명합니다.
3. 관련 문서, 필요한 API, 인증 방식, 주의사항을 정리해 달라고 요청합니다.
4. 상세 스펙이 필요한 경우, `llms.txt` 파일에 링크된 개별 .md 문서를 추가로 전달합니다.
5. 실제 개발 또는 운영 반영 전에는 반드시 원문 API 문서를 다시 확인합니다.

---

## 프롬프트 예시

### 예시 1. 주문 변경분 수집 API 찾기

```text
다음 커머스API llms.txt를 기준으로 주문 변경분을 주기적으로 수집하려고 합니다.
https://apicenter.commerce.naver.com/llms/llms.txt

목표:
- 주문 상태 변경분을 주기적으로 조회
- 필요한 인증 방식과 관련 FAQ도 함께 확인
- 어떤 API를 어떤 순서로 검토하면 좋은지 정리

출력 형식:
1. 관련 문서
2. 우선 검토할 API
3. 구현 시 주의사항
4. 추가로 읽어야 할 FAQ
```

### 예시 2. 상품 등록 자동화 범위 파악

```text
다음 커머스API llms.txt를 기준으로 상품 등록 자동화를 검토하고 있습니다.
https://apicenter.commerce.naver.com/llms/llms.txt

원하는 결과:
- 상품 등록/수정과 관련된 문서 정리
- 인증과 사전 준비사항 정리
- 자주 발생할 수 있는 오류나 FAQ 정리
- 구현 순서를 단계별로 제안
```

### 예시 3. 상세 API 스펙 기반 코드 생성

`llms.txt` 파일은 문서 탐색의 시작점입니다. 특정 API의 파라미터, 응답 스키마, 오류 코드까지 정확하게 참조하려면 `llms.txt` 파일에 링크된 개별 상세 문서(.md)를 함께 전달하는 것이 효과적입니다.

```text
다음 문서들을 참고해 주세요.

1. 커머스API 전체 구조: https://apicenter.commerce.naver.com/llms/llms.txt
2. 교환 수거 완료 API: https://apicenter.commerce.naver.com/llms/post-v1-pay-order-seller-product-orders-productOrderId-claim-exchange-collect-approve.md
3. 교환 재배송 처리 API: https://apicenter.commerce.naver.com/llms/post-v1-pay-order-seller-product-orders-productOrderId-claim-exchange-dispatch.md

위 문서를 기반으로 교환 후속 처리 플로우(수거 완료 → 재배송)의
각 단계별 API 호출 순서와 요청/응답 구조를 정리해 주세요.
```

---

## LLM 도구별 적용 가이드

모든 LLM 도구의 기본 패턴은 동일합니다. `llms.txt` 파일의 URL을 전달하거나, 파일을 다운로드해 첨부한 뒤 업무 목적을 함께 설명합니다. 다음은 도구별 특성에 따른 권장 방식입니다.

### 웹 기반 LLM

| 도구 | URL 직접 전달 | 파일 업로드 | 비고 |
|------|:---:|:---:|------|
| **ChatGPT** | ✅ | ✅ | URL을 프롬프트에 포함하면 웹 검색으로 문서를 직접 읽습니다. |
| **Claude** | ✅ | ✅ | URL 전달 시 웹 검색으로 내용을 참조합니다. 더 확실한 컨텍스트를 제공하려면 파일 첨부를 권장합니다. |
| **Gemini** | ✅ | ✅ | URL을 직접 읽을 수 있습니다. |
| **Gemini in Chrome** | — | — | 브라우저에서 `llms.txt` 파일을 열어둔 상태에서 현재 탭 기반으로 질문할 수 있습니다. |

**공통 사용 예시:**

```text
다음 커머스API llms.txt를 기준으로 관련 문서를 찾아 주세요.
https://apicenter.commerce.naver.com/llms/llms.txt

목표는 주문 조회와 발송 처리 자동화입니다.
관련 문서, 인증 방식, FAQ까지 함께 정리해 주세요.
```

### 데스크톱 앱

| 도구 | URL 직접 전달 | 파일 업로드 | 비고 |
|------|:---:|:---:|------|
| **ChatGPT Desktop** | ✅ | ✅ | 웹 버전과 동일하게 URL 전달 또는 파일 첨부 모두 가능합니다. |
| **Claude Desktop** | ✅ | ✅ | 파일 드래그 앤 드롭으로 첨부할 수 있습니다. |

파일 업로드 방식은 문서를 명시적으로 컨텍스트에 포함하고 싶을 때 유용합니다. `llms.txt` 파일과 함께 필요한 상세 문서(.md)를 추가로 첨부하면 더 정확한 답변을 받을 수 있습니다.

### AI 기반 코딩 에디터

AI 기반 코딩 에디터를 사용하는 경우, 커머스API `llms.txt` 파일을 외부 문서(Docs)로 등록해 코드 작성 시 참조 컨텍스트로 활용할 수 있습니다.

**Cursor**

1. Settings > Indexing & Docs에서 **Add Doc**을 클릭합니다.
2. URL에 `https://apicenter.commerce.naver.com/llms/llms.txt`를 입력해 등록합니다.
3. 채팅에서 `@Docs`로 등록된 커머스API 문서를 컨텍스트로 지정합니다.

**VS Code (GitHub Copilot)**

프로젝트 루트에 `.github/copilot-instructions.md` 파일을 생성해 참조 정보를 작성합니다.

```markdown
## 네이버 커머스API 연동 참조
- API 문서 (LLM용): https://apicenter.commerce.naver.com/llms/llms.txt
- Base URL: https://api.commerce.naver.com/external
- 인증: OAuth 2.0 Client Credentials (Bearer Token)
```

**Windsurf**

Cascade 패널에서 `@` 멘션을 사용해 `@https://apicenter.commerce.naver.com/llms/llms.txt` 형태로 문서를 직접 참조할 수 있습니다.

---

## 유의 사항

- **AI 도구의 응답은 항상 검증이 필요합니다.** LLM이 생성한 코드나 설명은 API 문서의 실제 스펙과 다를 수 있습니다. 프로덕션 적용 전 반드시 공식 API 문서를 확인하고 실제 API를 호출해 검증하십시오.
- **AI가 문서에 없는 내용을 추측할 수 있습니다.** 불확실한 내용은 원문 문서에서 다시 확인해야 합니다.
- **인증 정보를 AI 도구에 입력하지 마십시오.** 애플리케이션 시크릿(Application Secret), 인증 토큰 등 민감 정보는 AI 대화에 포함하지 않도록 주의하십시오.
- **`llms.txt` 파일은 OpenAPI 스펙 기반으로 생성됩니다.** API 변경 시 `llms.txt` 파일도 함께 업데이트되지만, 반영 시점에 차이가 있을 수 있습니다. 최신 스펙이 필요한 경우 [API 레퍼런스](https://apicenter.commerce.naver.com)를 함께 확인하시기 바랍니다.
- **`llms.txt` 파일은 API 문서 정보만 포함합니다.** 커머스API 센터 가입, 애플리케이션 등록 등 서비스 이용 절차는 포함되지 않습니다.