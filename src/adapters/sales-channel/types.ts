import type { Channel, OrderStatus } from '../../modules/orders';

/**
 * 판매채널 어댑터 인터페이스.
 * 구현체는 외부 응답을 이 형식(통합 상태, 마스킹된 값)으로 바꿔서 돌려준다.
 * 실명·전화번호 전체·주소는 이 경계를 넘어오지 않는다.
 */
export interface SalesOrderSnapshot {
  channel: Channel;
  channelOrderId: string;
  productName: string;
  optionName: string | null;
  qty: number;
  buyerNameMasked: string;
  phoneLast4: string;
  /** 판매채널 기준 상태. 공급처 발주 여부는 sync가 공급처 주문과 합쳐 판단한다(deriveStatus). */
  status: OrderStatus;
  needsReview: boolean;
  orderedAt: Date;
  deliveredAt: Date | null;
  updatedAt: Date;
}

export interface SalesChannelAdapter {
  readonly name: string;
  /** since 이후 바뀐 주문. since가 null이면 처음 동기화(최근 주문 전체). */
  listChangedOrders(since: Date | null): Promise<SalesOrderSnapshot[]>;
}

/** 판매채널 고객문의(쿠팡 문의 브릿지용) */
export interface MarketInquiry {
  inquiryId: string;
  /** product = 상품 문의, callcenter = 쿠팡 고객센터 이관 문의(사람이 직접 처리) */
  kind: 'product' | 'callcenter';
  productName: string | null;
  content: string;
  askedAt: Date;
}

export interface InquirySource {
  listUnansweredInquiries(since: Date): Promise<MarketInquiry[]>;
  answerInquiry(inquiry: Pick<MarketInquiry, 'inquiryId' | 'kind'>, text: string): Promise<void>;
}
