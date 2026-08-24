# PUT /v1/pay-merchant/inquiries/{inquiryNo}/answer/{answerContentId} - 고객 문의 답변 수정

스마트스토어 결제(페이) 영역의 고객 문의(주문/배송/환불 등)에 이미 등록되어 있는 답변 내용을 판매자가 수정할 때 사용하는 API입니다. 경로 파라미터로 대상 문의 번호(inquiryNo)와 수정 대상 답변 번호(answerContentId)를 함께 지정하고, 요청 본문의 answerComment에 새 답변 본문을 담아 호출하며 선택적으로 answerTemplateId로 사전 등록한 답변 템플릿을 연결할 수 있습니다. CS 자동화 시스템에서 오타 정정·추가 안내·문구 표준화 같은 후속 정정 워크플로우에 주로 사용되며, 동일한 inquiryNo·answerContentId 조합에 대해 동시 수정이 발생하지 않도록 호출 직전에 최신 상태를 한 번 더 조회해 충돌 가능성을 낮추는 편이 안전합니다. 400 응답에는 ERR-NC-101001(요청 형식 오류), ERR-NC-101004(문의 없음/삭제됨), ERR-NC-101005(문의 유효하지 않음), ERR-NC-101007(답변 권한 없음), ERR-NC-101008(판매자 번호 유효하지 않음), ERR-NC-101010(이미 답변 존재)이 세분화되어 내려오므로 단순 재시도 대신 코드별로 사용자 안내·검증 흐름을 분기해야 합니다. 특히 ERR-NC-101010은 이미 답변이 등록된 상태이므로 본 PUT 호출이 아니라 신규 등록 경로와 헷갈리지 않았는지 점검할 필요가 있습니다. 500 ERR-NC-101006은 서버 일시 장애이므로 지수 백오프와 함께 제한된 횟수 내에서 재시도하고, 반복되면 운영 채널로 에스컬레이션합니다.

> Base URL: https://api.commerce.naver.com/external

### 요청 파라미터

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| inquiryNo | path | integer(int64) | 필수 | 문의 번호 |
| answerContentId | path | integer(int64) | 필수 | 답변 번호 |

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
curl -X PUT 'https://api.commerce.naver.com/external/v1/pay-merchant/inquiries/{inquiryNo}/answer/{answerContentId}' \
  -H 'Authorization: Bearer {access_token}' \
  -H 'Content-Type: application/json' \
  -d '{ ... }'
```