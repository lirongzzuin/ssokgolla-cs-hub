import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../../src/index';
import { describeShape, parseWebhook } from '../../src/modules/channeltalk';
import { resetAndSeed } from '../helpers';

const NOW = new Date('2026-11-09T03:00:00Z');

beforeEach(async () => {
  await resetAndSeed();
});

const post = (body: unknown, token: string | null = env.CHANNELTALK_WEBHOOK_TOKEN ?? '') =>
  app.request(
    `/webhooks/channeltalk${token === null ? '' : `?token=${encodeURIComponent(token)}`}`,
    { method: 'POST', headers: { 'Content-Type': 'application/json' }, body: JSON.stringify(body) },
    env,
  );

const message = (chatId: string, personType: string, extra: Record<string, unknown> = {}) => ({
  event: 'push',
  type: 'Message',
  entity: { chatId, chatType: 'userChat', personType, plainText: '안녕하세요', createdAt: NOW.getTime(), ...extra },
});

const inquiry = (chatId: string) =>
  env.DB.prepare('SELECT * FROM inquiries WHERE source = ?1 AND external_id = ?2')
    .bind('channeltalk', chatId)
    .first<Record<string, unknown>>();

describe('parseWebhook (채널톡 형식 → ChatEvent)', () => {
  it('userChat 메시지를 정규화한다', () => {
    expect(parseWebhook(message('c1', 'manager'), NOW)).toEqual({
      event: { kind: 'message', chatId: 'c1', sender: 'manager', text: '안녕하세요', at: NOW },
    });
  });

  it('UserChat 이벤트는 상담 시작', () => {
    expect(parseWebhook({ type: 'UserChat', entity: { id: 'c2' } }, NOW)).toEqual({
      event: { kind: 'chat_opened', chatId: 'c2', at: NOW },
    });
  });

  it.each([
    ['팀 채팅', message('c3', 'manager', { chatType: 'group' }), 'not_user_chat'],
    ['모르는 타입', { type: 'User', entity: {} }, 'unsupported_type:User'],
    ['필드 없음(추측한 필드명이 틀린 경우)', { type: 'Message', entity: { foo: 1 } }, 'message_fields_missing'],
    ['형식 아님', 'hello', 'invalid_envelope'],
  ])('%s → 무시', (_name, body, reason) => {
    expect(parseWebhook(body, NOW)).toEqual({ ignored: reason });
  });
});

describe('POST /webhooks/channeltalk', () => {
  it('토큰이 없거나 틀리면 401', async () => {
    expect((await post(message('c1', 'user'), null)).status).toBe(401);
    expect((await post(message('c1', 'user'), 'wrong')).status).toBe(401);
  });

  it('처리할 수 없는 이벤트도 200(연속 실패로 웹훅이 차단되지 않게)', async () => {
    const res = await post({ type: 'User', entity: {} });
    expect(res.status).toBe(200);
    expect(await res.json()).toMatchObject({ ok: true, ignored: 'unsupported_type:User' });
  });

  it('고객 메시지 → 상담 생성(ALF 처리 중)', async () => {
    await post(message('chat-a', 'user'));
    expect(await inquiry('chat-a')).toMatchObject({ handled_by: 'alf', escalated: 0, category: 'UNKNOWN' });
  });

  it('상담원 메시지 → 상담원 처리 + 이관(AGENT_JOINED)', async () => {
    await post(message('chat-b', 'user'));
    await post(message('chat-b', 'manager'));
    expect(await inquiry('chat-b')).toMatchObject({
      handled_by: 'agent',
      escalated: 1,
      escalation_reason: 'AGENT_JOINED',
    });
  });

  it('같은 이벤트가 여러 번 와도 상담은 하나', async () => {
    await post(message('chat-c', 'user'));
    await post(message('chat-c', 'user'));
    const { results } = await env.DB.prepare("SELECT id FROM inquiries WHERE external_id = 'chat-c'").all();
    expect(results).toHaveLength(1);
  });
});

describe('ALF 태스크 결과 ↔ 상담 연결', () => {
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

  it('태스크 ESCALATE 사유가 상담에 남고, 이후 상담원이 들어와도 사유를 덮지 않는다', async () => {
    await post(message('chat-d', 'user'));
    await alf('cancel', { orderNo: '2026110800000103', phoneLast4: '1203', chatId: 'chat-d' });

    const linked = await inquiry('chat-d');
    expect(linked).toMatchObject({ category: 'CANCEL', escalated: 1, escalation_reason: 'SUPPLIER_ALREADY_ORDERED' });
    expect(linked?.sales_order_id).toEqual(expect.any(Number));

    await post(message('chat-d', 'manager'));
    expect(await inquiry('chat-d')).toMatchObject({
      handled_by: 'agent',
      escalation_reason: 'SUPPLIER_ALREADY_ORDERED',
    });
  });

  it('웹훅보다 태스크가 먼저 와도 상담이 만들어진다', async () => {
    await alf('lookup', { orderNo: '2026110600000106', phoneLast4: '1206', chatId: 'chat-e' });
    expect(await inquiry('chat-e')).toMatchObject({ category: 'ORDER_STATUS', escalated: 0, handled_by: 'alf' });
  });
});

describe('웹훅 필드 확인 도우미', () => {
  it('describeShape는 값 없이 키 구조와 타입만 남긴다', () => {
    const shape = describeShape({
      type: 'Message',
      entity: {
        chatId: 'c1',
        personType: 'user',
        plainText: '010-0000-1234 홍길동',
        createdAt: 1,
        files: [{ name: 'a' }],
      },
      refers: null,
    });
    expect(shape).toEqual({
      type: 'string',
      entity: {
        chatId: 'string',
        personType: 'string',
        plainText: 'string',
        createdAt: 'number',
        files: [{ name: 'string' }],
      },
      refers: 'null',
    });
    expect(JSON.stringify(shape)).not.toMatch(/홍길동|0000-1234|Message/);
  });
});
