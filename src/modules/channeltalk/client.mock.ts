import type { ChannelTalkClient } from './client';

/**
 * mock 채널톡 클라이언트. 상담을 만들지 않고 결정적인 chatId만 돌려준다.
 * chatId를 문의 번호에서 만들어, 같은 문의를 다시 브릿지해도 같은 상담으로 이어지게 한다.
 */
export class MockChannelTalkClient implements ChannelTalkClient {
  readonly created: Array<{ externalId: string; content: string }> = [];

  async createChatForExternalInquiry(input: { externalId: string; content: string }): Promise<{ chatId: string }> {
    this.created.push({ externalId: input.externalId, content: input.content });
    return { chatId: `mock-chat-coupang-${input.externalId}` };
  }
}
