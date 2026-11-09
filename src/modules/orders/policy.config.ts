import type { Channel } from './types';

/**
 * 정책 수치. 운영 중 바뀔 수 있는 값은 policy.ts가 아니라 여기서 고친다.
 */
export interface PolicyConfig {
  /**
   * 단순 변심 반품 가능 기간(배송완료일 기준, 일).
   * 근거: 전자상거래법 제17조 청약철회 7일. 판매채널 정책이 더 길면 채널별로 늘린다.
   */
  returnWindowDays: Record<Channel, number>;
}

export const defaultPolicyConfig: PolicyConfig = {
  returnWindowDays: { smartstore: 7, coupang: 7 },
};
