import { buildMockCoupangInquiries, buildMockOrders } from '../mock-fixtures';
import type { InquirySource, MarketInquiry, SalesChannelAdapter, SalesOrderSnapshot } from './types';

/**
 * mock 판매채널. 키 없이 전체 흐름을 돌리기 위한 기본 어댑터(DATA_SOURCE=mock).
 * 실제 어댑터처럼 since 이후 바뀐 주문만 돌려준다(증분 동기화가 실제와 같은 방식으로 동작하는지 보여주기 위해).
 */
export class MockSalesChannel implements SalesChannelAdapter, InquirySource {
  readonly name = 'mock';
  /** 답변 기록(테스트·데모에서 확인용) */
  readonly answered: Array<{ inquiryId: string; text: string }> = [];

  constructor(private readonly now: () => Date) {}

  async listChangedOrders(since: Date | null): Promise<SalesOrderSnapshot[]> {
    const all = buildMockOrders(this.now()).map((f) => f.sales);
    return since ? all.filter((o) => o.updatedAt > since) : all;
  }

  async listUnansweredInquiries(since: Date): Promise<MarketInquiry[]> {
    const done = new Set(this.answered.map((a) => a.inquiryId));
    return buildMockCoupangInquiries(this.now()).filter((q) => q.askedAt > since && !done.has(q.inquiryId));
  }

  async answerInquiry(inquiry: Pick<MarketInquiry, 'inquiryId' | 'kind'>, text: string): Promise<void> {
    this.answered.push({ inquiryId: inquiry.inquiryId, text });
  }
}
