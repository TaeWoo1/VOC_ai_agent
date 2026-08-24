# PUT /v1/contents/qnas/{questionId} - 상품 문의 답변 등록/수정

스마트스토어 상품 페이지에 등록된 고객의 상품 문의(QnA)에 대해 판매자가 답변을 신규 등록하거나 이미 등록된 답변 내용을 수정할 때 사용하는 API입니다. 경로 파라미터로 답변 대상 상품 문의 ID(questionId)를 지정하고, 요청 본문의 commentContent에 답변 본문(평문 또는 약식 마크업)을 담아 호출합니다. CS 운영 시스템에서 상품 문의 목록을 폴링하여 미답변 건을 적재한 뒤 답변 템플릿이나 상담사 작성 본문을 본 API로 일괄 반영하는 워크플로우에 주로 사용되며, 동일 questionId에 다시 호출하면 등록이 아닌 수정으로 동작하므로 호출 직전에 최신 답변 상태를 한 번 더 조회해 덮어쓰기 사고를 예방하는 편이 안전합니다. 답변 본문이 비어 있거나 길이/금칙어 정책에 위배되면 400 BAD_REQUEST가 반환되고, 토큰 누락·만료 시 401 UNAUTHORIZED, 해당 문의에 대한 답변 권한이 없거나 다른 판매자의 문의일 때 403 FORBIDDEN이 반환됩니다. 요청한 questionId 자체가 존재하지 않거나 이미 삭제된 경우에는 404 NOT_FOUND가 떨어지므로 입력 파라미터 검증과 사전 조회 결과를 호출 트리거 기준으로 사용하는 것이 좋습니다. 500 INTERNAL_SERVER_ERROR는 일시적 장애 가능성이 높으므로 지수 백오프와 함께 제한된 횟수 내에서 재시도하고, 재시도해도 동일하게 실패하면 운영 채널로 에스컬레이션합니다.

> Base URL: https://api.commerce.naver.com/external

### 요청 파라미터

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| questionId | path | integer(int64) | 필수 | 상품 문의 ID |

### 요청 본문

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| commentContent | body | string | 필수 |  |

### 에러 코드

| 상태 코드 | 설명 |
|-----------|------|
| 400 | 잘못된 요청<br>- code : BAD_REQUEST |
| 401 | 인가되지 않은 요청<br>- code : UNAUTHORIZED |
| 403 | 권한 없음<br>- code : FORBIDDEN |
| 404 | 데이터 없음<br>- code : NOT_FOUND |
| 500 | 내부 서버 오류<br>- code : INTERNAL_SERVER_ERROR |

### 호출 예시

```bash
curl -X PUT 'https://api.commerce.naver.com/external/v1/contents/qnas/{questionId}' \
  -H 'Authorization: Bearer {access_token}' \
  -H 'Content-Type: application/json' \
  -d '{ ... }'
```