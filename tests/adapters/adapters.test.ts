import { describe, expect, it } from 'vitest';
import { EngineClient, mapEngineStatus } from '../../src/adapters/engine-client';
import { buildAuthorization, signedDate } from '../../src/adapters/sales-channel/coupang';
import { EngineSalesChannel } from '../../src/adapters/sales-channel/engine';
import { toStatus } from '../../src/adapters/sales-channel/smartstore';
import { EngineSupplier } from '../../src/adapters/supplier/engine';
import { ConfigError } from '../../src/app/errors';

describe('엔진 상태 매핑(docs/architecture.md §4.2)', () => {
  it.each([
    ['NEW', false, 'PAID', false],
    ['OUT_OF_STOCK', false, 'PAID', false],
    ['PURCHASED', true, 'SUPPLIER_ORDERED', false],
    ['SHIPPING_DELAYED', true, 'SUPPLIER_ORDERED', false],
    ['TRACKING_UPLOADED', true, 'SHIPPED', false],
    ['SETTLED', true, 'DELIVERED', false],
    ['MANUAL_REVIEW', false, 'PAID', true],
    ['MANUAL_REVIEW', true, 'SUPPLIER_ORDERED', true],
  ] as const)('%s (발주 %s) → %s, 확인필요 %s', (engine, hasSource, status, needsReview) => {
    expect(mapEngineStatus(engine, hasSource)).toEqual({ status, needsReview });
  });
});

describe('엔진 어댑터', () => {
  const body = {
    orders: [
      {
        market: 'naver',
        marketOrderId: '2026110900000777',
        itemName: '상품',
        optionName: null,
        qty: 1,
        buyerNameMasked: '홍*동',
        phoneLast4: '0000',
        status: 'TRACKING_UPLOADED',
        orderedAt: '2026-11-08T01:00:00.000Z',
        deliveredAt: null,
        updatedAt: '2026-11-09T01:00:00.000Z',
        sourceOrder: { sourceCode: 'ownerclan', sourceOrderId: 'SRC-1', purchasedAt: '2026-11-08T02:00:00.000Z' },
        tracking: { carrierName: 'CJ대한통운', trackingNo: '500000000999', updatedAt: '2026-11-09T01:00:00.000Z' },
      },
    ],
  };

  it('Bearer 토큰으로 한 번만 호출하고, 판매주문·공급처주문으로 나눈다', async () => {
    const calls: Request[] = [];
    const fetchImpl = (async (input: RequestInfo, init?: RequestInit) => {
      calls.push(new Request(input, init));
      return Response.json(body);
    }) as typeof fetch;
    const client = new EngineClient('https://engine.example', 'tok', fetchImpl);

    const [sales] = await new EngineSalesChannel(client).listChangedOrders(null);
    const [supplier] = await new EngineSupplier(client).listChangedSupplierOrders(null);

    expect(calls).toHaveLength(1);
    expect(calls[0]?.headers.get('Authorization')).toBe('Bearer tok');
    expect(sales).toMatchObject({ channel: 'smartstore', status: 'SHIPPED', needsReview: false });
    // 공급처 실명(ownerclan)은 코드로 감싼다
    expect(supplier).toMatchObject({ supplierCode: 'SUPPLIER_OWNERCLAN', status: 'SHIPPED' });
    expect(supplier?.shipment).toMatchObject({ carrier: 'CJ대한통운', status: 'SHIPPED' });
  });

  it('응답이 계약과 다르면 실패한다(조용히 잘못된 값을 저장하지 않음)', async () => {
    const fetchImpl = (async () => Response.json({ orders: [{ market: 'naver' }] })) as unknown as typeof fetch;
    const client = new EngineClient('https://engine.example', 'tok', fetchImpl);
    await expect(client.listOrders(null)).rejects.toThrow();
  });

  it('설정이 없으면 ConfigError', async () => {
    await expect(new EngineClient(undefined, undefined).listOrders(null)).rejects.toBeInstanceOf(ConfigError);
  });
});

describe('쿠팡 HMAC(참고 구현)', () => {
  it('signed-date는 yyMMddTHHmmssZ(UTC)', () => {
    expect(signedDate(new Date('2026-10-13T06:31:54.806Z'))).toBe('261013T063154Z');
  });

  it('Authorization 헤더 형식', async () => {
    const auth = await buildAuthorization(
      'GET',
      '/v2/providers/openapi/apis/api/v5/vendors/A0000/ordersheets',
      'status=ACCEPT',
      { accessKey: 'ak', secretKey: 'sk' },
      new Date('2026-10-13T06:31:54Z'),
    );
    expect(auth).toMatch(
      /^CEA algorithm=HmacSHA256, access-key=ak, signed-date=261013T063154Z, signature=[0-9a-f]{64}$/,
    );
  });
});

describe('스마트스토어 상태 매핑(참고 구현)', () => {
  it.each([
    [{ productOrderStatus: 'PAYED' }, 'PAID'],
    [{ productOrderStatus: 'DELIVERING' }, 'IN_TRANSIT'],
    [{ productOrderStatus: 'PURCHASE_DECIDED' }, 'DELIVERED'],
    [{ productOrderStatus: 'PAYED', claimType: 'CANCEL', claimStatus: 'CANCEL_REQUEST' }, 'CANCEL_REQUESTED'],
    [{ productOrderStatus: 'DELIVERED', claimType: 'RETURN', claimStatus: 'COLLECTING' }, 'RETURN_REQUESTED'],
    [{ productOrderStatus: 'RETURNED', claimType: 'RETURN', claimStatus: 'RETURN_DONE' }, 'RETURNED'],
    [{ productOrderStatus: 'SOMETHING_NEW' }, null],
  ])('%o → %s', (po, expected) => {
    expect(toStatus(po)).toBe(expected);
  });
});
