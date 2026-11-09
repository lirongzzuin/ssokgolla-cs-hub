/**
 * 채널톡 태스크 Code 스텝 코드 5개 + 웹훅 URL을 만든다.
 *
 *   npm run task-code -- --url https://<터널 주소>.trycloudflare.com
 *
 * 시크릿은 .dev.vars에서 읽는다(먼저 npm run setup). 결과는 dist/channeltalk/ 에 쓰고,
 * 시크릿이 들어 있으므로 dist/는 커밋하지 않는다(.gitignore).
 */
import { existsSync, mkdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { normalizeBaseUrl, renderTaskCode, TASKS, webhookUrl } from './lib/task-code.ts';

const OUT = 'dist/channeltalk';

const { values } = parseArgs({ options: { url: { type: 'string' } } });
if (!values.url) {
  console.error('사용법: npm run task-code -- --url https://<허브 주소>');
  console.error('허브 주소는 npm run tunnel 출력의 https://….trycloudflare.com 입니다.');
  process.exit(1);
}

function readDevVars(): Record<string, string> {
  if (!existsSync('.dev.vars')) {
    console.error('.dev.vars가 없습니다. 먼저 npm run setup 을 실행하세요.');
    process.exit(1);
  }
  return Object.fromEntries(
    readFileSync('.dev.vars', 'utf8')
      .split('\n')
      .filter((l) => /^[A-Z_]+=/.test(l))
      .map((l) => [l.slice(0, l.indexOf('=')), l.slice(l.indexOf('=') + 1).trim()]),
  );
}

const vars = readDevVars();
const alfSecret = vars.ALF_SECRET;
const webhookToken = vars.CHANNELTALK_WEBHOOK_TOKEN;
if (!alfSecret || !webhookToken) {
  console.error('.dev.vars에 ALF_SECRET, CHANNELTALK_WEBHOOK_TOKEN이 필요합니다(npm run setup).');
  process.exit(1);
}

let base: string;
try {
  base = normalizeBaseUrl(values.url);
} catch (e) {
  console.error((e as Error).message);
  process.exit(1);
}

rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });
for (const task of TASKS) writeFileSync(join(OUT, task.file), renderTaskCode(task, base, alfSecret));
writeFileSync(join(OUT, 'webhook-url.txt'), `${webhookUrl(base, webhookToken)}\n`);

console.log(`허브 주소: ${base}\n`);
console.log('채널톡 웹훅 URL (설정 > 웹훅):');
console.log(`  ${webhookUrl(base, webhookToken)}\n`);
console.log(`태스크 Code 스텝 코드 → ${OUT}/`);
for (const t of TASKS) console.log(`  ${t.file.padEnd(22)} ${t.title}`);
console.log('\n⚠ 이 파일들에는 시크릿이 들어 있습니다. 채팅·스크린샷에 그대로 올리지 마세요.');
