import { createContainer } from './app/container';
import type { Env } from './app/env';
import { createErrorHandler } from './app/errors';
import { createRouter } from './app/hono';
import { createLogger } from './app/logger';

/**
 * 앱 조립. 라우트 마운트와 scheduled 연결만 두고 로직은 넣지 않는다.
 * 새 기능: src/modules/<name>/index.ts 에서 라우터를 export → 아래에 app.route() 한 줄 추가.
 */
const app = createRouter();

app.use('*', async (c, next) => {
  c.set('container', createContainer(c.env));
  await next();
});
// 컨테이너 생성 자체가 실패한 경우(잘못된 env)에도 로그는 남긴다
app.onError(createErrorHandler((c) => c.var.container?.log ?? createLogger({ service: 'cs-hub' })));
app.notFound((c) => c.json({ ok: false, reasonCode: 'NOT_FOUND', message: '없는 경로입니다' }, 404));

app.get('/health', (c) => c.json({ ok: true, dataSource: c.var.container.config.dataSource }));

export default {
  fetch: app.fetch,
} satisfies ExportedHandler<Env>;

export { app };
