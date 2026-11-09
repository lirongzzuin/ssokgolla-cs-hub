import { maskName } from '../../app/logger';
import type { OrderStatus } from '../../modules/orders';
import type { InquirySource, MarketInquiry, SalesChannelAdapter, SalesOrderSnapshot } from './types';

/**
 * 쿠팡 OPEN API 직접 호출 — 참고 구현(기본 배선에는 쓰지 않음).
 *
 * ⚠️ Cloudflare Workers에서는 그대로 동작하지 않는다.
 *    쿠팡 OPEN API는 Wing에 등록한 IP(키당 최대 10개)에서만 호출되는데 Workers는 나가는 IP가 고정되지 않는다.
 *    출처: https://developers.coupang.com/ko/getting-started/issue-open-api-keynew (확인 2026-10-13)
 *    → 운영은 dropship-engine 경유(./engine.ts). 직접 붙이려면 고정 IP 프록시가 필요하다.
 *
 * 아래 엔드포인트·파라미터는 dropship-engine에서 실제 운영 중인 호출과 같다.
 *  - 인증(HMAC): https://developers.coupang.com/ko/getting-started/creating-hmac-signature (확인 2026-10-13)
 *  - 발주서 분단위 조회: https://developers.coupang.com/ko/api/shipments/po-list-query-by-minute (확인 2026-10-13)
 *  - 상품문의 조회·답변: https://developers.coupang.com/ko/api (확인 2026-10-13)
 *  - 고객센터 이관 문의: v4 callCenterInquiries (실측 200, 2026-10-14)
 */

const BASE_URL = 'https://api-gateway.coupang.com';
const OPEN = '/v2/providers/openapi/apis/api';
const KST_MS = 9 * 60 * 60 * 1000;
const DAY_MS = 24 * 60 * 60 * 1000;

export interface CoupangCredentials {
  vendorId: string;
  accessKey: string;
  secretKey: string;
  /** 문의 답변자(Wing 로그인 ID). 답변 API의 replyBy 값 */
  wingUserId: string;
}

/** yyMMdd'T'HHmmss'Z' (UTC) */
export function signedDate(now: Date): string {
  const iso = now.toISOString();
  return `${iso.slice(2, 4)}${iso.slice(5, 7)}${iso.slice(8, 10)}T${iso.slice(11, 13)}${iso.slice(14, 16)}${iso.slice(17, 19)}Z`;
}

/** message = signedDate + METHOD + path + query(물음표 제외), signature = hex(HMAC-SHA256) */
export async function buildAuthorization(
  method: string,
  path: string,
  query: string,
  creds: Pick<CoupangCredentials, 'accessKey' | 'secretKey'>,
  now: Date,
): Promise<string> {
  const dt = signedDate(now);
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    'raw',
    enc.encode(creds.secretKey),
    { name: 'HMAC', hash: 'SHA-256' },
    false,
    ['sign'],
  );
  const sig = await crypto.subtle.sign('HMAC', key, enc.encode(dt + method.toUpperCase() + path + query));
  const hex = [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, '0')).join('');
  return `CEA algorithm=HmacSHA256, access-key=${creds.accessKey}, signed-date=${dt}, signature=${hex}`;
}

const kstIsoMinute = (d: Date) => `${new Date(d.getTime() + KST_MS).toISOString().slice(0, 16)}+09:00`;
const kstDate = (d: Date) => new Date(d.getTime() + KST_MS).toISOString().slice(0, 10);

/** 쿠팡 발주서 상태 → 판매채널 기준 통합 상태(발주 여부는 모름) */
const STATUS: Record<string, OrderStatus> = {
  ACCEPT: 'PAID', // 결제완료
  INSTRUCT: 'PAID', // 상품준비중(판매자 확인). 공급처 발주 여부는 공급처 어댑터가 알려준다
  DEPARTURE: 'SHIPPED',
  DELIVERING: 'IN_TRANSIT',
  NONE_TRACKING: 'SHIPPED', // 업체직송(추적 없음)
  FINAL_DELIVERY: 'DELIVERED',
};

// biome-ignore lint/suspicious/noExplicitAny: 외부 응답은 이 함수 안에서만 다루고 바로 도메인 타입으로 바꾼다
type Raw = any;

export class CoupangSalesChannel implements SalesChannelAdapter, InquirySource {
  readonly name = 'coupang';

  constructor(
    private readonly creds: CoupangCredentials,
    private readonly now: () => Date = () => new Date(),
    private readonly fetchImpl: typeof fetch = fetch,
  ) {}

  private async request(
    method: string,
    path: string,
    query: Record<string, string | number | undefined> = {},
    body?: unknown,
  ): Promise<Raw> {
    const qs = new URLSearchParams();
    for (const [k, v] of Object.entries(query)) if (v !== undefined && v !== '') qs.append(k, String(v));
    const q = qs.toString();
    const res = await this.fetchImpl(`${BASE_URL}${path}${q ? `?${q}` : ''}`, {
      method,
      headers: {
        Authorization: await buildAuthorization(method, path, q, this.creds, this.now()),
        'Content-Type': 'application/json;charset=UTF-8',
        'X-Requested-By': this.creds.vendorId,
      },
      body: body === undefined ? undefined : JSON.stringify(body),
    });
    if (!res.ok) throw new Error(`coupang ${method} ${path} → ${res.status}`);
    return res.json();
  }

  /** 발주서 분단위 조회는 구간 24시간 이내, 상태별로 따로 조회해야 한다 */
  async listChangedOrders(since: Date | null): Promise<SalesOrderSnapshot[]> {
    const to = this.now();
    const from = since ?? new Date(to.getTime() - 7 * DAY_MS);
    const out: SalesOrderSnapshot[] = [];
    for (const status of Object.keys(STATUS)) {
      for (let cursor = from.getTime(); cursor < to.getTime(); cursor += DAY_MS) {
        const end = new Date(Math.min(cursor + DAY_MS - 60_000, to.getTime()));
        let nextToken: string | undefined;
        do {
          const res = await this.request('GET', `${OPEN}/v5/vendors/${this.creds.vendorId}/ordersheets`, {
            createdAtFrom: kstIsoMinute(new Date(cursor)),
            createdAtTo: kstIsoMinute(end),
            status,
            searchType: 'timeFrame',
            nextToken,
          });
          for (const sheet of res?.data ?? []) out.push(this.toSnapshot(sheet, to));
          nextToken = res?.nextToken || undefined;
        } while (nextToken);
      }
    }
    return out;
  }

  private toSnapshot(sheet: Raw, now: Date): SalesOrderSnapshot {
    const item = sheet.orderItems?.[0] ?? {};
    const receiver = sheet.receiver ?? {};
    const phone = String(receiver.receiverNumber ?? receiver.safeNumber ?? '').replace(/\D/g, '');
    return {
      channel: 'coupang',
      channelOrderId: String(sheet.orderId),
      // 엔진과 같은 필드. 옵션명은 vendorItemName에 상품명과 함께 들어온다.
      productName: String(item.vendorItemName ?? item.sellerProductName ?? ''),
      optionName: null,
      qty: Number(item.shippingCount ?? 1),
      // 실명은 이 줄을 지나면 사라진다
      buyerNameMasked: maskName(String(receiver.name ?? '')),
      // TODO(verify-api): 쿠팡은 수취인 번호로 안심번호(safeNumber)를 줄 수 있다. 안심번호 뒤 4자리는
      //   고객이 아는 번호와 달라 본인 확인이 실패한다. 주문자 번호 필드와 안심번호 여부를 실제 응답으로 확인할 것.
      phoneLast4: phone.slice(-4),
      status: STATUS[String(sheet.status)] ?? 'PAID',
      needsReview: !(String(sheet.status) in STATUS),
      orderedAt: new Date(sheet.orderedAt ?? sheet.paidAt ?? now),
      // TODO(verify-api): 배송완료 일시 필드를 발주서 응답에서 확인할 것(반품 기간 계산에 필요). 없으면 배송상태 변경 히스토리 API.
      deliveredAt: null,
      // TODO(verify-api): 발주서에 "마지막 변경 시각"이 없어 조회 시각을 쓴다. 이 때문에 허브의 *_REQUESTED 표시를 항상 덮어쓴다.
      updatedAt: now,
    };
  }

  /** 미답변 상품문의 + 고객센터 이관 문의. 조회 구간은 7일 이하 */
  async listUnansweredInquiries(since: Date): Promise<MarketInquiry[]> {
    const to = this.now();
    const from = new Date(Math.max(since.getTime(), to.getTime() - 7 * DAY_MS));
    const out: MarketInquiry[] = [];
    const v = this.creds.vendorId;
    const online = await this.request('GET', `${OPEN}/v5/vendors/${v}/onlineInquiries`, {
      vendorId: v,
      answeredType: 'NOANSWER',
      inquiryStartAt: kstDate(from),
      inquiryEndAt: kstDate(to),
      pageNum: 1,
      pageSize: 50,
    });
    for (const c of online?.data?.content ?? []) {
      out.push({
        inquiryId: String(c.inquiryId),
        kind: 'product',
        // TODO(verify-api): 문의 응답의 상품명 필드 확인(엔진은 vendorItemId만 사용)
        productName: null,
        content: String(c.content ?? ''),
        askedAt: new Date(c.inquiryAt ?? to),
      });
    }
    const callcenter = await this.request('GET', `${OPEN}/v4/vendors/${v}/callCenterInquiries`, {
      vendorId: v,
      partnerCounselingStatus: 'NO_ANSWER',
      inquiryStartAt: kstDate(from),
      inquiryEndAt: kstDate(to),
      pageNum: 1,
      pageSize: 30,
    });
    for (const c of callcenter?.data?.content ?? []) {
      out.push({
        inquiryId: String(c.inquiryId),
        kind: 'callcenter',
        productName: null,
        content: String(c.content ?? c.inquiryContent ?? ''),
        askedAt: new Date(c.inquiryAt ?? c.createdAt ?? to),
      });
    }
    return out;
  }

  async answerInquiry(inquiry: Pick<MarketInquiry, 'inquiryId' | 'kind'>, text: string): Promise<void> {
    const v = this.creds.vendorId;
    const path =
      inquiry.kind === 'product'
        ? `${OPEN}/v4/vendors/${v}/onlineInquiries/${inquiry.inquiryId}/replies`
        : `${OPEN}/v4/vendors/${v}/callCenterInquiries/${inquiry.inquiryId}/replies`;
    await this.request('POST', path, {}, { content: text, vendorId: v, replyBy: this.creds.wingUserId });
  }
}
