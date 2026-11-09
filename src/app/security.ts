import type { MiddlewareHandler } from 'hono';
import { ConfigError, UnauthorizedError } from './errors';
import type { AppEnv } from './hono';

/**
 * 시크릿 비교. 문자열 ===는 앞에서부터 다른 글자를 만나면 바로 끝나서, 응답 시간으로 값을 추측할 수 있다.
 * 길이가 달라도 시간이 같도록 SHA-256으로 길이를 맞춘 뒤 Workers의 timingSafeEqual로 비교한다.
 */
export async function safeEqual(given: string, expected: string): Promise<boolean> {
  const enc = new TextEncoder();
  const [a, b] = await Promise.all([
    crypto.subtle.digest('SHA-256', enc.encode(given)),
    crypto.subtle.digest('SHA-256', enc.encode(expected)),
  ]);
  return crypto.subtle.timingSafeEqual(a, b);
}

/**
 * 시크릿 검증 미들웨어. 시크릿이 설정되지 않았으면 열지 않는다(fail closed).
 * @param read 요청에서 비교할 값을 꺼내는 함수(헤더 또는 쿼리)
 * @param secretOf env에서 기대값을 꺼내는 함수
 */
export function requireSecret(
  name: string,
  read: (c: Parameters<MiddlewareHandler<AppEnv>>[0]) => string | undefined,
  secretOf: (env: AppEnv['Bindings']) => string | undefined,
): MiddlewareHandler<AppEnv> {
  return async (c, next) => {
    const expected = secretOf(c.env);
    if (!expected) throw new ConfigError(`${name} 시크릿이 설정되지 않았습니다`);
    const given = read(c);
    if (!given || !(await safeEqual(given, expected))) throw new UnauthorizedError();
    await next();
  };
}
