import { env } from 'cloudflare:test';
import { beforeEach, describe, expect, it } from 'vitest';
import { app } from '../src/index';
import { resetAndSeed } from './helpers';

/**
 * docs/test-scenarios.md 의 B·C(태스크 호출) 문항이 문서에 적힌 기대 결과와 같은지 확인한다.
 * 문서를 고치면 이 표도 같이 고친다. ALF 동작(재질문·태그)은 채널톡에서 수동 채점한다.
 */
const CASES: Array<[string, string, Record<string, string>, string, string]> = [
  ['B1', 'lookup', { orderNo: '2026110600000106', phoneLast4: '1206' }, 'INFO', 'STATUS_SHIPPING'],
  ['B2', 'cancel', { orderNo: '3000000000201', phoneLast4: '2201' }, 'ALLOW', 'CANCELABLE_BEFORE_SUPPLIER_ORDER'],
  ['B3', 'cancel', { orderNo: '2026110900000101', phoneLast4: '1201' }, 'ALLOW', 'CANCELABLE_BEFORE_SUPPLIER_ORDER'],
  ['B4', 'cancel', { orderNo: '3000000000203', phoneLast4: '2203' }, 'DENY', 'ALREADY_SHIPPED'],
  [
    'B5',
    'return-request',
    { orderNo: '2026110300000107', phoneLast4: '1207', reason: 'CHANGE_OF_MIND' },
    'ALLOW',
    'RETURN_WITHIN_WINDOW',
  ],
  [
    'B6',
    'return-request',
    { orderNo: '3000000000201', phoneLast4: '2201', reason: 'CHANGE_OF_MIND' },
    'DENY',
    'NOT_SHIPPED_USE_CANCEL',
  ],
  [
    'B7',
    'address-change',
    { orderNo: '2026110900000102', phoneLast4: '1202' },
    'ALLOW',
    'ADDRESS_CHANGEABLE_BEFORE_SUPPLIER_ORDER',
  ],
  ['B8', 'address-change', { orderNo: '3000000000204', phoneLast4: '2204' }, 'DENY', 'ALREADY_SHIPPED'],
  ['B9', 'lookup', { orderNo: '2026110900000101', phoneLast4: '9999' }, 'DENY', 'ORDER_NOT_FOUND'],
  ['B11', 'lookup', { orderNo: '2026110800000109', phoneLast4: '1209' }, 'INFO', 'STATUS_CANCEL_REQUESTED'],
  ['B12', 'lookup', { orderNo: '3000000000207', phoneLast4: '2207' }, 'INFO', 'STATUS_CANCELLED'],
  ['C1', 'cancel', { orderNo: '2026110800000103', phoneLast4: '1203' }, 'ESCALATE', 'SUPPLIER_ALREADY_ORDERED'],
  ['C2', 'address-change', { orderNo: '3000000000202', phoneLast4: '2202' }, 'ESCALATE', 'SUPPLIER_ALREADY_ORDERED'],
  [
    'C3',
    'return-request',
    { orderNo: '3000000000205', phoneLast4: '2205', reason: 'DEFECT' },
    'ESCALATE',
    'RETURN_NEEDS_INSPECTION',
  ],
  [
    'C4',
    'return-request',
    { orderNo: '2026102500000108', phoneLast4: '1208', reason: 'CHANGE_OF_MIND' },
    'ESCALATE',
    'RETURN_WINDOW_EXPIRED',
  ],
  ['C5', 'lookup', { orderNo: '2026110800000111', phoneLast4: '1211' }, 'ESCALATE', 'MANUAL_REVIEW_REQUIRED'],
];

beforeEach(async () => {
  await resetAndSeed();
});

describe('docs/test-scenarios.md B·C 기대 결과', () => {
  it.each(CASES)('%s %s → %s', async (_id, path, body, decision, reasonCode) => {
    const res = await app.request(
      `/alf/orders/${path}`,
      {
        method: 'POST',
        headers: { 'Content-Type': 'application/json', 'X-ALF-Secret': env.ALF_SECRET ?? '' },
        body: JSON.stringify(body),
      },
      env,
    );
    const json = (await res.json()) as { decision: string; reasonCode: string; customerMessage: string };
    expect({ decision: json.decision, reasonCode: json.reasonCode }).toEqual({ decision, reasonCode });
    if (decision === 'ESCALATE') expect(json.customerMessage).toMatch(/담당자가 확인 후 안내드리겠습니다\.$/);
  });
});
