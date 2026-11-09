import type { Context } from 'hono';
import type { ContentfulStatusCode } from 'hono/utils/http-status';
import type { Logger } from './logger';

/**
 * 공통 에러. 서비스·라우트는 이 타입을 던지기만 하고, 응답 변환은 errorHandler 한 곳에서 한다.
 * code는 ALF 태스크가 분기에 쓸 수 있도록 고정 문자열로 둔다.
 */
export class AppError extends Error {
  constructor(
    readonly status: ContentfulStatusCode,
    readonly code: string,
    message: string,
  ) {
    super(message);
    this.name = new.target.name;
  }
}

export class ValidationError extends AppError {
  constructor(
    message: string,
    readonly issues: unknown = undefined,
  ) {
    super(400, 'INVALID_REQUEST', message);
  }
}

export class UnauthorizedError extends AppError {
  constructor(message = '인증에 실패했습니다') {
    super(401, 'UNAUTHORIZED', message);
  }
}

export class NotFoundError extends AppError {
  constructor(message = '찾을 수 없습니다') {
    super(404, 'NOT_FOUND', message);
  }
}

export class ConfigError extends AppError {
  constructor(message: string) {
    super(500, 'CONFIG_ERROR', message);
  }
}

/** 외부 API·엔진 호출 실패. 재시도 판단은 호출한 쪽(cron)이 한다. */
export class UpstreamError extends AppError {
  constructor(message: string) {
    super(502, 'UPSTREAM_ERROR', message);
  }
}

/**
 * 에러 응답 형식. ALF 태스크 응답과 키를 맞춰 두어,
 * Code 스텝이 실패 분기에서도 같은 키(reasonCode, customerMessage)를 읽을 수 있게 한다.
 */
const FALLBACK_CUSTOMER_MESSAGE = '확인 중 문제가 생겼어요. 담당자가 확인 후 안내드리겠습니다.';

export function createErrorHandler(getLogger: (c: Context) => Logger) {
  return (err: Error, c: Context) => {
    const log = getLogger(c);
    if (err instanceof AppError) {
      if (err.status >= 500) log.error('app_error', { code: err.code, message: err.message });
      else log.warn('client_error', { code: err.code, message: err.message, path: c.req.path });
      const issues = err instanceof ValidationError ? err.issues : undefined;
      return c.json(
        { ok: false, reasonCode: err.code, message: err.message, customerMessage: FALLBACK_CUSTOMER_MESSAGE, issues },
        err.status,
      );
    }
    log.error('unhandled_error', { message: err.message, stack: err.stack });
    return c.json(
      { ok: false, reasonCode: 'INTERNAL_ERROR', message: '서버 오류', customerMessage: FALLBACK_CUSTOMER_MESSAGE },
      500,
    );
  };
}
