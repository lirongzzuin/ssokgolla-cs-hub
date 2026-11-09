-- 쏙골라마켓 CS 허브 초기 스키마
-- 원칙: 전화번호 전체·실명·주소 원문은 저장하지 않는다(phone_last4, 마스킹 이름만).
-- 시각은 모두 ISO-8601 UTC 문자열(TEXT)로 저장한다. D1(SQLite)에 날짜 타입이 없기 때문이다.

-- 판매채널 주문(고객이 스마트스토어·쿠팡에서 한 주문). 1행 = 주문번호 1개(여러 상품 주문은 대표 상품 기준으로 단순화).
CREATE TABLE sales_orders (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  channel           TEXT    NOT NULL CHECK (channel IN ('smartstore', 'coupang')),
  channel_order_id  TEXT    NOT NULL,
  product_name      TEXT    NOT NULL,
  option_name       TEXT,
  qty               INTEGER NOT NULL CHECK (qty > 0),
  buyer_name_masked TEXT    NOT NULL,
  phone_last4       TEXT    NOT NULL CHECK (length(phone_last4) = 4),
  status            TEXT    NOT NULL CHECK (status IN (
                      'PAID', 'SUPPLIER_ORDERED', 'SHIPPED', 'IN_TRANSIT', 'DELIVERED',
                      'CANCEL_REQUESTED', 'CANCELLED', 'RETURN_REQUESTED', 'RETURNED')),
  -- 원천(엔진)이 '사람 확인 필요'로 표시한 주문. 정책이 모든 액션을 ESCALATE 한다.
  needs_review      INTEGER NOT NULL DEFAULT 0 CHECK (needs_review IN (0, 1)),
  ordered_at        TEXT    NOT NULL,
  -- 반품 가능 기간 계산 기준
  delivered_at      TEXT,
  updated_at        TEXT    NOT NULL,
  UNIQUE (channel, channel_order_id)
);
CREATE INDEX idx_sales_orders_lookup ON sales_orders (channel_order_id, phone_last4);

-- 공급처 주문(판매자가 공급처에 대신 넣은 발주). 고객에게 절대 노출하지 않는 내부 정보다.
CREATE TABLE supplier_orders (
  id                 INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_order_id     INTEGER NOT NULL REFERENCES sales_orders (id),
  supplier_code      TEXT    NOT NULL,
  supplier_order_ref TEXT    NOT NULL,
  status             TEXT    NOT NULL CHECK (status IN ('ORDERED', 'SHIPPED', 'CANCELLED')),
  ordered_at         TEXT    NOT NULL,
  UNIQUE (supplier_code, supplier_order_ref)
);
CREATE INDEX idx_supplier_orders_sales ON supplier_orders (sales_order_id);

-- 송장(공급처가 출고하며 발행)
CREATE TABLE shipments (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  sales_order_id INTEGER NOT NULL REFERENCES sales_orders (id),
  carrier        TEXT    NOT NULL,
  tracking_no    TEXT    NOT NULL,
  status         TEXT    NOT NULL CHECK (status IN ('SHIPPED', 'IN_TRANSIT', 'DELIVERED')),
  updated_at     TEXT    NOT NULL,
  UNIQUE (carrier, tracking_no)
);
CREATE INDEX idx_shipments_sales ON shipments (sales_order_id);

-- 상담 1건 = 채널톡 userChat 1개 또는 쿠팡·스마트스토어 문의 1개
CREATE TABLE inquiries (
  id                INTEGER PRIMARY KEY AUTOINCREMENT,
  source            TEXT    NOT NULL CHECK (source IN ('channeltalk', 'coupang', 'smartstore')),
  external_id       TEXT    NOT NULL,
  sales_order_id    INTEGER REFERENCES sales_orders (id),
  category          TEXT    NOT NULL DEFAULT 'UNKNOWN',
  handled_by        TEXT    NOT NULL DEFAULT 'alf' CHECK (handled_by IN ('alf', 'agent')),
  escalated         INTEGER NOT NULL DEFAULT 0 CHECK (escalated IN (0, 1)),
  escalation_reason TEXT,
  created_at        TEXT    NOT NULL,
  UNIQUE (source, external_id)
);
CREATE INDEX idx_inquiries_created ON inquiries (created_at);

-- ALF 태스크 호출 기록. chat_id로 상담(inquiries)과 연결한다.
CREATE TABLE task_logs (
  id             INTEGER PRIMARY KEY AUTOINCREMENT,
  task_name      TEXT    NOT NULL,
  sales_order_id INTEGER REFERENCES sales_orders (id),
  chat_id        TEXT,
  decision       TEXT    NOT NULL CHECK (decision IN ('ALLOW', 'ESCALATE', 'DENY', 'INFO')),
  reason_code    TEXT    NOT NULL,
  latency_ms     INTEGER NOT NULL,
  created_at     TEXT    NOT NULL
);
CREATE INDEX idx_task_logs_created ON task_logs (created_at);
CREATE INDEX idx_task_logs_chat ON task_logs (chat_id);

-- 증분 동기화 커서(마지막으로 가져온 시각)
CREATE TABLE sync_state (
  name       TEXT PRIMARY KEY,
  cursor     TEXT NOT NULL,
  updated_at TEXT NOT NULL
);
