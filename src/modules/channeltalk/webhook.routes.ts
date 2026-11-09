import { createRouter } from '../../app/hono';
import { requireSecret } from '../../app/security';
import { describeShape, parseWebhook } from './webhook.parser';

/**
 * POST /webhooks/channeltalk?token=...
 *
 * 채널톡은 웹훅을 `POST <URL>?token=<토큰>`으로 보내고, 서명 헤더는 문서에 없다. → token을 상수 시간 비교.
 * 4XX·5XX는 실패로 집계되고 100번 연속 실패하면 웹훅이 차단된다.
 * → 토큰이 틀린 경우만 401, 처리할 수 없는 이벤트는 200으로 받고 무시한다.
 * 출처: https://developers.channel.io/en/articles/Getting-started-f2a30b58 (확인 2026-11-09)
 */
export const channelTalkWebhookRoutes = createRouter();

channelTalkWebhookRoutes.use(
  '*',
  requireSecret(
    'CHANNELTALK_WEBHOOK_TOKEN',
    (c) => c.req.query('token'),
    (env) => env.CHANNELTALK_WEBHOOK_TOKEN,
  ),
);

channelTalkWebhookRoutes.post('/channeltalk', async (c) => {
  const { inquiries, log, now, config } = c.var.container;
  const body = await c.req.json().catch(() => null);
  const parsed = parseWebhook(body, now());

  // 필드 이름이 문서로 확인되지 않아(TODO(verify-api)) 실제 페이로드의 구조를 볼 수 있게 남긴다. 값은 남기지 않는다.
  if (config.webhookDebug) log.info('channeltalk_webhook_shape', { shape: JSON.stringify(describeShape(body)) });

  if ('ignored' in parsed) {
    const missingFields = parsed.ignored.endsWith('_fields_missing');
    // 필드가 없어서 버린 이벤트는 파서 수정이 필요하다는 신호라 구조를 경고로 남긴다
    if (missingFields)
      log.warn('channeltalk_webhook_unparsed', { reason: parsed.ignored, shape: JSON.stringify(describeShape(body)) });
    else log.debug('channeltalk_webhook_ignored', { reason: parsed.ignored });
    return c.json({ ok: true, ignored: parsed.ignored });
  }
  await inquiries.handleChatEvent(parsed.event);
  return c.json({ ok: true });
});
