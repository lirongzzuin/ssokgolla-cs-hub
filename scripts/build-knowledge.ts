/**
 * docs/knowledge-source → dist/knowledge (채널톡 ALF 지식 업로드용)
 *
 *   npm run build-knowledge            # values.json이 모두 채워져야 성공
 *   npm run build-knowledge -- --draft # 빈 값은 [미정: 키]로 채워 미리보기
 *
 * 하는 일: 운영자 메모(<!-- 내부 -->) 제거, {{값}} 치환, 금지어(위탁 내부 정보) 검사.
 * 결과 파일 이름은 <채널>__<원문 이름>.md 이다. 채널톡 지식 폴더 구조는 docs/channeltalk/01-knowledge.md.
 */
import { mkdirSync, readdirSync, readFileSync, rmSync, writeFileSync } from 'node:fs';
import { join } from 'node:path';
import { parseArgs } from 'node:util';
import { buildKnowledge } from './lib/knowledge.ts';

const SRC = 'docs/knowledge-source';
const OUT = 'dist/knowledge';
const { values: args } = parseArgs({ options: { draft: { type: 'boolean', default: false } } });

const values = JSON.parse(readFileSync(join(SRC, 'values.json'), 'utf8')) as Record<string, string>;
rmSync(OUT, { recursive: true, force: true });
mkdirSync(OUT, { recursive: true });

let failed = false;
const missingAll = new Set<string>();

for (const dir of ['common', 'smartstore', 'coupang']) {
  for (const file of readdirSync(join(SRC, dir)).filter((f) => f.endsWith('.md'))) {
    const src = readFileSync(join(SRC, dir, file), 'utf8');
    const r = buildKnowledge(src, values, { draft: args.draft });
    const outName = `${r.meta.channel}__${file}`;
    writeFileSync(join(OUT, outName), r.output);

    const flags = [
      r.missing.length ? `빈 값 ${r.missing.join(', ')}` : '',
      r.forbidden.length ? `금지어 ${r.forbidden.join(', ')}` : '',
    ].filter(Boolean);
    console.log(
      `${flags.length ? '✗' : '✓'} ${outName}  (${r.meta.title})${flags.length ? `  — ${flags.join(' / ')}` : ''}`,
    );

    for (const k of r.missing) missingAll.add(k);
    if (r.forbidden.length) failed = true;
  }
}

if (missingAll.size && !args.draft) {
  console.error(`\n${join(SRC, 'values.json')}에 값을 채워 주세요: ${[...missingAll].join(', ')}`);
  failed = true;
}
if (failed) process.exit(1);
console.log(`\n→ ${OUT}/ 의 파일을 채널톡 ALF 지식에 업로드하세요(docs/channeltalk/01-knowledge.md).`);
