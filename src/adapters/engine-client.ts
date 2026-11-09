import { z } from 'zod';
import { ConfigError, UpstreamError } from '../app/errors';
import type { Channel, OrderStatus } from '../modules/orders';

/**
 * coupang-dropship-engine(위탁판매 운영 시스템) 읽기 전용 클라이언트. DATA_SOURCE=live의 데이터 출처다.
 *
 * 왜 판매채널을 직접 부르지 않는가: docs/architecture.md §4 (쿠팡 허용 IP 제약 + 주문-발주-송장 연결의 단일 출처)
 *
 * TODO(verify-api): 아래 엔드포인트와 응답 형식은 이 허브가 엔진에 "제안하는" 계약이다. 엔진에는 아직 없다.
 *   - GET  {ENGINE_BASE_URL}/api/cs-hub/orders?updatedSince=ISO8601  → EngineOrdersResponse
 *   - GET  {ENGINE_BASE_URL}/api/cs-hub/inquiries?market=coupang&since=ISO8601 → EngineInquiriesResponse
 *   - POST {ENGINE_BASE_URL}/api/cs-hub/inquiries/{kind}/{inquiryId}/reply  body {text}
 *   - 인증: Authorization: Bearer {ENGINE_TOKEN} (엔진 관리자 API는 로그인+OTP라 서버 간 호출에 못 씀)
 *   엔진에 구현한 뒤 실제 응답으로 스키마를 확인하고 이 주석을 지운다.
 */

/** 엔진 주문 상태(엔진 server/src/modules/orders/stateMachine.ts의 ORDER_STATUSES) */
const ENGINE_STATUSES = [
  'NEW',
  'AWAITING_PURCHASE',
  'PAYMENT_PENDING',
  'PURCHASED',
  'TRACKING_UPLOADED',
  'IN_TRANSIT',
  'DELIVERED',
  'SETTLED',
  'OUT_OF_STOCK',
  'MARGIN_NEGATIVE',
  'LIMIT_EXCEEDED',
  'SOURCE_ERROR',
  'MANUAL_REVIEW',
  'CANCEL_REQUESTED',
  'CANCELLED',
  'RETURN_REQUESTED',
  'RETURNED',
  'SHIPPING_DELAYED',
  'ADDRESS_CHANGED',
] as const;
type EngineStatus = (typeof ENGINE_STATUSES)[number];

const isoDate = z.iso.datetime({ offset: true }).transform((s) => new Date(s));

const engineOrderSchema = z.object({
  market: z.enum(['coupang', 'naver']),
  marketOrderId: z.string().min(1),
  itemName: z.string(),
  optionName: z.string().nullable(),
  qty: z.number().int().positive(),
  buyerNameMasked: z.string(),
  phoneLast4: z.string().regex(/^\d{4}$/),
  status: z.enum(ENGINE_STATUSES),
  orderedAt: isoDate,
  deliveredAt: isoDate.nullable(),
  updatedAt: isoDate,
  /** 공급처 발주(엔진 source_order_id). 고객에게 노출 금지 */
  sourceOrder: z.object({ sourceCode: z.string(), sourceOrderId: z.string(), purchasedAt: isoDate }).nullable(),
  tracking: z.object({ carrierName: z.string(), trackingNo: z.string(), updatedAt: isoDate }).nullable(),
});
export type EngineOrder = z.infer<typeof engineOrderSchema>;

const engineInquirySchema = z.object({
  inquiryId: z.string(),
  kind: z.enum(['product', 'callcenter']),
  productName: z.string().nullable(),
  content: z.string(),
  askedAt: isoDate,
});
export type EngineInquiry = z.infer<typeof engineInquirySchema>;

/** 엔진 상태 → 통합 상태. docs/architecture.md §4.2 표와 같아야 한다. */
const STATUS_MAP: Record<EngineStatus, OrderStatus | 'REVIEW'> = {
  NEW: 'PAID',
  AWAITING_PURCHASE: 'PAID',
  PAYMENT_PENDING: 'PAID',
  OUT_OF_STOCK: 'PAID',
  MARGIN_NEGATIVE: 'PAID',
  LIMIT_EXCEEDED: 'PAID',
  SOURCE_ERROR: 'PAID',
  PURCHASED: 'SUPPLIER_ORDERED',
  SHIPPING_DELAYED: 'SUPPLIER_ORDERED',
  ADDRESS_CHANGED: 'SUPPLIER_ORDERED',
  TRACKING_UPLOADED: 'SHIPPED',
  IN_TRANSIT: 'IN_TRANSIT',
  DELIVERED: 'DELIVERED',
  SETTLED: 'DELIVERED',
  CANCEL_REQUESTED: 'CANCEL_REQUESTED',
  CANCELLED: 'CANCELLED',
  RETURN_REQUESTED: 'RETURN_REQUESTED',
  RETURNED: 'RETURNED',
  MANUAL_REVIEW: 'REVIEW',
};

export function mapEngineStatus(
  status: EngineStatus,
  hasSourceOrder: boolean,
): { status: OrderStatus; needsReview: boolean } {
  const mapped = STATUS_MAP[status];
  if (mapped === 'REVIEW') {
    // 엔진이 '확인 필요'로 둔 주문은 원래 상태를 알 수 없다. 발주 여부로 가장 가까운 상태를 고르고 정책은 ESCALATE 한다.
    return { status: hasSourceOrder ? 'SUPPLIER_ORDERED' : 'PAID', needsReview: true };
  }
  return { status: mapped, needsReview: false };
}

export function toChannel(market: EngineOrder['market']): Channel {
  return market === 'naver' ? 'smartstore' : 'coupang';
}

export class EngineClient {
  /** sales·supplier 어댑터가 같은 since로 두 번 부르지 않도록 응답을 잠깐 공유한다 */
  private cache = new Map<string, Promise<EngineOrder[]>>();

  constructor(
    private readonly baseUrl: string | undefined,
    private readonly token: string | undefined,
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(path: string, init: RequestInit = {}): Promise<unknown> {
    if (!this.baseUrl || !this.token) {
      throw new ConfigError('DATA_SOURCE=live 에는 ENGINE_BASE_URL과 ENGINE_TOKEN이 필요합니다');
    }
    const res = await this.fetchImpl(`${this.baseUrl}${path}`, {
      ...init,
      headers: { Authorization: `Bearer ${this.token}`, 'Content-Type': 'application/json', ...init.headers },
      // Workers 요청 하나가 엔진 지연에 묶이지 않게 짧게 끊는다. ALF Code 스텝 제한은 60초다.
      signal: AbortSignal.timeout(10_000),
    });
    if (!res.ok) throw new UpstreamError(`engine ${init.method ?? 'GET'} ${path} → ${res.status}`);
    return res.status === 204 ? null : res.json();
  }

  listOrders(since: Date | null): Promise<EngineOrder[]> {
    const key = since?.toISOString() ?? 'all';
    let pending = this.cache.get(key);
    if (!pending) {
      const qs = since ? `?updatedSince=${encodeURIComponent(key)}` : '';
      pending = this.request(`/api/cs-hub/orders${qs}`).then(
        (body) => z.object({ orders: z.array(engineOrderSchema) }).parse(body).orders,
      );
      this.cache.set(key, pending);
    }
    return pending;
  }

  async listCoupangInquiries(since: Date): Promise<EngineInquiry[]> {
    const body = await this.request(
      `/api/cs-hub/inquiries?market=coupang&since=${encodeURIComponent(since.toISOString())}`,
    );
    return z.object({ inquiries: z.array(engineInquirySchema) }).parse(body).inquiries;
  }

  async replyInquiry(kind: EngineInquiry['kind'], inquiryId: string, text: string): Promise<void> {
    await this.request(`/api/cs-hub/inquiries/${kind}/${encodeURIComponent(inquiryId)}/reply`, {
      method: 'POST',
      body: JSON.stringify({ text }),
    });
  }
}
