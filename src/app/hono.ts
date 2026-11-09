import { Hono } from 'hono';
import type { Container } from './container';
import type { Env } from './env';

/**
 * 모든 라우트가 공유하는 Hono 타입. 컨테이너는 미들웨어(src/index.ts)가 요청마다 c.var.container에 넣는다.
 * 모듈 라우트는 createRouter()로 만들고, 핸들러에서 c.var.container만 꺼내 서비스에 넘긴다.
 */
export type AppEnv = {
  Bindings: Env;
  Variables: { container: Container };
};

export const createRouter = () => new Hono<AppEnv>();
