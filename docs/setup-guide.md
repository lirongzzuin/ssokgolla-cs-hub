# 설정 가이드 — 직접 해야 하는 일 (시간순)

코드는 모두 준비되어 있다. 아래는 사람이 PC·채널톡 화면에서 직접 해야 하는 일을 순서대로 적은 것이다.
서버를 상시 운영하지 않는다. **채널톡을 연결해 테스트하는 동안만** 내 PC에서 허브를 켜고 임시 터널로 연다.

| 단계 | 할 일 | 시간 |
|---|---|---|
| 0 | 준비물 확인 | 5분 |
| 1 | 프로젝트 준비 | 5분 |
| 2 | 지식 값 채우기 | 15분 |
| 3 | 허브 켜기 + 임시 주소 받기 *(테스트할 때마다)* | 3분 |
| 4 | 채널톡: 웹훅 연결 | 10분 |
| 5 | 채널톡: 연결 확인 태스크 | 15분 |
| 6 | 채널톡: 지식 · 규칙 | 20분 |
| 7 | 채널톡: 주문 태스크 4개 | 1시간 |
| 8 | 채널톡: 워크플로우 | 20분 |
| 9 | 테스트 30문항 — v1 채점 | 1시간 |
| 10 | 튜닝 — v2 채점 | 1~3시간 |
| 11 | 캡처 정리 | 30분 |
| 12 | GitHub 공개 | 10분 |

---

## 0. 준비물 확인 (5분)

- [ ] Mac + Node 24 이상: `node -v`
- [ ] Homebrew: `brew -v`
- [ ] 채널톡 계정과 채널: 요금제(또는 체험)에서 **ALF, 태스크, 웹훅**을 쓸 수 있는지 채널톡 설정 화면에서 확인한다.

## 1. 프로젝트 준비 (5분, 처음 한 번)

```bash
cd ~/ssokgolla-cs-hub
npm install
npm run setup          # .dev.vars에 무작위 시크릿 3개 생성(이미 있으면 그대로 둠)
npm run db:migrate     # 내 PC 안의 D1에 테이블 생성
npm run seed           # 데모 상점 주문 20건 + 주문번호·뒤4자리 목록 출력
npm test               # 178개 통과 확인
brew install cloudflared
```

**확인**: `npm test`가 모두 통과한다.

## 2. 지식 만들기 (2분, 처음 한 번)

1. `docs/knowledge-source/values.json`에는 **데모 상점용 값이 이미 들어 있다**(배송비 3,000원, 30,000원 이상 무료, 출고 1~3영업일 등). 실제 운영 값이 아니라 시연용이다. 바꾸고 싶을 때만 고친다.
2. 정책 원문(`docs/knowledge-source/*/*.md`)을 읽고 어색한 문장을 고친다(선택).
3. `npm run build-knowledge`

**확인**: 모든 줄이 `✓`이고 `dist/knowledge/`에 파일 5개가 생긴다.

## 3. 허브 켜기 + 임시 주소 받기 (3분, 테스트할 때마다)

터미널 창 3개를 쓴다.

| 창 | 명령 | 하는 일 |
|---|---|---|
| ① | `npm run dev` | 허브 실행(http://localhost:8787). 로그가 이 창에 나온다 |
| ② | `npm run tunnel` | 인터넷 주소 발급. 출력 중 `https://○○○○.trycloudflare.com`을 복사 |
| ③ | `npm run task-code -- --url https://○○○○.trycloudflare.com` | 웹훅 URL과 태스크 코드 5개를 `dist/channeltalk/`에 생성 |

**확인**: 브라우저에서 `https://○○○○.trycloudflare.com/health` → `{"ok":true,"dataSource":"mock"}`

알아둘 것
- **터널 주소는 `npm run tunnel`을 켤 때마다 바뀐다.** 바뀌면 ③을 다시 실행하고, 채널톡의 **웹훅 URL 1곳 + 태스크 Code 스텝 5곳**을 새 코드로 바꿔 붙여넣는다. 그래서 테스트하는 동안에는 ①②를 끄지 않는다.
- Mac이 잠자기에 들어가면 터널이 끊긴다. 테스트 중에는 창 하나에서 `caffeinate -d`를 켜 둔다.
- `dist/channeltalk/`의 파일과 웹훅 URL에는 시크릿이 들어 있다. 캡처·채팅에 그대로 올리지 않는다.

## 4. 채널톡: 웹훅 연결 (10분)

1. 채널톡 설정 > 웹훅 > 새 웹훅 만들기
   - URL: `dist/channeltalk/webhook-url.txt`의 내용
   - 유저챗(상담) 관련 알림을 켠다.
2. 내 채널의 고객 채팅(테스트용 브라우저/시크릿 창)에서 상담을 열고 "안녕하세요"를 보낸다.
3. 창 ①(허브 로그)에서 `channeltalk_webhook_shape` 줄을 찾는다. 웹훅 본문의 **키 구조만**(값 없이) 찍힌다.

**확인**
- 로그의 shape에 `"entity":{"chatId":…,"personType":…,"plainText":…}`가 보이고, `npm run report`의 전체 상담이 1 이상이면 성공.
- `channeltalk_webhook_unparsed` 경고가 나오면 필드 이름이 문서에서 추측한 것과 다른 것이다. **그 줄(shape)을 그대로 알려주면** 파서를 맞춰 고친다. 값이 없으므로 개인정보가 없다.
- 확인이 끝나면 `.dev.vars`의 `WEBHOOK_DEBUG=false`로 바꾸고 ①을 재시작한다(선택).

## 5. 채널톡: 연결 확인 태스크 (15분)

주문 태스크를 만들기 전에, Code 스텝에서 허브 호출이 되는지부터 확인한다.

1. ALF > 태스크 > 새 태스크 "허브 연결 확인"
   - 트리거 예시: "연결 테스트"라고 말하면 실행
   - 스텝 ① **Code**: `dist/channeltalk/00-ping.js` 내용을 붙여넣는다. "요청 실패 시" 분기를 켜고 ③으로 연결
   - 스텝 ② **Send Message**: `hubMessage` 메모리 값을 보낸다
   - 스텝 ③ **Send Message**(실패 시): "허브 연결 실패"
2. **실제 상담 창**에서 "연결 테스트"를 보낸다(태스크 미리보기에서는 외부 호출이 막혀 `(미리보기)` 메시지만 나온다).

**확인**: `허브 연결 정상 (chatId: 숫자 또는 문자열)`이 오면 성공.

| 결과 | 의미 | 할 일 |
|---|---|---|
| `chatId: 없음` | 상담 ID 경로가 `context.userChat.id`가 아님 | 채널톡 Code 스텝 문서의 context 구조를 확인해 알려주면 코드 틀을 고친다(태스크는 동작하지만 리포트 연결이 빠짐) |
| "허브 연결 실패" | 401(시크릿) 또는 터널 끊김 | ③ 다시 실행 → 코드 다시 붙여넣기, ② 창 확인 |
| `axios is not defined` 류 오류 | axios를 전역으로 못 씀 | 오류 문구를 알려주면 코드 틀을 고친다 |

## 6. 채널톡: 지식 · 규칙 (20분)

1. **지식**: `dist/knowledge/` 5개 파일을 [01-knowledge](channeltalk/01-knowledge.md)의 폴더 구조(공통 / 네이버 스마트스토어 / 쿠팡)대로 등록한다.
2. **규칙**: [02-rules](channeltalk/02-rules.md)의 "규칙 원문" 블록을 그대로 붙여넣는다.

**확인**: 상담 창에서 "배송비 얼마예요?" → 지식의 금액으로 답한다.

## 7. 채널톡: 주문 태스크 4개 (1시간)

[03-tasks](channeltalk/03-tasks.md)의 "태스크별 설정"과 공통 구조 그림대로 만든다. 태스크마다:

1. **AI Agent** 스텝: 주문번호 → memory `orderNo`, 휴대폰 뒤 4자리 → memory `phoneLast4` (반품은 사유 분류 → `returnReason`)
2. **Code** 스텝: `dist/channeltalk/0N-….js`를 붙여넣는다. **"요청 실패 시" 분기를 반드시 켠다.**
3. **분기**: `hubReasonCode = ORDER_NOT_FOUND` → 다시 묻기(1회) / `hubDecision = ESCALATE` → Send Message(`hubMessage`) + Chat Action(태그 `alf-이관:<hubReasonCode>`, 상담원 배정) / 그 외 → Send Message(`hubMessage`)
4. 실패 분기 → "확인 중 문제가 생겼어요" 메시지 + 태그 `alf-이관:연동오류` + 상담원 배정

| 파일 | 태스크 | 트리거 예시 |
|---|---|---|
| `01-order-lookup.js` | 주문 조회 | 언제 와요, 배송 조회, 송장번호 |
| `02-order-cancel.js` | 주문 취소 | 취소해 주세요 |
| `03-address-change.js` | 배송지 변경 | 주소 바꿀래요 |
| `04-return-request.js` | 반품 접수 | 반품, 불량이에요, 다른 상품이 왔어요 |

**확인**: 상담 창에서 "2026110800000103 / 1203 취소해 주세요" → "담당자가 확인 후 안내드리겠습니다" + `alf-이관:SUPPLIER_ALREADY_ORDERED` 태그.
03-tasks의 "검증 체크리스트 — 태스크"를 하나씩 체크한다.

## 8. 채널톡: 워크플로우 (20분)

[04-workflows](channeltalk/04-workflows.md)의 W1(운영 시간 안내), W2(`alf-이관:*` 태그 → 상담원 배정), W3(종료 후 만족도)을 만들고 "설정 값" 칸을 채운다.

## 9. 테스트 30문항 — v1 채점 (1시간)

1. `npm run seed` — 데모 주문 20건을 처음 상태로 되돌린다(취소 요청 표시 등 초기화). 상담·태스크 기록은 지워지지 않는다.
2. [test-scenarios](test-scenarios.md)의 30문항을 상담 창에 하나씩 입력하고 v1 칸에 ○/×를 적는다. 문항마다 새 상담을 여는 게 좋다.
3. ×인 문항은 [05-tuning-log](channeltalk/05-tuning-log.md)에 실패 사례(F-001…)로 적는다.
4. `npm run report`를 실행해 출력 표를 05-tuning-log에 붙여넣는다.

## 10. 튜닝 — v2 채점 (1~3시간)

1. 실패 사례의 원인(지식 누락 / 규칙 모호 / 트리거 누락 / 분기 오류)을 분류하고 지식·규칙·태스크를 고친다. 고친 이유는 05-tuning-log와 각 문서의 변경 이력에 적는다.
2. `npm run seed` 후 30문항을 다시 채점(v2 칸).
3. README §5 표에 v1·v2 결과를 채운다.

## 11. 캡처 정리 (30분)

README의 `<!-- screenshot: … -->` 자리에 넣을 화면:
지식 폴더 구조 · 규칙 설정 · 취소 태스크 편집 화면 · 이관 워크플로우 · 실제 상담에서 이관되는 대화 · `npm run report` 출력

- 캡처는 `docs/images/`에 저장하고 README의 주석을 `![설명](docs/images/파일.png)`로 바꾼다.
- **가릴 것**: 상담원 실명·이메일, 채널 ID, 태스크 Code 스텝 안의 `X-ALF-Secret` 값과 터널 주소, 웹훅 URL의 `token=` 값.

## 12. GitHub 공개 (10분)

```bash
npm run check:public     # 민감정보 검사 — ✓가 나와야 한다
gitleaks git -v .        # 전체 이력 시크릿 검사(설치되어 있음) — "no leaks found"
gh repo create ssokgolla-cs-hub --public --source . --push
```

push 후 GitHub의 Actions 탭에서 CI(lint·타입·테스트·민감정보 검사)가 초록색인지 확인한다.

---

### 선택: 고정 주소가 필요할 때

면접 시연 등으로 PC를 켜 두지 않고 주소를 고정하고 싶으면 무료 Cloudflare Workers에 올릴 수 있다(약 10분).
`npx wrangler login` → `npx wrangler d1 create cs-hub`(출력된 `database_id`를 `wrangler.jsonc`에 입력) → `npm run db:migrate:remote` → `npm run seed:remote` → `npx wrangler secret put ALF_SECRET`(·`ADMIN_SECRET`·`CHANNELTALK_WEBHOOK_TOKEN`, `.dev.vars`와 같은 값) → `npm run deploy` → 출력된 `https://ssokgolla-cs-hub.<계정>.workers.dev`로 `npm run task-code -- --url …` 다시 실행.
