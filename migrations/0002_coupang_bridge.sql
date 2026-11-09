-- 쿠팡 문의 브릿지: 쿠팡 문의 1건 ↔ 브릿지가 만든 채널톡 상담 1건
-- 쿠팡 고객은 채널톡을 보지 못하므로, ALF가 상담에 남긴 답변을 이 연결로 찾아 쿠팡에 다시 등록한다.
CREATE TABLE coupang_bridge_links (
  inquiry_id   TEXT PRIMARY KEY,
  inquiry_kind TEXT NOT NULL CHECK (inquiry_kind IN ('product', 'callcenter')),
  chat_id      TEXT NOT NULL UNIQUE,
  created_at   TEXT NOT NULL,
  answered_at  TEXT
);
