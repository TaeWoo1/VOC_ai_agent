# RESTful API

커머스API는 RESTful API 규격을 지향합니다.

### Content Type

파일 업로드/다운로드 요청과 같은 예외적인 동작을 제외한 연동 메시지의 기본 형식은 JSON입니다.

### Charset

요청 시 파라미터 및 메시지는 'UTF-8'로 인코딩되어야 합니다. 또한 응답 메시지는 'UTF-8'로 인코딩되어 있습니다.

### 날짜 및 시간 형식

날짜 및 시간과 관련된 API 응답은 [ISO 8601](https://www.w3.org/TR/NOTE-datetime) 규격을 따르며 오프셋은 `KST(UTC+09:00)`로 표현합니다.

#### 날짜 시간

⚠️API 요청 시 날짜 시간 데이터는 포맷을 정확하게 맞추어 요청해야 예상치 못한 오류를 방지할 수 있습니다.

```bash
# '+09:00' 표현
{Java DateTimeFormat: yyyy-MM-dd'T'HH:mm:ss.SSSXXX}
2022-01-01T01:01:01.001+09:00
```

#### 날짜

커머스API는 요청 날짜 데이터를 `KST(UTC+09:00)` 기준으로 처리합니다.

- 연월일

```bash
{Java DateTimeFormat: yyyy-MM-dd}
2022-07-25
```

- 연월

```bash
{Java DateTimeFormat: yyyy-MM}
2022-07
```

#### 파싱과 포맷팅 예제
- JAVA

```java
// 파싱
ZonedDateTime.parse("2023-07-25T10:10:10.100+09:00");

// 포맷팅
DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX").format(ZonedDateTime.now());
// Instant.java 를 이용한 경우 - 포맷 준수에 대한 주의
DateTimeFormatter.ofPattern("yyyy-MM-dd'T'HH:mm:ss.SSSXXX").format(Instant.now().atZone(ZoneOffset.of("+09:00")));
```

### HTTP 상태 코드

커머스API는 응답 메시지 외 HTTP 상태 코드로 처리 결과를 전달합니다.

|   코드    | 의미                     | 설명                                                                                                                                                                                                                                                                                                  |
|:-------:|:-----------------------|-----------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------|
| **2xx** | **성공**                 | **요청을 성공적으로 받고 인식하고 수용함**                                                                                                                                                                                                                                                                           |
|   200   | OK                     | 서버가 요청을 처리했습니다.                                                                                                                                                                                                                                                                                     |
|   201   | Created                | 서버가 요청을 처리하여 새 리소스를 작성했습니다. 예: POST 요청에 대한 정상 처리 결과                                                                                                                                                                                                                                             |
|   202   | Accepted               | 서버가 요청을 접수했지만 아직 처리하지 않았습니다.                                                                                                                                                                                                                                                                        |
|   204   | No Content             | 서버가 요청을 처리했지만 응답 콘텐츠를 제공하지 않습니다. 예: POST, PUT, PATCH, DELETE 요청에 응답이 필요 없는 경우(참고: [https://tools.ietf.org/html/rfc2616](https://tools.ietf.org/html/rfc2616), [https://tools.ietf.org/html/rfc5789](https://tools.ietf.org/html/rfc5789)) |
| **3xx** | **리다이렉션**              | **요청 완료를 위해 추가 조치가 필요함**                                                                                                                                                                                                                                                                            |
|   301   | Moved Permanently      | 요청이 새 위치로 영구적으로 이동했습니다.                                                                                                                                                                                                                                                                             |
| **4xx** | **클라이언트 오류**           | **요청의 문법이 잘못되었거나 요청을 처리할 수 없음**                                                                                                                                                                                                                                                                     |
|   400   | Bad Request            | 서버가 요청의 구문을 인식하지 못했습니다. 예: 요청 데이터의 유효성 검사(validation) 오류에 대한 응답                                                                                                                                                                                                                                 |
|   401   | Unauthorized           | 적절한 인증 과정 없이 API를 호출했습니다. 예: 로그인 또는 토큰 인증이 필요한 API                                                                                                                                                                                                                                              |
|   403   | Forbidden              | 서버가 요청을 거부하고 있습니다. 예: 사용자가 리소스에 대한 필요 권한을 갖고 있지 않은 경우                                                                                                                                                                                                                                           |
|   404   | Not Found              | 요청한 URI path에 해당하는 리소스가 존재하지 않습니다. 예: 조회 리소스를 특정(unique)하여 상세 데이터를 요청했지만 존재하지 않는 경우                                                                                                                                                                                                             |
|   405   | Method Not Allowed     | 요청에 지정된 방법을 사용할 수 없습니다. 예: POST 요청을 받는 서버에 GET 요청을 보내거나 읽기 전용 리소스에 PUT 요청을 보내는 경우                                                                                                                                                                                                               |
|   406   | Not Acceptable         | 요청한 리소스가 요청한 콘텐츠 특성(미디어 타입)으로 응답할 수 없습니다. 예: JSON만 지원하는 API에서 'Accept: text/yaml'로 요청한 경우                                                                                                                                                                                                       |
|   409   | Conflict               | 서버가 요청을 수행하는 중에 충돌이 발생했습니다. 요청 처리가 비지니스 로직상 불가능하거나 모순이 있습니다. 예: DELETE 요청으로 이미 삭제된 리소스를 또 삭제 요청하거나 POST 요청으로 두 명의 사용자가 거의 동시에 ID 중복 확인 후 회원 가입하려는 경우                                                                                                                                            |
|   415   | Unsupported Media Type | 요청이 지원하지 않는 형식으로 작성되어 있습니다. 예: JSON만 지원하는 API에서 'Content-Type: text/yaml'로 요청한 경우                                                                                                                                                                                                               |
|   429   | Too Many Requests      | 사용자가 일정 시간 동안 너무 많은 요청을 보냈습니다. 예: API 일 호출 쿼터를 초과하여 호출하거나 API 요청이 요청량 제한을 초과한 경우                                                                                                                                                                                                                |
| **5xx** | **서버 오류**              | **서버가 명백히 유효한 요청에 대해 충족을 실패함**                                                                                                                                                                                                                                                                      |
|   500   | Internal Server Error  | 오류가 발생하여 요청을 수행할 수 없습니다.                                                                                                                                                                                                                                                                            |
|   502   | Bad Gateway            | API 서버에 문제가 발생하여 정상적으로 API 요청을 전달할 수 없습니다.                                                                                                                                                                                                                                                          |
|   503   | Service Unavailable    | API 서버가 과부하 상태거나 유지 관리를 위해 정지되었기 때문에 현재 서버를 사용할 수 없습니다.                                                                                                                                                                                                                                             |
|   504   | Gateway Timeout        | API 서버로부터 응답을 기다렸지만 제한된 시간까지 대기해도 응답을 받지 못했습니다.                                                                                                                                                                                                                                                     |

### 응답 헤더

커머스API는 요청 처리 결과를 다음과 같은 헤더 값으로 전달합니다.

- `GNCP-GW-Trace-ID`: API 요청마다 생성되는 고유한 ID(Trace ID)
- `GNCP-GW-HttpClient-ResponseTime`: 커머스API 요청 처리 타임스탬프(단위: ms)

## 호스트

커머스API 연동 개발을 위해서 제공하는 운영 환경 호스트는 다음과 같습니다.

`https://api.commerce.naver.com/external`

⚠️ 실제 운영 중인 스토어에 API를 이용한 테스트를 하여 문제가 발생한 경우 커머스API센터에서 책임지지 않으니 주의하시기 바랍니다.
