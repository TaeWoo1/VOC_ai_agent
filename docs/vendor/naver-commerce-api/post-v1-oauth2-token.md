# POST /v1/oauth2/token - 인증 토큰 발급 요청

이 endpoint 는 네이버 커머스 API 호출에 필요한 OAuth 2.0 액세스 토큰을 발급받는 인증 관문으로, 모든 외부 API 호출 전에 선행적으로 호출됩니다. 외부 시스템은 grant_type=client_credentials 와 함께 client_id, timestamp, client_secret_sign 전자서명을 전달하며, type=SELF 로 자기 애플리케이션 리소스를 다루거나 type=SELLER 로 위임받은 판매자 리소스를 호출할 때 account_id 를 함께 포함합니다. timestamp 는 밀리초 단위 Unix 시간이고 생성 후 5분 이내에만 유효하므로 호출 측 서버 시각을 NTP 등으로 사전 동기화해야 하고, client_secret_sign 은 인증 가이드의 전자서명 생성 절차를 그대로 따라 만들어야 합니다. 응답으로 반환되는 access_token 은 expires_in 초 동안만 유효하므로 만료 직전 재발급하거나 만료 구간 내에서 메모리 캐시에 보관해 호출당 토큰 발급 비용과 지연을 줄이는 운영이 권장됩니다. 400 응답은 client_id·timestamp·전자서명 등 요청 본문 유효성 검사 실패를 의미하므로 입력값과 전자서명 생성 로직을 재확인하고, 403 응답은 애플리케이션 권한이나 SELLER type 의 account_id 권한 부족을 의미하므로 콘솔에서 권한·구독 상태를 점검합니다. 500 응답은 일시적인 내부 시스템 오류이므로 적절한 백오프와 지터를 두고 재시도하여 정상화 직후 호출이 자연스럽게 복원되도록 합니다.

> Base URL: https://api.commerce.naver.com/external

### 요청 본문

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| client_id | body | string | 필수 | 제공된 애플리케이션 ID |
| timestamp | body | integer(int64) | 필수 | 전자서명 생성 시 사용된 밀리초(millisecond) 단위의 Unix 시간. 5분간 유효 |
| grant_type | body | string | 필수 | OAuth2 인증 방식. <br/>- 고정값 client_credentials 사용. 허용값: `client_credentials` |
| client_secret_sign | body | string | 필수 | <a href="#section/인증/전자서명">전자서명 생성 방법</a>을 따라 생성된 전자서명 |
| type | body | string | 필수 | 인증 토큰 발급 타입. SELF인 경우 자기 자신의 리소스, SELLER인 경우 관련 판매자의 리소스에 대한 발급.. 허용값: `SELLER`, `SELF` |
| account_id | body | string |  | type이 SELLER인 경우 입력해야 하는 판매자 ID 혹은 판매자 UID |

### 응답 스키마

| 이름 | 위치 | 타입 | 필수 | 설명 |
|------|------|------|:----:|------|
| access_token | - | string |  | 인증 토큰 |
| expires_in | - | integer(int64) |  | 인증 유효 기간(초) |
| token_type | - | string |  | 인증 토큰 종류 |

### 에러 코드

| 상태 코드 | 설명 |
|-----------|------|
| 400 | 유효성 검사 오류 |
| 403 | 접근 권한 오류 |
| 500 | 일시적인 내부 시스템 오류 |

### 사용 enum 카탈로그

- 요청 본문 `grant_type`: `client_credentials`
- 요청 본문 `type`: `SELLER`, `SELF`

### 호출 예시

```bash
curl -X POST 'https://api.commerce.naver.com/external/v1/oauth2/token' \
  -H 'Authorization: Bearer {access_token}' \
  -H 'Content-Type: application/json' \
  -d '{ ... }'
```