# POST /v1/pay-merchant/inquiries/{inquiryNo}/answer - 고객 문의 답변 등록

스마트스토어 결제(페이) 영역의 고객 문의(주문/배송/환불 등)에 대해 판매자가 답변을 신규 등록할 때 사용하는 API입니다. 경로 파라미터로 답변 대상 문의 번호(inquiryNo)를 지정하고, 요청 본문의 answerComment에 답변 본문을 담아 호출하며 선택적으로 answerTemplateId로 사전에 저장된 답변 템플릿을 연결할 수 있습니다. CS 자동화 시스템에서는 문의 목록을 폴링해 미답변 건을 적재한 뒤 표준 템플릿이나 상담사 입력 본문을 본 API로 일괄 등록하는 워크플로우가 일반적이며, 동일 inquiryNo에 중복 호출하면 ERR-NC-101010(이미 답변 존재) 오류가 발생하므로 호출 직전에 답변 등록 여부를 한 번 더 확인하거나 idempotency 가드를 두는 것이 안전합니다. 400 응답에는 ERR-NC-101001(요청 형식 오류), ERR-NC-101004(문의 없음/삭제됨), ERR-NC-101005(문의 유효하지 않음), ERR-NC-101007(답변 권한 없음), ERR-NC-101008(판매자 번호 유효하지 않음), ERR-NC-101010(중복 답변)이 세분화되어 내려오므로 코드별로 재시도·권한 안내·중복 회피 등 후속 행동을 분기해야 합니다. 500 ERR-NC-101006은 서버 일시 장애이므로 지수 백오프와 함께 제한된 횟수 내에서 재시도합니다. 권한 또는 판매자 번호 관련 오류는 토큰의 권한 범위와 매핑 상태를 먼저 점검한 후 재호출하는 것이 좋습니다.

> Base URL: https://api.commerce.naver.com/external

### 요청 파라미터

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| inquiryNo | path | integer(int64) | 필수 | 문의 번호 |

### 요청 본문

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| answerComment | body | string | 필수 | 답변 내용 |
| answerTemplateId | body | string |  | 답변 템플릿 ID |

### 응답 스키마

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| code | - | string |  |  |
| message | - | string |  |  |
| data | - | object |  |  |
| timestamp | - | string(date-time) |  |  |
| traceId | - | string |  |  |

### 에러 코드

| 상태 코드 | 설명 |
|-----------|------|
| 400 | ## Bad Request<br>----------<br>코드 \| 설명 <br>-----\|-----<br>ERR-NC-101001 \| 정상적인 요청이 아닌 경우<br>ERR-NC-101004 \| 문의 번호에 해당하는 문의가 없거나 삭제된 경우<br>ERR-NC-101005 \| 문의가 유효하지 않은 경우<br>ERR-NC-101007 \| 답변 권한이 없는 경우<br>ERR-NC-101008 \| 판매자 번호가 유효하지 않은 경우<br>ERR-NC-101010 \| 해당 문의에 이미 답변이 존재하는 경우 |
| 500 | ## Internal Server Error<br>----------<br>코드 \| 설명 <br>-----\|-----<br>ERR-NC-101006 \| 서버 내부 오류<br> |

### 호출 예시

```bash
curl -X POST 'https://api.commerce.naver.com/external/v1/pay-merchant/inquiries/{inquiryNo}/answer' \
  -H 'Authorization: Bearer {access_token}' \
  -H 'Content-Type: application/json' \
  -d '{ ... }'
```