import { env } from 'cloudflare:test';
import { beforeAll, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { type SummaryReport, toUtcRange } from '../../src/modules/reports';
import { resetAndSeed } from '../helpers';

const kstToday = new Date(Date.now() + 9 * 60 * 60 * 1000).toISOString().slice(0, 10);

const alf = (path: string, body: unknown) =>
  app.request(
    `/alf/orders/${path}`,
    {
      method: 'POST',
      headers: { 'Content-Type': 'application/json', 'X-ALF-Secret': env.ALF_SECRET ?? '' },
      body: JSON.stringify(body),
    },
    env,
  );

const webhook = (chatId: string, personType: string) =>
  app.request(
    `/webhooks/channeltalk?token=${env.CHANNELTALK_WEBHOOK_TOKEN}`,
    {
      method: 'POST',
      body: JSON.stringify({ type: 'Message', entity: { chatId, chatType: 'userChat', personType, plainText: 'x' } }),
    },
    env,
  );

const report = (query = '', secret: string | null = env.ADMIN_SECRET ?? '') =>
  app.request(`/reports/summary${query}`, { headers: secret === null ? {} : { 'X-Admin-Secret': secret } }, env);

beforeAll(async () => {
  await resetAndSeed();
  // 상담 4건: ALF 단독 2, 태스크 이관 1, 상담원 참여 1
  await webhook('r1', 'user');
  await alf('lookup', { orderNo: '2026110600000106', phoneLast4: '1206', chatId: 'r1' });
  await webhook('r2', 'user');
  await alf('return-request', {
    orderNo: '2026110300000107',
    phoneLast4: '1207',
    reason: 'CHANGE_OF_MIND',
    chatId: 'r2',
  });
  await webhook('r3', 'user');
  await alf('cancel', { orderNo: '2026110800000103', phoneLast4: '1203', chatId: 'r3' });
  await webhook('r4', 'user');
  await webhook('r4', 'manager');
});

describe('toUtcRange', () => {
  it('KST 날짜를 그날 0시~다음 날 0시(UTC)로', () => {
    expect(toUtcRange({ from: '2026-11-01', to: '2026-11-01' })).toEqual([
      '2026-10-31T15:00:00.000Z',
      '2026-11-01T15:00:00.000Z',
    ]);
  });
});

describe('GET /reports/summary', () => {
  it('관리자 시크릿이 없으면 401, ALF 시크릿으로도 열리지 않는다', async () => {
    expect((await report('', null)).status).toBe(401);
    expect((await report('', env.ALF_SECRET ?? '')).status).toBe(401);
  });

  it('기간이 거꾸로면 400', async () => {
    expect((await report('?from=2026-11-09&to=2026-11-01')).status).toBe(400);
  });

  it('ALF 해결률·이관 사유·태스크 분포·상품별 집계', async () => {
    const res = await report(`?from=${kstToday}&to=${kstToday}`);
    expect(res.status).toBe(200);
    const { report: r } = (await res.json()) as { report: SummaryReport };

    expect(r.inquiries).toMatchObject({
      total: 4,
      resolvedByAlf: 2,
      escalated: 2,
      handledByAgent: 1,
      alfResolutionRate: 50,
      escalationRate: 50,
    });
    expect(r.inquiries.escalationReasons).toEqual(
      expect.arrayContaining([
        { reason: 'SUPPLIER_ALREADY_ORDERED', count: 1 },
        { reason: 'AGENT_JOINED', count: 1 },
      ]),
    );
    const cancel = r.tasks.find((t) => t.task === 'order_cancel');
    expect(cancel).toMatchObject({ total: 1, decisions: { ESCALATE: 1 } });

    const mat = r.products.find((p) => p.productName === '논슬립 옷걸이 30개');
    expect(mat).toMatchObject({ inquiries: 1, taskCalls: 1, returnRequests: 1 });
  });

  it('format=md 는 README에 붙일 마크다운 표', async () => {
    const res = await report(`?from=${kstToday}&to=${kstToday}&format=md`);
    expect(res.headers.get('Content-Type')).toContain('text/markdown');
    const md = await res.text();
    expect(md).toContain('| 전체 상담 | ALF 단독 해결 | ALF 해결률 | 상담원 이관 | 이관율 |');
    expect(md).toContain('| 4 | 2 | 50% | 2 | 50% |');
    expect(md).toContain('발주 후 취소·변경');
  });

  it('기간 밖이면 0건', async () => {
    const { report: r } = (await (await report('?from=2020-01-01&to=2020-01-02')).json()) as {
      report: { inquiries: { total: number; alfResolutionRate: number | null } };
    };
    expect(r.inquiries).toMatchObject({ total: 0, alfResolutionRate: null });
  });
});
