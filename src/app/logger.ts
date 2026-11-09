/**
 * 구조화 로그(JSON 한 줄). Workers 로그(observability)에서 필드로 검색할 수 있다.
 *
 * 개인정보 원칙: 고객이 채팅에 쓴 문장이나 외부 API 응답이 그대로 로그에 섞일 수 있으므로
 * "저장하지 않는다"만으로는 부족하다. 로그로 나가는 모든 문자열을 여기서 한 번 더 마스킹한다.
 */

type Level = 'debug' | 'info' | 'warn' | 'error';
type Fields = Record<string, unknown>;

export interface Logger {
  debug(msg: string, fields?: Fields): void;
  info(msg: string, fields?: Fields): void;
  warn(msg: string, fields?: Fields): void;
  error(msg: string, fields?: Fields): void;
  child(fields: Fields): Logger;
}

// 010-0000-5678, 01000005678, 010 0000 5678, +82-10-0000-5678 → 010-****-5678 (예시는 가짜 번호)
const PHONE = /(?:\+82[-\s]?)?0?1[016789][-\s]?\d{3,4}[-\s]?(\d{4})\b/g;
// 키 이름으로 판별하는 필드: 값 전체를 마스킹한다
const NAME_KEYS = /^(name|buyerName|receiverName|ordererName|customerName)$/i;
const ADDRESS_KEYS = /^(address|addr\d?|newAddress|baseAddress|detailedAddress|receiverAddress)$/i;
const PHONE_KEYS = /^(phone|tel\d?|mobile|phoneNumber|mobileNumber|safeNumber)$/i;

export function maskPhone(text: string): string {
  return text.replace(PHONE, (_m, last4: string) => `010-****-${last4}`);
}

/** 홍길동 → 홍*동, 남궁민수 → 남**수, 김수 → 김* */
export function maskName(name: string): string {
  const s = name.trim();
  if (s.length <= 1) return '*';
  if (s.length === 2) return `${s[0]}*`;
  return `${s[0]}${'*'.repeat(s.length - 2)}${s[s.length - 1]}`;
}

/** 시·도와 시·군·구까지만 남긴다. "서울특별시 강남구 테헤란로 1 101호" → "서울특별시 강남구 ***" */
export function maskAddress(address: string): string {
  const parts = address.trim().split(/\s+/);
  return parts.length <= 2 ? '***' : `${parts.slice(0, 2).join(' ')} ***`;
}

function maskValue(key: string, value: unknown, depth: number): unknown {
  if (depth > 5) return '[depth]';
  if (typeof value === 'string') {
    if (NAME_KEYS.test(key)) return maskName(value);
    if (ADDRESS_KEYS.test(key)) return maskAddress(value);
    if (PHONE_KEYS.test(key)) return maskPhone(value);
    return maskPhone(value);
  }
  if (Array.isArray(value)) return value.map((v) => maskValue(key, v, depth + 1));
  if (value && typeof value === 'object') {
    return Object.fromEntries(Object.entries(value).map(([k, v]) => [k, maskValue(k, v, depth + 1)]));
  }
  return value;
}

export function maskFields(fields: Fields): Fields {
  return maskValue('', fields, 0) as Fields;
}

type Sink = (line: string, level: Level) => void;

const consoleSink: Sink = (line, level) => {
  if (level === 'error') console.error(line);
  else if (level === 'warn') console.warn(line);
  else console.log(line);
};

export function createLogger(base: Fields = {}, sink: Sink = consoleSink): Logger {
  const write = (level: Level, msg: string, fields: Fields = {}) => {
    const entry = maskFields({ level, msg: maskPhone(msg), ...base, ...fields, ts: new Date().toISOString() });
    sink(JSON.stringify(entry), level);
  };
  return {
    debug: (m, f) => write('debug', m, f),
    info: (m, f) => write('info', m, f),
    warn: (m, f) => write('warn', m, f),
    error: (m, f) => write('error', m, f),
    child: (f) => createLogger({ ...base, ...f }, sink),
  };
}
