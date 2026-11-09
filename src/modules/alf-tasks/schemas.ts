import { z } from 'zod';
import { CHANNELS, ORDER_STATUSES, RETURN_REASONS } from '../orders';

/**
 * ALF 태스크 ↔ 허브 계약. 채널톡 Code 스텝이 보내고 받는 JSON이다.
 * docs/channeltalk/03-tasks.md의 코드 예시와 같아야 한다.
 */

// ALF가 고객 입력을 그대로 옮기므로 하이픈·공백이 섞여 온다. 숫자만 남긴다.
const digitsOnly = (s: unknown) => (typeof s === 'string' || typeof s === 'number' ? String(s).replace(/\D/g, '') : s);

const orderNo = z.preprocess(digitsOnly, z.string().regex(/^\d{8,20}$/, '주문번호는 숫자 8~20자리'));
const phoneLast4 = z.preprocess(digitsOnly, z.string().regex(/^\d{4}$/, '휴대폰 번호 뒤 4자리'));

/**
 * 모든 태스크 공통 입력. 주문번호와 뒤 4자리가 둘 다 필요하다(D3: 뒤 4자리 단독 조회 금지).
 * chatId: 채널톡 Code 스텝의 context.userChat.id. 태스크 기록을 상담과 연결해 리포트에 쓴다.
 */
export const orderRequestSchema = z.strictObject({
  orderNo,
  phoneLast4,
  channel: z.enum(CHANNELS).optional(),
  chatId: z.string().min(1).max(64).optional(),
});

export const lookupRequestSchema = orderRequestSchema;
export const cancelRequestSchema = orderRequestSchema;
// 새 주소는 받지 않는다: 판매자가 배송지를 바꾸는 API가 없고(고객이 직접 변경), 주소 원문을 저장하지 않기 위해(D2)
export const addressChangeRequestSchema = orderRequestSchema;
// 반품 사유는 자유 문장 대신 분류만 받는다. 자유 문장에는 개인정보가 섞이기 쉽다.
export const returnRequestSchema = orderRequestSchema.extend({
  reason: z.enum(RETURN_REASONS),
});

export type OrderRequest = z.infer<typeof orderRequestSchema>;
export type ReturnRequest = z.infer<typeof returnRequestSchema>;

/** 응답. ALF가 그대로 memory에 넣고 decision/reasonCode로 분기한다. */
export const taskResponseSchema = z.object({
  ok: z.boolean(),
  decision: z.enum(['ALLOW', 'ESCALATE', 'DENY', 'INFO']),
  reasonCode: z.string(),
  customerMessage: z.string(),
  data: z
    .object({
      order: z.object({
        channel: z.enum(CHANNELS),
        orderNo: z.string(),
        productName: z.string(),
        optionName: z.string().nullable(),
        qty: z.number(),
        status: z.enum(ORDER_STATUSES),
        statusLabel: z.string(),
        shipment: z.object({ carrier: z.string(), trackingNo: z.string() }).nullable(),
      }),
    })
    .nullable(),
});

export type TaskResponse = z.infer<typeof taskResponseSchema>;
