import type { MarketInquiry, SalesOrderSnapshot } from './sales-channel/types';
import type { SupplierOrderSnapshot } from './supplier/types';

/**
 * mock 데이터 20건. mock 어댑터와 scripts/seed.ts가 함께 쓴다.
 * 정책 표의 모든 칸(상태 × 채널, 반품 기간 안/밖, 확인 필요)을 한 번 이상 지나도록 골랐다.
 *
 * 모든 값은 가짜다. 이름은 마스킹 형태, 주문번호·송장번호는 실제 형식과 자릿수만 비슷하게 만들었다.
 * 시각은 "지금"을 기준으로 상대적으로 만든다. 반품 기간 판단이 실행 시점과 관계없이 같은 결과를 내게 하기 위해서다.
 *
 * 이 파일은 Node(scripts)에서도 직접 실행되므로 type import만 쓴다.
 */

export interface MockOrderFixture {
  sales: SalesOrderSnapshot;
  supplier: SupplierOrderSnapshot | null;
  /** 문서·테스트에서 부르는 이름 */
  scenario: string;
}

const HOUR = 60 * 60 * 1000;
const DAY = 24 * HOUR;

type Stage =
  | 'PAID'
  | 'SUPPLIER_ORDERED'
  | 'SHIPPED'
  | 'IN_TRANSIT'
  | 'DELIVERED'
  | 'CANCEL_REQUESTED'
  | 'CANCELLED'
  | 'RETURN_REQUESTED'
  | 'RETURNED';

interface Spec {
  scenario: string;
  channel: 'smartstore' | 'coupang';
  orderNo: string;
  product: string;
  option: string | null;
  qty: number;
  name: string;
  last4: string;
  stage: Stage;
  /** 주문 시각: 지금으로부터 며칠 전 */
  orderedDaysAgo: number;
  /** 배송완료 시각: 지금으로부터 며칠 전. null이면 배송완료 일자 미상 */
  deliveredDaysAgo?: number | null;
  supplier?: 'SUPPLIER_A' | 'SUPPLIER_B';
  carrier?: string;
  needsReview?: boolean;
}

const SPECS: Spec[] = [
  // ── 스마트스토어 ──
  {
    scenario: '결제 직후(발주 전)',
    channel: 'smartstore',
    orderNo: '2026110900000101',
    product: '접이식 실리콘 밀폐용기 3종',
    option: '라이트그레이',
    qty: 1,
    name: '김*진',
    last4: '1201',
    stage: 'PAID',
    orderedDaysAgo: 0.1,
  },
  {
    scenario: '결제 직후(발주 전) 2',
    channel: 'smartstore',
    orderNo: '2026110900000102',
    product: '스테인리스 텀블러 500ml',
    option: '블랙',
    qty: 2,
    name: '이*우',
    last4: '1202',
    stage: 'PAID',
    orderedDaysAgo: 0.3,
  },
  {
    scenario: '발주 완료(출고 전)',
    channel: 'smartstore',
    orderNo: '2026110800000103',
    product: '무선 미니 가습기',
    option: '화이트',
    qty: 1,
    name: '박*현',
    last4: '1203',
    stage: 'SUPPLIER_ORDERED',
    orderedDaysAgo: 1,
    supplier: 'SUPPLIER_A',
  },
  {
    scenario: '발주 완료(출고 전) 2',
    channel: 'smartstore',
    orderNo: '2026110800000104',
    product: '극세사 수면 양말 5켤레',
    option: '랜덤',
    qty: 1,
    name: '최*아',
    last4: '1204',
    stage: 'SUPPLIER_ORDERED',
    orderedDaysAgo: 1.2,
    supplier: 'SUPPLIER_B',
  },
  {
    scenario: '출고 완료',
    channel: 'smartstore',
    orderNo: '2026110700000105',
    product: '욕실 규조토 발매트',
    option: '베이지',
    qty: 1,
    name: '정*호',
    last4: '1205',
    stage: 'SHIPPED',
    orderedDaysAgo: 2,
    supplier: 'SUPPLIER_A',
    carrier: 'CJ대한통운',
  },
  {
    scenario: '배송 중',
    channel: 'smartstore',
    orderNo: '2026110600000106',
    product: '차량용 송풍구 거치대',
    option: null,
    qty: 1,
    name: '강*민',
    last4: '1206',
    stage: 'IN_TRANSIT',
    orderedDaysAgo: 3,
    supplier: 'SUPPLIER_B',
    carrier: '롯데택배',
  },
  {
    scenario: '배송완료 2일(반품 가능)',
    channel: 'smartstore',
    orderNo: '2026110300000107',
    product: '논슬립 옷걸이 30개',
    option: '그레이',
    qty: 1,
    name: '조*은',
    last4: '1207',
    stage: 'DELIVERED',
    orderedDaysAgo: 6,
    deliveredDaysAgo: 2,
    supplier: 'SUPPLIER_A',
    carrier: 'CJ대한통운',
  },
  {
    scenario: '배송완료 12일(반품 기간 경과)',
    channel: 'smartstore',
    orderNo: '2026102500000108',
    product: 'LED 무드등 스탠드',
    option: '우드',
    qty: 1,
    name: '윤*서',
    last4: '1208',
    stage: 'DELIVERED',
    orderedDaysAgo: 15,
    deliveredDaysAgo: 12,
    supplier: 'SUPPLIER_B',
    carrier: '한진택배',
  },
  {
    scenario: '취소 요청 중',
    channel: 'smartstore',
    orderNo: '2026110800000109',
    product: '방수 피크닉 매트',
    option: '체크',
    qty: 1,
    name: '장*훈',
    last4: '1209',
    stage: 'CANCEL_REQUESTED',
    orderedDaysAgo: 1,
  },
  {
    scenario: '반품 완료',
    channel: 'smartstore',
    orderNo: '2026102000000110',
    product: '전동 거품기',
    option: null,
    qty: 1,
    name: '임*나',
    last4: '1210',
    stage: 'RETURNED',
    orderedDaysAgo: 20,
    deliveredDaysAgo: 16,
    supplier: 'SUPPLIER_A',
    carrier: 'CJ대한통운',
  },
  {
    scenario: '확인 필요(원천 예외)',
    channel: 'smartstore',
    orderNo: '2026110800000111',
    product: '실리콘 주방 집게 2P',
    option: null,
    qty: 1,
    name: '한*수',
    last4: '1211',
    stage: 'PAID',
    orderedDaysAgo: 0.8,
    needsReview: true,
  },
  // ── 쿠팡 ──
  {
    scenario: '결제 직후(발주 전)',
    channel: 'coupang',
    orderNo: '3000000000201',
    product: '접이식 실리콘 밀폐용기 3종',
    option: '민트',
    qty: 1,
    name: '오*영',
    last4: '2201',
    stage: 'PAID',
    orderedDaysAgo: 0.2,
  },
  {
    scenario: '발주 완료(출고 전)',
    channel: 'coupang',
    orderNo: '3000000000202',
    product: '스테인리스 텀블러 500ml',
    option: '실버',
    qty: 1,
    name: '서*준',
    last4: '2202',
    stage: 'SUPPLIER_ORDERED',
    orderedDaysAgo: 1,
    supplier: 'SUPPLIER_A',
  },
  {
    scenario: '출고 완료',
    channel: 'coupang',
    orderNo: '3000000000203',
    product: '무선 미니 가습기',
    option: '핑크',
    qty: 1,
    name: '신*희',
    last4: '2203',
    stage: 'SHIPPED',
    orderedDaysAgo: 2,
    supplier: 'SUPPLIER_B',
    carrier: 'CJ대한통운',
  },
  {
    scenario: '배송 중',
    channel: 'coupang',
    orderNo: '3000000000204',
    product: '욕실 규조토 발매트',
    option: '그레이',
    qty: 2,
    name: '권*태',
    last4: '2204',
    stage: 'IN_TRANSIT',
    orderedDaysAgo: 3,
    supplier: 'SUPPLIER_A',
    carrier: '한진택배',
  },
  {
    scenario: '배송완료 1일(반품 가능)',
    channel: 'coupang',
    orderNo: '3000000000205',
    product: '차량용 송풍구 거치대',
    option: null,
    qty: 1,
    name: '황*연',
    last4: '2205',
    stage: 'DELIVERED',
    orderedDaysAgo: 4,
    deliveredDaysAgo: 1,
    supplier: 'SUPPLIER_B',
    carrier: '롯데택배',
  },
  {
    scenario: '배송완료 9일(반품 기간 경과)',
    channel: 'coupang',
    orderNo: '3000000000206',
    product: 'LED 무드등 스탠드',
    option: '화이트',
    qty: 1,
    name: '안*혁',
    last4: '2206',
    stage: 'DELIVERED',
    orderedDaysAgo: 12,
    deliveredDaysAgo: 9,
    supplier: 'SUPPLIER_A',
    carrier: 'CJ대한통운',
  },
  {
    scenario: '취소 완료',
    channel: 'coupang',
    orderNo: '3000000000207',
    product: '방수 피크닉 매트',
    option: '네이비',
    qty: 1,
    name: '송*림',
    last4: '2207',
    stage: 'CANCELLED',
    orderedDaysAgo: 5,
  },
  {
    scenario: '반품 요청 중',
    channel: 'coupang',
    orderNo: '3000000000208',
    product: '논슬립 옷걸이 30개',
    option: '화이트',
    qty: 1,
    name: '유*경',
    last4: '2208',
    stage: 'RETURN_REQUESTED',
    orderedDaysAgo: 8,
    deliveredDaysAgo: 4,
    supplier: 'SUPPLIER_B',
    carrier: 'CJ대한통운',
  },
  {
    scenario: '배송완료 일자 미상',
    channel: 'coupang',
    orderNo: '3000000000209',
    product: '전동 거품기',
    option: null,
    qty: 1,
    name: '홍*동',
    last4: '2209',
    stage: 'DELIVERED',
    orderedDaysAgo: 7,
    deliveredDaysAgo: null,
    supplier: 'SUPPLIER_A',
    carrier: '롯데택배',
  },
];

/** 판매채널이 아는 상태. 발주 여부는 모르므로 SUPPLIER_ORDERED는 PAID로 보인다. */
function channelStatus(stage: Stage): SalesOrderSnapshot['status'] {
  return stage === 'SUPPLIER_ORDERED' ? 'PAID' : stage;
}

const SHIPPED_STAGES: Stage[] = ['SHIPPED', 'IN_TRANSIT', 'DELIVERED', 'RETURN_REQUESTED', 'RETURNED'];

function shipmentStatus(stage: Stage): 'SHIPPED' | 'IN_TRANSIT' | 'DELIVERED' {
  if (stage === 'SHIPPED') return 'SHIPPED';
  if (stage === 'IN_TRANSIT') return 'IN_TRANSIT';
  return 'DELIVERED';
}

function build(spec: Spec, index: number, now: Date): MockOrderFixture {
  const at = (daysAgo: number) => new Date(now.getTime() - daysAgo * DAY);
  const orderedAt = at(spec.orderedDaysAgo);
  const deliveredAt =
    spec.deliveredDaysAgo === undefined || spec.deliveredDaysAgo === null ? null : at(spec.deliveredDaysAgo);
  // 마지막 변경 시각: 배송완료가 있으면 그 시각, 없으면 주문 후 1시간
  const updatedAt = deliveredAt ?? new Date(orderedAt.getTime() + HOUR);
  const shipped = SHIPPED_STAGES.includes(spec.stage);

  const supplier: SupplierOrderSnapshot | null = spec.supplier
    ? {
        channel: spec.channel,
        channelOrderId: spec.orderNo,
        supplierCode: spec.supplier,
        supplierOrderRef: `MOCK-PO-${String(index + 1).padStart(4, '0')}`,
        status: shipped ? 'SHIPPED' : 'ORDERED',
        orderedAt: new Date(orderedAt.getTime() + 2 * HOUR),
        shipment:
          shipped && spec.carrier
            ? {
                carrier: spec.carrier,
                trackingNo: `5000000${String(index + 1).padStart(5, '0')}`,
                status: shipmentStatus(spec.stage),
                updatedAt,
              }
            : null,
        updatedAt,
      }
    : null;

  return {
    scenario: `${spec.channel} · ${spec.scenario}`,
    sales: {
      channel: spec.channel,
      channelOrderId: spec.orderNo,
      productName: spec.product,
      optionName: spec.option,
      qty: spec.qty,
      buyerNameMasked: spec.name,
      phoneLast4: spec.last4,
      status: channelStatus(spec.stage),
      needsReview: spec.needsReview ?? false,
      orderedAt,
      deliveredAt,
      updatedAt,
    },
    supplier,
  };
}

export function buildMockOrders(now: Date): MockOrderFixture[] {
  return SPECS.map((spec, i) => build(spec, i, now));
}

/** 쿠팡 문의 브릿지용 미답변 문의. callcenter 문의는 브릿지가 건너뛰어야 한다. */
export function buildMockCoupangInquiries(now: Date): MarketInquiry[] {
  const at = (hoursAgo: number) => new Date(now.getTime() - hoursAgo * HOUR);
  return [
    {
      inquiryId: 'MOCK-Q-1',
      kind: 'product',
      productName: '무선 미니 가습기',
      content: '물통 용량이 몇 ml인가요?',
      askedAt: at(2),
    },
    {
      inquiryId: 'MOCK-Q-2',
      kind: 'product',
      productName: '스테인리스 텀블러 500ml',
      content: '오늘 주문하면 언제 출고되나요?',
      askedAt: at(5),
    },
    {
      inquiryId: 'MOCK-Q-3',
      kind: 'callcenter',
      productName: '방수 피크닉 매트',
      content: '[쿠팡 고객센터 이관] 고객이 환불 지연으로 불만을 제기함',
      askedAt: at(1),
    },
  ];
}
