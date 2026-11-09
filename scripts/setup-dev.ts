/**
 * 로컬 .dev.vars를 무작위 시크릿으로 만든다.
 *
 *   npm run setup            # .dev.vars가 없을 때만 만든다
 *   npm run setup -- --force # 새 시크릿으로 다시 만든다(채널톡 태스크 코드·웹훅 URL도 다시 넣어야 함)
 *
 * 왜: 로컬 허브를 터널로 인터넷에 열면 .dev.vars.example의 예시 값(change-me)은 누구나 알 수 있다.
 */
import { randomBytes } from 'node:crypto';
import { existsSync, writeFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({ options: { force: { type: 'boolean', default: false } } });

if (existsSync('.dev.vars') && !values.force) {
  console.log('.dev.vars가 이미 있습니다. 새로 만들려면: npm run setup -- --force');
  process.exit(0);
}

const secret = () => randomBytes(24).toString('hex');

writeFileSync(
  '.dev.vars',
  `# npm run setup 으로 생성(${new Date().toISOString().slice(0, 10)}). 커밋 금지(.gitignore).
ALF_SECRET=${secret()}
ADMIN_SECRET=${secret()}
CHANNELTALK_WEBHOOK_TOKEN=${secret()}

# 채널톡 웹훅 본문의 키 구조(값 제외)를 로그로 남김 — 실제 필드 이름 확인이 끝나면 false
WEBHOOK_DEBUG=true

# DATA_SOURCE=live(확장용, 운영하지 않음)일 때만 필요
ENGINE_TOKEN=
`,
);
console.log('.dev.vars 생성 완료(무작위 시크릿 3개). 값은 npm run task-code 가 채널톡 코드에 자동으로 넣습니다.');
