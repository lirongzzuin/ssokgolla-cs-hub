import { describe, expect, it } from 'vitest';
import { buildKnowledge, fillValues, stripInternal } from '../../scripts/lib/knowledge';

const SRC = `---
title: 반품 안내
channel: smartstore
---

# 반품

단순 변심 반품 배송비는 {{fee}}입니다.

<!-- 내부 -->
공급처 반품지는 경기도. 매입가 기준 차감.
<!-- /내부 -->

교환은 담당자가 안내드립니다.
`;

describe('지식 정제', () => {
  it('운영자 메모 블록을 지운다', () => {
    expect(stripInternal('a\n\n<!-- 내부 -->\n비밀\n<!-- /내부 -->\n\nb')).toBe('a\n\nb');
  });

  it('값을 채우고, 빈 값은 목록으로 돌려준다', () => {
    expect(fillValues('{{a}} {{b}}', { a: '1', b: '' })).toEqual({ text: '1 {{b}}', missing: ['b'] });
    expect(fillValues('{{b}}', {}, { draft: true }).text).toBe('[미정: b]');
  });

  it('내부 메모 속 금지어는 결과에 남지 않는다', () => {
    const r = buildKnowledge(SRC, { fee: '3,000원' });
    expect(r.meta).toEqual({ title: '반품 안내', channel: 'smartstore' });
    expect(r.output).toContain('3,000원');
    expect(r.output).not.toContain('공급처');
    expect(r.forbidden).toEqual([]);
    expect(r.missing).toEqual([]);
  });

  it('본문에 금지어가 있으면 잡아낸다', () => {
    const r = buildKnowledge(SRC.replace('교환은', '도매 공급처 사정으로 교환은'), { fee: '1' });
    expect(r.forbidden).toEqual(['공급처', '도매']);
  });

  it('frontmatter가 없으면 실패', () => {
    expect(() => buildKnowledge('# 제목', {})).toThrow('frontmatter');
  });
});
