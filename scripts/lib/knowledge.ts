/**
 * 지식 원문 → ALF 업로드용 정제. 파일 입출력 없는 순수 함수만 둔다(테스트: tests/scripts/knowledge.test.ts).
 * 규칙: docs/knowledge-source/README.md
 */

export const FORBIDDEN_WORDS = ['공급처', '도매', '매입', '원가', '위탁', '발주'] as const;

export interface KnowledgeMeta {
  title: string;
  channel: 'common' | 'smartstore' | 'coupang';
}

export interface BuildResult {
  meta: KnowledgeMeta;
  output: string;
  missing: string[];
  forbidden: string[];
}

const INTERNAL_BLOCK = /<!--\s*내부\s*-->[\s\S]*?<!--\s*\/내부\s*-->/g;
const PLACEHOLDER = /\{\{\s*([a-z0-9_]+)\s*\}\}/g;

export function parseFrontmatter(src: string): { meta: KnowledgeMeta; body: string } {
  const m = /^---\n([\s\S]*?)\n---\n?/.exec(src);
  if (!m) throw new Error('frontmatter(title, channel)가 필요합니다');
  const fields = Object.fromEntries(
    (m[1] ?? '')
      .split('\n')
      .map((line) => line.split(':'))
      .filter((kv) => kv.length >= 2)
      .map(([k, ...v]) => [k?.trim(), v.join(':').trim()]),
  );
  const channel = fields.channel;
  if (!fields.title || !['common', 'smartstore', 'coupang'].includes(channel)) {
    throw new Error('frontmatter의 title, channel(common|smartstore|coupang)을 확인하세요');
  }
  return { meta: { title: fields.title, channel }, body: src.slice(m[0].length) };
}

/** 운영자 메모 블록을 지우고, 그 때문에 생긴 빈 줄 뭉치를 하나로 줄인다 */
export function stripInternal(body: string): string {
  return body
    .replace(INTERNAL_BLOCK, '')
    .replace(/\n{3,}/g, '\n\n')
    .trim();
}

export function fillValues(
  body: string,
  values: Record<string, string>,
  opts: { draft?: boolean } = {},
): { text: string; missing: string[] } {
  const missing = new Set<string>();
  const text = body.replace(PLACEHOLDER, (_m, key: string) => {
    const v = values[key]?.trim();
    if (v) return v;
    missing.add(key);
    return opts.draft ? `[미정: ${key}]` : `{{${key}}}`;
  });
  return { text, missing: [...missing] };
}

export function findForbidden(text: string): string[] {
  return FORBIDDEN_WORDS.filter((w) => text.includes(w));
}

export function buildKnowledge(
  src: string,
  values: Record<string, string>,
  opts: { draft?: boolean } = {},
): BuildResult {
  const { meta, body } = parseFrontmatter(src);
  const { text, missing } = fillValues(stripInternal(body), values, opts);
  return { meta, output: `${text}\n`, missing, forbidden: findForbidden(text) };
}
