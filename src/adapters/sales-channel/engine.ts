import { type EngineClient, mapEngineStatus, toChannel } from '../engine-client';
import type { InquirySource, MarketInquiry, SalesChannelAdapter, SalesOrderSnapshot } from './types';

/**
 * live 판매채널 어댑터(기본). 스마트스토어·쿠팡 주문을 dropship-engine을 거쳐 읽는다.
 * 엔진 계약은 engine-client.ts의 TODO(verify-api) 참고.
 */
export class EngineSalesChannel implements SalesChannelAdapter, InquirySource {
  readonly name = 'engine';

  constructor(private readonly client: EngineClient) {}

  async listChangedOrders(since: Date | null): Promise<SalesOrderSnapshot[]> {
    const orders = await this.client.listOrders(since);
    return orders.map((o) => {
      const { status, needsReview } = mapEngineStatus(o.status, o.sourceOrder !== null);
      return {
        channel: toChannel(o.market),
        channelOrderId: o.marketOrderId,
        productName: o.itemName,
        optionName: o.optionName,
        qty: o.qty,
        buyerNameMasked: o.buyerNameMasked,
        phoneLast4: o.phoneLast4,
        status,
        needsReview,
        orderedAt: o.orderedAt,
        deliveredAt: o.deliveredAt,
        updatedAt: o.updatedAt,
      };
    });
  }

  async listUnansweredInquiries(since: Date): Promise<MarketInquiry[]> {
    return this.client.listCoupangInquiries(since);
  }

  async answerInquiry(inquiry: Pick<MarketInquiry, 'inquiryId' | 'kind'>, text: string): Promise<void> {
    await this.client.replyInquiry(inquiry.kind, inquiry.inquiryId, text);
  }
}
