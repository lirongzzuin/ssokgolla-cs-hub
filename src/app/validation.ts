import type { Context } from 'hono';
import type { z } from 'zod';
import { ValidationError } from './errors';

/**
 * 요청 본문(JSON)을 zod 스키마로 검증한다. 실패는 ValidationError(400)로 던지고 전역 핸들러가 응답한다.
 * @hono/zod-validator를 쓰지 않는 이유: 의존성 하나를 늘릴 만큼의 기능이 필요 없다.
 */
export async function parseJson<S extends z.ZodType>(c: Context, schema: S): Promise<z.infer<S>> {
  let body: unknown;
  try {
    body = await c.req.json();
  } catch {
    throw new ValidationError('JSON 본문이 필요합니다');
  }
  const result = schema.safeParse(body);
  if (!result.success) {
    throw new ValidationError(
      '요청 형식이 올바르지 않습니다',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}

export function parseQuery<S extends z.ZodType>(c: Context, schema: S): z.infer<S> {
  const result = schema.safeParse(c.req.query());
  if (!result.success) {
    throw new ValidationError(
      '쿼리 형식이 올바르지 않습니다',
      result.error.issues.map((i) => ({ path: i.path.join('.'), message: i.message })),
    );
  }
  return result.data;
}
