import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { MockSalesChannel } from '../../src/adapters/sales-channel/mock';
import { MockSupplier } from '../../src/adapters/supplier/mock';
import { type Adapters, createContainer } from '../../src/app/container';
import { createLogger } from '../../src/app/logger';
import { MockChannelTalkClient } from '../../src/modules/channeltalk';

const silent = createLogger({}, () => {});
const now = () => new Date();

function setup(enabled: boolean) {
  const sales = new MockSalesChannel(now);
  const channelTalk = new MockChannelTalkClient();
  const adapters: Adapters = { sales, supplier: new MockSupplier(now), coupangInquiries: sales, channelTalk };
  const c = createContainer(
    { ...env, ENABLE_COUPANG_BRIDGE: enabled ? 'true' : 'false' },
    { logger: silent, adapters },
  );
  return { c, sales, channelTalk };
}

const reply = (chatId: string, personType: 'bot' | 'manager', text: string) => ({
  kind: 'message' as const,
  chatId,
  sender: personType,
  text,
  at: new Date(),
});

beforeEach(async () => {
  await env.DB.exec('DELETE FROM coupang_bridge_links; DELETE FROM inquiries; DELETE FROM sync_state;');
});

describe('쿠팡 문의 브릿지', () => {
  it('플래그가 꺼져 있으면 아무것도 하지 않는다(기본값)', async () => {
    const { c, channelTalk } = setup(false);
    expect(await c.coupangBridge.run()).toEqual({ fetched: 0, bridged: 0, escalatedToAgent: 0, skipped: 0 });
    expect(channelTalk.created).toHaveLength(0);
  });

  it('상품문의는 채널톡 상담으로, 고객센터 이관 문의는 상담원 이관으로만 기록', async () => {
    const { c, channelTalk } = setup(true);
    expect(await c.coupangBridge.run()).toEqual({ fetched: 3, bridged: 2, escalatedToAgent: 1, skipped: 0 });
    expect(channelTalk.created.map((x) => x.externalId)).toEqual(['MOCK-Q-1', 'MOCK-Q-2']);

    const callcenter = await env.DB.prepare("SELECT * FROM inquiries WHERE external_id = 'MOCK-Q-3'").first();
    expect(callcenter).toMatchObject({
      source: 'coupang',
      handled_by: 'agent',
      escalation_reason: 'COUPANG_CALLCENTER',
    });

    // 브릿지한 문의는 채널톡 상담 1행으로만 센다(쿠팡 행을 따로 만들지 않음)
    const { results } = await env.DB.prepare('SELECT source, external_id, category FROM inquiries ORDER BY id').all();
    expect(results).toEqual([
      { source: 'channeltalk', external_id: 'mock-chat-coupang-MOCK-Q-1', category: 'COUPANG_QNA' },
      { source: 'channeltalk', external_id: 'mock-chat-coupang-MOCK-Q-2', category: 'COUPANG_QNA' },
      { source: 'coupang', external_id: 'MOCK-Q-3', category: 'COUPANG_CALLCENTER' },
    ]);
  });

  it('같은 문의를 두 번 브릿지하지 않는다', async () => {
    const { c } = setup(true);
    await c.coupangBridge.run();
    await env.DB.exec('DELETE FROM sync_state'); // 커서를 지워 같은 문의를 다시 받게 함
    const again = await c.coupangBridge.run();
    expect(again).toMatchObject({ bridged: 0, escalatedToAgent: 0, skipped: 3 });
  });

  it('브릿지 상담에 올라온 첫 답변을 쿠팡에 한 번만 등록한다', async () => {
    const { c, sales } = setup(true);
    await c.coupangBridge.run();
    const chatId = 'mock-chat-coupang-MOCK-Q-1';

    await c.inquiries.handleChatEvent(reply(chatId, 'bot', '물통 용량은 상품 상세페이지 기준 300ml예요.'));
    await c.inquiries.handleChatEvent(reply(chatId, 'bot', '더 궁금한 점 있으신가요?'));

    expect(sales.answered).toEqual([{ inquiryId: 'MOCK-Q-1', text: '물통 용량은 상품 상세페이지 기준 300ml예요.' }]);
  });

  it('고객 메시지나 브릿지와 무관한 상담은 쿠팡에 올리지 않는다', async () => {
    const { c, sales } = setup(true);
    await c.coupangBridge.run();
    await c.inquiries.handleChatEvent({ ...reply('mock-chat-coupang-MOCK-Q-1', 'bot', 'x'), sender: 'user' });
    await c.inquiries.handleChatEvent(reply('other-chat', 'manager', '안녕하세요'));
    expect(sales.answered).toHaveLength(0);
  });

  it('쿠팡 답변 등록이 실패하면 다음 답변 때 다시 시도한다', async () => {
    const { c, sales } = setup(true);
    await c.coupangBridge.run();
    const chatId = 'mock-chat-coupang-MOCK-Q-2';
    const original = sales.answerInquiry.bind(sales);
    sales.answerInquiry = async () => {
      throw new Error('coupang 500');
    };
    await expect(c.inquiries.handleChatEvent(reply(chatId, 'bot', '첫 답변'))).rejects.toThrow('coupang 500');

    sales.answerInquiry = original;
    await c.inquiries.handleChatEvent(reply(chatId, 'manager', '상담원 답변'));
    expect(sales.answered).toEqual([{ inquiryId: 'MOCK-Q-2', text: '상담원 답변' }]);
  });
});
