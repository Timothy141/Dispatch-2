PRAGMA journal_mode = WAL;
PRAGMA foreign_keys = ON;

CREATE TABLE IF NOT EXISTS sites (
  id            TEXT PRIMARY KEY,
  name          TEXT NOT NULL,
  address       TEXT,
  latitude      REAL,
  longitude     REAL,
  external_ref  TEXT,
  default_responder_id TEXT REFERENCES responders(id) ON DELETE SET NULL,
  notes         TEXT,
  created_at    TEXT NOT NULL,
  updated_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS sites_external_ref ON sites(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS cameras (
  id            TEXT PRIMARY KEY,
  site_id       TEXT NOT NULL REFERENCES sites(id) ON DELETE CASCADE,
  name          TEXT NOT NULL,
  external_ref  TEXT,
  created_at    TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS cameras_external_ref ON cameras(external_ref) WHERE external_ref IS NOT NULL;

CREATE TABLE IF NOT EXISTS responders (
  id             TEXT PRIMARY KEY,
  name           TEXT NOT NULL,
  type           TEXT NOT NULL,
  channel        TEXT NOT NULL,
  channel_config TEXT NOT NULL DEFAULT '{}',
  phone          TEXT,
  email          TEXT,
  active         INTEGER NOT NULL DEFAULT 1,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL
);

CREATE TABLE IF NOT EXISTS alerts (
  id            TEXT PRIMARY KEY,
  source        TEXT NOT NULL,
  external_id   TEXT,
  site_id       TEXT REFERENCES sites(id) ON DELETE SET NULL,
  camera_id     TEXT REFERENCES cameras(id) ON DELETE SET NULL,
  event_type    TEXT NOT NULL,
  confidence    REAL,
  severity      TEXT NOT NULL DEFAULT 'medium',
  title         TEXT NOT NULL,
  description   TEXT,
  snapshot_url  TEXT,
  clip_url      TEXT,
  occurred_at   TEXT NOT NULL,
  received_at   TEXT NOT NULL,
  status        TEXT NOT NULL DEFAULT 'new',
  handled_by    TEXT,
  handled_at    TEXT,
  raw_payload   TEXT NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS alerts_source_external ON alerts(source, external_id) WHERE external_id IS NOT NULL;
CREATE INDEX IF NOT EXISTS alerts_status_received ON alerts(status, received_at DESC);

CREATE TABLE IF NOT EXISTS dispatches (
  id             TEXT PRIMARY KEY,
  reference      TEXT NOT NULL UNIQUE,
  alert_id       TEXT REFERENCES alerts(id) ON DELETE SET NULL,
  site_id        TEXT REFERENCES sites(id) ON DELETE SET NULL,
  responder_id   TEXT NOT NULL REFERENCES responders(id),
  priority       TEXT NOT NULL,
  reason         TEXT NOT NULL,
  notes          TEXT,
  requested_by   TEXT NOT NULL,
  status         TEXT NOT NULL DEFAULT 'requested',
  callback_token TEXT NOT NULL,
  created_at     TEXT NOT NULL,
  updated_at     TEXT NOT NULL,
  closed_at      TEXT
);
CREATE INDEX IF NOT EXISTS dispatches_status ON dispatches(status, created_at DESC);

CREATE TABLE IF NOT EXISTS dispatch_events (
  id           TEXT PRIMARY KEY,
  dispatch_id  TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  from_status  TEXT,
  to_status    TEXT NOT NULL,
  actor        TEXT NOT NULL,
  note         TEXT,
  created_at   TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS dispatch_events_dispatch ON dispatch_events(dispatch_id, created_at);

CREATE TABLE IF NOT EXISTS dispatch_deliveries (
  id           TEXT PRIMARY KEY,
  dispatch_id  TEXT NOT NULL REFERENCES dispatches(id) ON DELETE CASCADE,
  channel      TEXT NOT NULL,
  attempt      INTEGER NOT NULL,
  success      INTEGER NOT NULL,
  detail       TEXT,
  created_at   TEXT NOT NULL
);

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
