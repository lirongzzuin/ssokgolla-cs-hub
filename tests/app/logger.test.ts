import { describe, expect, it } from 'vitest';
import { createLogger, maskAddress, maskName, maskPhone } from '../../src/app/logger';

describe('마스킹', () => {
  it.each([
    ['010-0000-5678', '010-****-5678'],
    ['01000005678', '010-****-5678'],
    ['010 0000 5678', '010-****-5678'],
    ['+82-10-0000-5678', '010-****-5678'],
    ['연락처는 010-0000-4321 입니다', '연락처는 010-****-4321 입니다'],
  ])('전화번호 %s → %s', (raw, masked) => {
    expect(maskPhone(raw)).toBe(masked);
  });

  it('주문번호처럼 긴 숫자는 건드리지 않는다', () => {
    expect(maskPhone('2026110900000101')).toBe('2026110900000101');
  });

  it.each([
    ['홍길동', '홍*동'],
    ['남궁민수', '남**수'],
    ['김수', '김*'],
    ['김', '*'],
  ])('이름 %s → %s', (raw, masked) => {
    expect(maskName(raw)).toBe(masked);
  });

  it('주소는 시·구까지만', () => {
    expect(maskAddress('서울특별시 강남구 테헤란로 1 101호')).toBe('서울특별시 강남구 ***');
  });
});

describe('logger', () => {
  it('필드 이름과 문자열 안의 개인정보를 모두 마스킹한다', () => {
    const lines: string[] = [];
    const log = createLogger({ service: 'test' }, (line) => lines.push(line));
    log.info('고객 010-0000-5678 문의', {
      name: '홍길동',
      address: '서울특별시 강남구 테헤란로 1',
      nested: { phone: '01000005678', note: '다른 번호 010-0000-3333' },
    });
    const entry = JSON.parse(lines[0] ?? '{}');
    expect(entry.msg).toBe('고객 010-****-5678 문의');
    expect(entry.name).toBe('홍*동');
    expect(entry.address).toBe('서울특별시 강남구 ***');
    expect(entry.nested.phone).toBe('010-****-5678');
    expect(entry.nested.note).toBe('다른 번호 010-****-3333');
    expect(lines[0]).not.toMatch(/0000-5678|길동|테헤란로/);
  });
});
