/**
 * 공개 저장소에 올리기 전 민감정보 검사. CI에서도 돈다.
 *
 *   npm run check:public
 *
 * 검사 대상: git이 추적하는 파일 전부 + 커밋 작성자 이메일.
 *  - .dev.vars 등 시크릿 파일이 추적되고 있지 않은가
 *  - 실제처럼 보이는 휴대폰 번호(테스트 데이터는 가운데 자리를 0000으로 쓴다)
 *  - 이메일 주소(허용: GitHub noreply, Anthropic 공동 작성자, example.com)
 *  - 시크릿 형태(긴 16진수·키 접두어·개인키)
 *  - 로컬 경로(/Users/…) 같은 개인 환경 정보
 */
import { execFileSync } from 'node:child_process';
import { readFileSync } from 'node:fs';

interface Rule {
  name: string;
  pattern: RegExp;
  allow?: (match: string) => boolean;
}

const RULES: Rule[] = [
  {
    name: '휴대폰 번호',
    pattern: /(?<!\d)01[016789][-\s]?(\d{3,4})[-\s]?\d{4}(?!\d)/g,
    // 테스트·문서용 가짜 번호는 가운데 자리를 0000으로 쓴다
    allow: (m) => /^01[016789][-\s]?0000[-\s]?\d{4}$/.test(m),
  },
  {
    name: '이메일',
    pattern: /[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}/g,
    allow: (m) => /@users\.noreply\.github\.com$|^noreply@anthropic\.com$|@example\.(com|org)$/.test(m),
  },
  { name: '긴 16진수(시크릿 의심)', pattern: /\b[a-f0-9]{40,}\b/g },
  {
    name: '키 접두어',
    pattern: /\b(sk-[A-Za-z0-9]{20,}|AKIA[A-Z0-9]{16}|ghp_[A-Za-z0-9]{30,}|xox[bp]-[A-Za-z0-9-]{20,})/g,
  },
  { name: '개인키', pattern: /-----BEGIN [A-Z ]*PRIVATE KEY-----/g },
  { name: '로컬 경로', pattern: /\/Users\/[A-Za-z0-9._-]+|C:\\Users\\/g },
];

const FORBIDDEN_FILES = [/(^|\/)\.dev\.vars$/, /(^|\/)\.env(\..+)?$/, /\.pem$/, /(^|\/)dist\//, /(^|\/)\.wrangler\//];
// 규칙 자체를 담은 이 파일, 패키지 잠금 파일, wrangler가 생성한 타입(Cloudflare 문서 예시 해시 포함)은 뺀다
const SKIP = new Set(['scripts/check-public.ts', 'package-lock.json', 'worker-configuration.d.ts']);

const git = (...args: string[]) => execFileSync('git', args, { encoding: 'utf8' });
const files = git('ls-files').split('\n').filter(Boolean);
const problems: string[] = [];

for (const f of files) {
  if (f.endsWith('.example')) continue;
  if (FORBIDDEN_FILES.some((re) => re.test(f))) problems.push(`${f}: 커밋하면 안 되는 파일`);
}

for (const f of files) {
  if (SKIP.has(f)) continue;
  let text: string;
  try {
    text = readFileSync(f, 'utf8');
  } catch {
    continue;
  }
  text.split('\n').forEach((line, i) => {
    for (const rule of RULES) {
      for (const m of line.matchAll(rule.pattern)) {
        if (rule.allow?.(m[0])) continue;
        problems.push(`${f}:${i + 1}: ${rule.name} → ${m[0].slice(0, 12)}…`);
      }
    }
  });
}

const authors = new Set(git('log', '--format=%ae%n%ce').split('\n').filter(Boolean));
for (const email of authors) {
  if (!RULES[1]?.allow?.(email)) problems.push(`커밋 작성자 이메일: ${email} (GitHub noreply로 바꿔야 함)`);
}

if (problems.length) {
  console.error(`민감정보 의심 ${problems.length}건:\n${problems.map((p) => `  ✗ ${p}`).join('\n')}`);
  process.exit(1);
}
console.log(`✓ 추적 파일 ${files.length}개와 커밋 작성자 ${authors.size}명에서 민감정보 의심 항목 없음`);
