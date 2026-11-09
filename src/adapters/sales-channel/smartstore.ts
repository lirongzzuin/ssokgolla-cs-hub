import { maskName } from '../../app/logger';
import type { OrderStatus } from '../../modules/orders';
import type { SalesChannelAdapter, SalesOrderSnapshot } from './types';

/**
 * 네이버 커머스 API(스마트스토어) 직접 호출 — 참고 구현(기본 배선에는 쓰지 않음, 운영은 ./engine.ts).
 *
 * 출처: https://apicenter.commerce.naver.com/docs/commerce-api/current (문서 v2.9x, 확인 2026-10-15)
 * 아래 엔드포인트·필드는 dropship-engine에서 실제 운영 중인 호출과 같다.
 *  - 토큰: POST /external/v1/oauth2/token
 *          client_secret_sign = base64(bcrypt(`${clientId}_${timestamp}`, clientSecret)), type=SELF, 3시간 유효
 *  - 변경 주문: GET  /external/v1/pay-order/seller/product-orders/last-changed-statuses (구간 24시간, more 페이지)
 *  - 상세 조회: POST /external/v1/pay-order/seller/product-orders/query (최대 300건)
 *
 * 토큰 서명에는 bcrypt가 필요하다. Workers에 bcrypt가 없어 의존성(bcryptjs)을 추가해야 하므로,
 * 사용자 확인 전까지 토큰 발급은 주입받는다(TokenProvider). → TODO(verify-api) 아님, 의존성 승인 대기.
 *
 * TODO(verify-api): 커머스 API 호출 IP 등록이 필요한지 확인(필요하면 쿠팡과 같은 이유로 Workers에서 직접 호출 불가).
 */

const BASE_URL = 'https://api.commerce.naver.com/external';
const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export type TokenProvider = () => Promise<string>;

const kst = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().replace('Z', '+09:00');

// biome-ignore lint/suspicious/noExplicitAny: 외부 응답은 이 파일 안에서만 다룬다
type Raw = any;

/** 상품주문 상태 + 클레임 → 판매채널 기준 통합 상태 */
export function toStatus(po: Raw): OrderStatus | null {
  const claimType = String(po?.claimType ?? '');
  const claimStatus = String(po?.claimStatus ?? '');
  if (claimType === 'CANCEL' && claimStatus === 'CANCEL_REQUEST') return 'CANCEL_REQUESTED';
  if (claimType === 'RETURN' && claimStatus !== 'RETURN_DONE' && !/REJECT/.test(claimStatus)) return 'RETURN_REQUESTED';
  switch (po?.productOrderStatus) {
    case 'PAYED':
      return 'PAID';
    case 'DELIVERING':
      return 'IN_TRANSIT';
    case 'DELIVERED':
    case 'PURCHASE_DECIDED':
    case 'EXCHANGED':
      return 'DELIVERED';
    case 'CANCELED':
    case 'CANCELED_BY_NOPAYMENT':
      return 'CANCELLED';
    case 'RETURNED':
      return 'RETURNED';
    default:
      return null;
  }
}

export class SmartstoreSalesChannel implements SalesChannelAdapter {
  readonly name = 'smartstore';

  constructor(
    private readonly getToken: TokenProvider,
    private readonly now: () => Date = () => new Date(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(
    method: string,
    path: string,
    query: Record<string, string | undefined> = {},
    body?: unknown,
  ): Promise<Raw> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v) qs.append(k, v);
    const q = qs.toString();
    const res = await this.fetchImpl(`${BASE_URL}${path}${q ? `?${q}` : ''}`, {
      method,
      headers: { Authorization: `Bearer ${await this.getToken()}`, 'Content-Type': 'application/json' },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`smartstore ${method} ${path} → ${res.status}`);
    return res.json();
  }

  async listChangedOrders(since: Date | null): Promise<SalesOrderSnapshot[]> {
    const to = this.now();
    const from = since ?? new Date(to.getTime() - 7 * DAY_MS);
    const ids = new Set<string>();
    for (let cursor = from.getTime(); cursor < to.getTime(); cursor += DAY_MS) {
      const end = new Date(Math.min(cursor + DAY_MS - 1000, to.getTime()));
      let moreFrom: string | undefined = kst(new Date(cursor));
      let moreSequence: string | undefined;
      for (let page = 0; page < 50 && moreFrom; page++) {
        const res = await this.request('GET', '/v1/pay-order/seller/product-orders/last-changed-statuses', {
          lastChangedFrom: moreFrom,
          lastChangedTo: kst(end),
          moreSequence,
        });
        for (const x of res?.data?.lastChangeStatuses ?? []) ids.add(String(x.productOrderId));
        moreFrom = res?.data?.more?.moreFrom;
        moreSequence = res?.data?.more?.moreSequence;
      }
    }
    const all = [...ids];
    const out: SalesOrderSnapshot[] = [];
    for (let i = 0; i < all.length; i += 300) {
      const res = await this.request(
        'POST',
        '/v1/pay-order/seller/product-orders/query',
        {},
        { productOrderIds: all.slice(i, i + 300) },
      );
      for (const row of res?.data ?? []) {
        const snap = this.toSnapshot(row, to);
        if (snap) out.push(snap);
      }
    }
    return out;
  }

  private toSnapshot(row: Raw, now: Date): SalesOrderSnapshot | null {
    const po = row.productOrder ?? {};
    const order = row.order ?? {};
    const status = toStatus(po);
    const addr = po.shippingAddress ?? {};
    const phone = String(addr.tel1 ?? addr.tel2 ?? '').replace(/\D/g, '');
    return {
      channel: 'smartstore',
      // 고객이 아는 번호는 주문번호(orderId). 상품주문번호(productOrderId)는 상품 줄마다 다르다.
      channelOrderId: String(order.orderId ?? ''),
      productName: String(po.productName ?? ''),
      optionName: po.productOption ? String(po.productOption) : null,
      qty: Number(po.quantity ?? 1),
      buyerNameMasked: maskName(String(addr.name ?? '')),
      // TODO(verify-api): 안심번호 사용 시 tel1이 안심번호일 수 있다. 주문자 연락처 필드(ordererTel) 사용 여부를 확인할 것.
      phoneLast4: phone.slice(-4),
      status: status ?? 'PAID',
      needsReview: status === null,
      orderedAt: new Date(order.paymentDate ?? order.orderDate ?? now),
      // TODO(verify-api): 배송완료 일시 필드명(delivery.deliveredDate 추정)을 실제 응답으로 확인할 것
      deliveredAt: null,
      // TODO(verify-api): 상품주문의 마지막 변경 시각 필드 확인. 없으면 last-changed-statuses의 lastChangedDate를 넘겨받아 쓴다.
      updatedAt: now,
    };
  }
}
