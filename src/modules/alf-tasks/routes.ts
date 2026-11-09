import { createRouter } from '../../app/hono';
import { parseJson } from '../../app/validation';
import { requireAlfSecret } from './auth';
import {
  addressChangeRequestSchema,
  cancelRequestSchema,
  lookupRequestSchema,
  returnRequestSchema,
  type TaskResponse,
} from './schemas';

/**
 * POST /alf/orders/*  — 채널톡 ALF 태스크(Code 스텝 axios)가 호출한다.
 * 라우트는 검증과 위임만 한다. 서비스는 c.var.container에서 꺼낸다.
 *
 * HTTP 상태 규칙(ALF 분기 설계와 맞춤):
 *   200 — 판단 결과(주문 없음 포함). ALF는 decision/reasonCode로 분기
 *   400/401/5xx — 연동 문제. ALF Code 스텝의 "요청 실패 시" 분기 → 상담원 연결
 */
export const alfTaskRoutes = createRouter();

alfTaskRoutes.use('*', requireAlfSecret);

alfTaskRoutes.post('/orders/lookup', async (c) => {
  const req = await parseJson(c, lookupRequestSchema);
  return c.json<TaskResponse>(await c.var.container.alfTasks.lookup(req));
});

alfTaskRoutes.post('/orders/cancel', async (c) => {
  const req = await parseJson(c, cancelRequestSchema);
  return c.json<TaskResponse>(await c.var.container.alfTasks.cancel(req));
});

alfTaskRoutes.post('/orders/address-change', async (c) => {
  const req = await parseJson(c, addressChangeRequestSchema);
  return c.json<TaskResponse>(await c.var.container.alfTasks.addressChange(req));
});

alfTaskRoutes.post('/orders/return-request', async (c) => {
  const req = await parseJson(c, returnRequestSchema);
  return c.json<TaskResponse>(await c.var.container.alfTasks.returnRequest(req));
});
