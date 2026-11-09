import { describe, expect, it } from 'vitest';
import { normalizeBaseUrl, renderTaskCode, TASKS, webhookUrl } from '../../scripts/lib/task-code';

const BASE = 'https://demo-abc.trycloudflare.com';

describe('채널톡 Code 스텝 코드 생성', () => {
  it('허브 주소는 https 호스트만 받고 끝의 / 는 지운다', () => {
    expect(normalizeBaseUrl(`${BASE}/`)).toBe(BASE);
    expect(() => normalizeBaseUrl('http://localhost:8787')).toThrow('https');
    expect(() => normalizeBaseUrl(`${BASE}/alf`)).toThrow();
  });

  it('5개 태스크: 연결 확인 + 주문 4종', () => {
    expect(TASKS.map((t) => t.path)).toEqual([
      'ping',
      'orders/lookup',
      'orders/cancel',
      'orders/address-change',
      'orders/return-request',
    ]);
  });

  it.each(TASKS)('$title: 채널톡 handler 형식, 주소·시크릿·memory 저장', (task) => {
    const code = renderTaskCode(task, BASE, 's3cret');
    expect(code).toContain('export const handler = async (memory, context, isSandbox) => {');
    expect(code).toContain(`axios.post('${BASE}/alf/${task.path}'`);
    expect(code).toContain("'X-ALF-Secret': 's3cret'");
    expect(code).toContain('memory.save();');
    expect(code).toContain('if (isSandbox)');
    expect(code).toContain('chatId: context.userChat?.id');
  });

  it('반품 태스크만 사유를 보낸다', () => {
    const byPath = (path: string) => {
      const task = TASKS.find((t) => t.path === path);
      if (!task) throw new Error(path);
      return renderTaskCode(task, BASE, 'x');
    };
    expect(byPath('orders/return-request')).toContain("reason: String(memory.get('returnReason')");
    expect(byPath('orders/cancel')).not.toContain('returnReason');
  });

  it('생성한 코드는 문법 오류가 없다(export만 떼고 함수로 실행 가능)', async () => {
    for (const task of TASKS) {
      const src = renderTaskCode(task, BASE, 'x').replace('export const handler =', 'return');
      const factory = new Function(src) as () => (m: unknown, c: unknown, s: boolean) => Promise<void>;
      const saved: Record<string, unknown> = {};
      const memory = {
        get: () => '1',
        put: (k: string, v: unknown) => {
          saved[k] = v;
        },
        save: () => {},
      };
      await factory()(memory, { userChat: { id: 'c1' } }, true);
      expect(saved.hubReasonCode).toBe('SANDBOX');
    }
  });

  it('웹훅 URL에 토큰을 붙인다', () => {
    expect(webhookUrl(`${BASE}/`, 'a b')).toBe(`${BASE}/webhooks/channeltalk?token=a%20b`);
  });
});
