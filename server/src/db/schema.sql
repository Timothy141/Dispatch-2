PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS users (
  id          TEXT PRIMARY KEY,
  role        TEXT NOT NULL,             -- requester | responder | dispatcher
  name        TEXT NOT NULL,
  phone       TEXT NOT NULL,
  token_hash  TEXT NOT NULL UNIQUE,
  created_at  TEXT NOT NULL,
  last_seen_at TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS users_phone_role ON users(phone, role);

CREATE TABLE IF NOT EXISTS responders (
  user_id       TEXT PRIMARY KEY REFERENCES users(id) ON DELETE CASCADE,
  service       TEXT NOT NULL,           -- security | medical | fire
  unit_name     TEXT NOT NULL,
  organisation  TEXT,
  vehicle       TEXT,
  capabilities  TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'offline',  -- offline | available | busy
  lat           REAL,
  lng           REAL,
  heading       REAL,
  location_at   TEXT,
  rating_sum    REAL NOT NULL DEFAULT 0,
  rating_count  INTEGER NOT NULL DEFAULT 0,
  jobs_completed INTEGER NOT NULL DEFAULT 0,
  updated_at    TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS responders_service_status ON responders(service, status);

CREATE TABLE IF NOT EXISTS requests (
  id            TEXT PRIMARY KEY,
  reference     TEXT NOT NULL UNIQUE,
  requester_id  TEXT NOT NULL REFERENCES users(id),
  service       TEXT NOT NULL,
  priority      TEXT NOT NULL,
  lat           REAL NOT NULL,
  lng           REAL NOT NULL,
  address       TEXT,
  description   TEXT,
  flags         TEXT NOT NULL DEFAULT '[]',
  status        TEXT NOT NULL DEFAULT 'searching',
  responder_id  TEXT REFERENCES responders(user_id),
  eta_seconds   INTEGER,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL,
  assigned_at   TEXT,
  en_route_at   TEXT,
  arrived_at    TEXT,
  completed_at  TEXT,
  cancelled_at  TEXT,
  cancel_reason TEXT,
  rating        INTEGER,
  rating_comment TEXT,
  search_started_at TEXT NOT NULL,
  source        TEXT NOT NULL DEFAULT 'app',   -- app | agent | api
  created_by    TEXT                           -- agent user id or api key id when not self-service
);
CREATE INDEX IF NOT EXISTS requests_status ON requests(status, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_requester ON requests(requester_id, created_at DESC);
CREATE INDEX IF NOT EXISTS requests_responder ON requests(responder_id, status);

CREATE TABLE IF NOT EXISTS offers (
  id            TEXT PRIMARY KEY,
  request_id    TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  responder_id  TEXT NOT NULL REFERENCES responders(user_id),
  status        TEXT NOT NULL DEFAULT 'pending',  -- pending | accepted | declined | expired | withdrawn
  distance_m    INTEGER NOT NULL,
  eta_seconds   INTEGER NOT NULL,
  offered_at    TEXT NOT NULL,
  expires_at    TEXT NOT NULL,
  responded_at  TEXT
);
CREATE INDEX IF NOT EXISTS offers_request ON offers(request_id, status);
CREATE INDEX IF NOT EXISTS offers_responder ON offers(responder_id, status);

CREATE TABLE IF NOT EXISTS request_events (
  id          TEXT PRIMARY KEY,
  request_id  TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  type        TEXT NOT NULL,
  actor       TEXT NOT NULL,
  note        TEXT,
  created_at  TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS request_events_request ON request_events(request_id, created_at);

CREATE TABLE IF NOT EXISTS location_history (
  id           TEXT PRIMARY KEY,
  request_id   TEXT NOT NULL REFERENCES requests(id) ON DELETE CASCADE,
  responder_id TEXT NOT NULL,
  lat          REAL NOT NULL,
  lng          REAL NOT NULL,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS location_history_request ON location_history(request_id, created_at);

CREATE TABLE IF NOT EXISTS audit_log (
  id           TEXT PRIMARY KEY,
  actor        TEXT NOT NULL,
  action       TEXT NOT NULL,
  entity_type  TEXT NOT NULL,
  entity_id    TEXT,
  details      TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS audit_log_created ON audit_log(created_at DESC);

-- ---- integrations ---------------------------------------------------------
CREATE TABLE IF NOT EXISTS api_keys (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  prefix       TEXT NOT NULL,             -- first 8 chars, shown in the UI
  key_hash     TEXT NOT NULL UNIQUE,
  scopes       TEXT NOT NULL DEFAULT '["requests:write","requests:read"]',
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL,
  last_used_at TEXT,
  revoked_at   TEXT
);

CREATE TABLE IF NOT EXISTS webhooks (
  id           TEXT PRIMARY KEY,
  name         TEXT NOT NULL,
  url          TEXT NOT NULL,
  secret       TEXT NOT NULL,
  events       TEXT NOT NULL DEFAULT '["*"]',
  active       INTEGER NOT NULL DEFAULT 1,
  created_by   TEXT NOT NULL,
  created_at   TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS webhook_deliveries (
  id           TEXT PRIMARY KEY,
  webhook_id   TEXT NOT NULL REFERENCES webhooks(id) ON DELETE CASCADE,
  event_type   TEXT NOT NULL,
  attempt      INTEGER NOT NULL,
  success      INTEGER NOT NULL,
  status_code  INTEGER,
  error        TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS webhook_deliveries_hook ON webhook_deliveries(webhook_id, created_at DESC);
