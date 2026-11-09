import { z } from 'zod';

/**
 * Worker 바인딩·변수·시크릿.
 * 값의 출처: wrangler.jsonc(vars, d1) + `wrangler secret put` + 로컬 `.dev.vars`.
 * 문자열 플래그는 그대로 쓰지 않고 readConfig()로 한 번만 해석한다.
 */
export interface Env {
  DB: D1Database;
  DATA_SOURCE?: string;
  ENABLE_COUPANG_BRIDGE?: string;
  ALF_SECRET?: string;
  ADMIN_SECRET?: string;
  CHANNELTALK_WEBHOOK_TOKEN?: string;
  ENGINE_BASE_URL?: string;
  ENGINE_TOKEN?: string;
  /** true면 채널톡 웹훅 본문의 키 구조(값 제외)를 로그로 남긴다. 실제 필드 이름 확인용 */
  WEBHOOK_DEBUG?: string;
}

const configSchema = z.object({
  dataSource: z.enum(['mock', 'live']).default('mock'),
  coupangBridgeEnabled: z.boolean().default(false),
  engineBaseUrl: z.string().optional(),
  engineToken: z.string().optional(),
  webhookDebug: z.boolean().default(false),
});

export type AppConfig = z.infer<typeof configSchema>;

const emptyToUndefined = (v: string | undefined) => (v ? v : undefined);

/** 잘못된 값(예: DATA_SOURCE=prod)은 기동 시점에 바로 실패시킨다. 조용히 mock으로 떨어지면 운영 사고가 된다. */
export function readConfig(env: Env): AppConfig {
  return configSchema.parse({
    dataSource: emptyToUndefined(env.DATA_SOURCE),
    coupangBridgeEnabled: env.ENABLE_COUPANG_BRIDGE === 'true',
    engineBaseUrl: emptyToUndefined(env.ENGINE_BASE_URL),
    engineToken: emptyToUndefined(env.ENGINE_TOKEN),
    webhookDebug: env.WEBHOOK_DEBUG === 'true',
  });
}
