import { requireSecret } from '../../app/security';

/**
 * ALF 태스크 인증: X-ALF-Secret 헤더.
 *
 * 채널톡 Code 스텝에는 시크릿 저장 기능이 문서에 없어(docs/architecture.md §6.1) 값을 코드에 직접 넣는다.
 * 그래서 이 시크릿은 /alf/*만 열고, 리포트(ADMIN_SECRET)·웹훅(CHANNELTALK_WEBHOOK_TOKEN)과 나눠 두어
 * 새더라도 피해가 주문 조회·요청 기록으로 한정되게 한다. 교체는 `wrangler secret put ALF_SECRET` 후 태스크 코드 수정.
 */
export const ALF_SECRET_HEADER = 'X-ALF-Secret';

export const requireAlfSecret = requireSecret(
  'ALF_SECRET',
  (c) => c.req.header(ALF_SECRET_HEADER),
  (env) => env.ALF_SECRET,
);
