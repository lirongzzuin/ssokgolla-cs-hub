/**
 * 운영 리포트를 마크다운 표로 출력한다. README 성과 표·튜닝 기록에 붙여넣는 용도.
 *
 *   npm run report                                   # 로컬(wrangler dev) 최근 7일
 *   npm run report -- --from 2026-11-20 --to 2026-12-03
 *   REPORT_BASE_URL=https://<배포 주소> ADMIN_SECRET=... npm run report
 *
 * 집계는 서버의 GET /reports/summary?format=md 한 곳에서만 한다(스크립트에 같은 로직을 두지 않기 위해).
 * ADMIN_SECRET이 환경변수에 없으면 로컬 .dev.vars에서 읽는다.
 */
import { existsSync, readFileSync } from 'node:fs';
import { parseArgs } from 'node:util';

const { values } = parseArgs({
  options: { from: { type: 'string' }, to: { type: 'string' } },
});

function readDevVar(name: string): string | undefined {
  if (!existsSync('.dev.vars')) return undefined;
  const line = readFileSync('.dev.vars', 'utf8')
    .split('\n')
    .find((l) => l.startsWith(`${name}=`));
  return line?.slice(name.length + 1).trim() || undefined;
}

const base = process.env.REPORT_BASE_URL ?? 'http://localhost:8787';
const secret = process.env.ADMIN_SECRET ?? readDevVar('ADMIN_SECRET');
if (!secret) {
  console.error('ADMIN_SECRET이 없습니다. 환경변수로 주거나 .dev.vars에 넣어 주세요.');
  process.exit(1);
}

const qs = new URLSearchParams({ format: 'md' });
if (values.from) qs.set('from', values.from);
if (values.to) qs.set('to', values.to);

const res = await fetch(`${base}/reports/summary?${qs}`, { headers: { 'X-Admin-Secret': secret } }).catch(() => null);
if (!res) {
  console.error(`${base}에 연결할 수 없습니다. 로컬이면 먼저 npm run dev를 실행하세요.`);
  process.exit(1);
}
if (!res.ok) {
  console.error(`리포트 요청 실패: HTTP ${res.status} ${await res.text()}`);
  process.exit(1);
}
process.stdout.write(await res.text());
