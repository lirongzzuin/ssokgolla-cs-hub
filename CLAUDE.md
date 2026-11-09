# ssokgolla-cs-hub — 작업 규칙

쏙골라마켓(스마트스토어·쿠팡 위탁판매)의 CS 자동화 허브.
채널톡 ALF 태스크가 호출하는 단순한 JSON API를 제공하고, 상담 이벤트를 쌓아 운영 리포트를 만든다.
공개 저장소다. 깊이보다 명확한 구조, 읽기 쉬운 코드, 정리된 문서를 우선한다.

설계 전체는 `docs/architecture.md`에 있다. 이 파일에는 코드를 쓸 때 지킬 규칙만 적는다.

## 스택 (변경 금지)
Cloudflare Workers · TypeScript(strict) · Hono · zod · D1(ORM 없음, SQL 마이그레이션) · Vitest · Cron Triggers · Biome(lint/format)

- 새 의존성을 추가하려면 먼저 이유를 말하고 사용자 확인을 받는다.
- 확인된 의존성: `hono`, `zod`, `wrangler`, `typescript`, `vitest`, `@cloudflare/vitest-pool-workers`, `@cloudflare/workers-types`, `@biomejs/biome`
- `scripts/*.ts`는 Node 24의 기본 TS 실행(`node scripts/x.ts`)으로 돌린다. tsx는 쓰지 않는다.

## 명령어
```bash
npm run dev        # wrangler dev (로컬 D1, DATA_SOURCE=mock)
npm test           # vitest
npm run typecheck
npm run lint       # biome check
npm run db:migrate # 로컬 D1 마이그레이션
npm run seed       # mock 주문 20건
npm run report     # 운영 지표 마크다운 표
```

## 모듈 규칙
- 기능 하나 = `src/modules/<name>/` 폴더 하나. 모듈은 자기 폴더 안에서 완결된다.
- **다른 모듈은 그 모듈의 `index.ts`가 export한 것만 import한다.** `modules/orders/service.ts`를 직접 import하지 않는다.
- 새 기능을 추가할 때: `src/modules/<new>/` 폴더를 만들고 → `index.ts`에서 라우트(Hono 서브앱)와 공개 함수를 export하고 → `src/index.ts`에 `app.route()` 한 줄만 추가한다. 서비스 조립이 필요하면 `src/app/container.ts`에 추가한다.
- `src/index.ts`에는 라우트 마운트와 scheduled 핸들러 연결만 둔다. 로직을 넣지 않는다.
- 계층은 `routes → service → repository`이다. 서비스와 정책은 Hono `Context`를 모른다(인자로 받은 값만 쓴다).
- `orders/policy.ts`는 순수 함수다. DB, 시간(`Date.now()`), env에 의존하지 않고 현재 시각은 인자로 받는다. 정책 수치는 `orders/policy.config.ts`에 둔다. 테스트 커버리지를 가장 높게 유지한다.
- DI 라이브러리를 쓰지 않는다. `container.ts`는 `env`를 받아 객체를 만드는 평범한 함수다.

## 외부 API 원칙
1. **엔드포인트·필드명·인증 방식을 추측해서 쓰지 않는다.** 공식 문서로 확인한 것만 쓰고, 확인한 URL과 확인일을 코드 주석에 남긴다.
2. 확인하지 못한 것은 인터페이스와 mock만 만들고 `// TODO(verify-api): <무엇을 확인해야 하는지>`를 남긴다.
3. 모든 외부 호출은 `src/adapters/` 아래 인터페이스 구현체로만 한다. 도메인 코드(`modules/`)는 외부 API의 형식을 모른다. 외부 상태값은 어댑터 안에서 통합 상태(`OrderStatus`)로 변환한다.
4. `DATA_SOURCE=mock|live`로 어댑터를 바꾼다. 기본값은 `mock`이다. 키가 없어도 `npm run dev` 하나로 전체 흐름이 돌아가야 한다.
5. 이미 확인한 사실의 출처는 `docs/architecture.md` "외부 API 확인 현황"에 모은다. 새로 확인하면 그 표도 갱신한다.

## 개인정보
- 전화번호 전체, 실명, 주소 원문은 저장하지 않고 로그에도 남기지 않는다. 저장하는 값은 `phone_last4`와 마스킹된 이름(`김*수`)뿐이다.
- `logger.ts`는 전화번호·이름·주소 패턴을 마스킹한다. 로그는 반드시 이 로거로 남긴다.
- 테스트 픽스처, seed, 문서 예시에는 가짜 값만 쓴다(`홍*동`, `010-0000-1234`).
- "쏙골라마켓"은 실제 운영 중인 스마트스토어 상호이고, 운영 경험을 보여주기 위해 공개 저장소에서도 그대로 쓴다. 대신 사업자등록번호, 판매자 연락처·주소, 실제 주문번호, 공급처 실명, 매입가·마진 같은 실제 운영 값은 코드·문서·커밋 어디에도 넣지 않는다. 공급처는 `SUPPLIER_A` 같은 코드로만 쓴다.
- `customerMessage`에는 공급처 이름, 공급처 주문번호, 매입가 같은 위탁판매 내부 정보를 넣지 않는다. 송장 근거 없는 도착일을 약속하지 않는다. 테스트로 이를 검증한다.

## 코드 스타일
- 함수는 짧게, 파일 하나에 책임 하나.
- 에러는 `app/errors.ts`의 공통 에러 타입(`AppError` 계열)으로 던지고, 전역 에러 핸들러가 응답으로 바꾼다. 라우트에 try/catch를 늘어놓지 않는다.
- 주석에는 "무엇"이 아니라 "왜"를 쓴다. 한국어 주석을 쓴다.
- 입출력 검증은 zod 스키마 하나에서 타입까지 뽑는다(`z.infer`).

## 커밋
- Conventional Commits 형식: `feat(orders): ...`, `fix(alf-tasks): ...`, `docs: ...`, `test(policy): ...`, `chore: ...`
- Phase 안에서도 의미 단위로 나눠 커밋한다(설정 / 마이그레이션 / 정책+테스트 / ...).
- `.dev.vars`는 커밋하지 않는다. 대신 `.dev.vars.example`을 둔다.

## 하지 않는 것
프론트엔드 대시보드, 공급처 크롤링·자동 발주, 인증 시스템·멀티 테넌시·큐 같은 과한 인프라, 확인되지 않은 외부 API 스펙 지어내기.
