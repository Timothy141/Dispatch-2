# Dispatch

A control-room dispatch application for CCTV monitoring. Verified alerts from
**DeepAlert** (and any other analytics/VMS platform) land in a live operator
queue. The operator reviews the snapshot and, if the activity is suspicious,
presses **DISPATCH**. The right responder for that site is notified
immediately, and the dispatch is tracked from *requested* through *on scene*
to *resolved*, with a full audit trail of who did what and when.

```
DeepAlert ──webhook──▶ Dispatch server ──SSE──▶ Operator console
                            │                        │
                            │◀──── DISPATCH button ───┘
                            │
                            ├──signed webhook──▶ Armed response / guards / SAPS
                            └◀── callback URL ─── responder reports en route / on scene / resolved
```

## Features

- **Inbound alerts** from DeepAlert via webhook, plus a documented generic JSON
  format for other systems. Sites and cameras are created automatically the
  first time they are seen, so no alert is ever dropped.
- **Operator console**: live alert queue (SSE, no polling), snapshot + clip
  viewer, site notes, one-click dispatch with responder / priority / notes,
  acknowledge and dismiss, active dispatch board with a status stepper,
  dispatch drawer with timeline and delivery log, manual dispatch for
  activity spotted on a live feed.
- **Responder notification** over pluggable channels: HMAC-signed webhook
  (with retries) or a log channel for responders reached by radio/phone.
  Every attempt is recorded.
- **Dispatch lifecycle** enforced by a state machine:
  `requested → acknowledged → en_route → on_scene → resolved`, `cancelled`
  from any open state. Cancelling reopens the alert so it is not lost.
- **Responder callback URL** with a per-dispatch token so response companies
  can report progress without an operator login.
- **Audit log** of every alert receipt, acknowledgement, dispatch and status
  change, attributed to the operator or responder.
- API-key auth for operators, per-source shared secrets for webhooks.
- Single process, SQLite storage (Node's built-in `node:sqlite`, no native
  build step), Docker image.

## Quick start

Requires Node 22.13+.

```bash
npm install
cp .env.example .env            # edit the secrets
npm run build                   # builds the console and the server
npm run seed                    # demo sites, cameras and responders
npm start                       # http://localhost:8080
```

Open http://localhost:8080, enter your operator name and the
`OPERATOR_API_KEY` from `.env`. In another terminal, generate test alerts:

```bash
WEBHOOK_SECRET_DEEPALERT=<secret> npm run simulate -- 5 2000   # 5 alerts, 2s apart
```

For development with hot reload run `npm run dev` (server on 8080, Vite on
5173 proxying `/api`).

### Docker

```bash
docker compose up --build
```

Set secrets through the environment (see `docker-compose.yml`). Data lives in
the `dispatch-data` volume.

## Connecting DeepAlert

1. In the DeepAlert management interface, configure a delivery endpoint /
   webhook for the sites you monitor:

   ```
   URL:     https://<your-host>/api/webhooks/deepalert
   Method:  POST, JSON body
   Header:  x-webhook-secret: <WEBHOOK_SECRET_DEEPALERT>
            (Authorization: Bearer <secret> or ?token=<secret> also accepted)
   ```

2. Send a test alert. The server answers `202` with the created alert ids.

3. Check the alert appears in the console with the right site and camera. The
   adapter reads each field from a list of candidate keys
   (`server/src/integrations/inbound/deepalert.ts`, `DEEPALERT_FIELD_MAP`):

   | Field        | Candidate keys (first non-empty wins)                                   |
   |--------------|--------------------------------------------------------------------------|
   | externalId   | `alert_id`, `alertId`, `event_id`, `eventId`, `id`, `uuid`               |
   | site ref     | `site_id`, `siteId`, `site.id`, `location_id`, `client_site_id`          |
   | site name    | `site_name`, `siteName`, `site.name`, `location`, `location_name`        |
   | camera ref   | `camera_id`, `cameraId`, `camera.id`, `channel_id`, `device_id`          |
   | camera name  | `camera_name`, `cameraName`, `camera.name`, `camera`, `channel_name`     |
   | event type   | `event_type`, `eventType`, `detection_type`, `type`, `rule`, `label`, …  |
   | confidence   | `confidence`, `probability`, `score` (0–1, 0–100 or `"95%"` all accepted)|
   | snapshot     | `snapshot_url`, `image_url`, `imageUrl`, `image`, `thumbnail_url`, …     |
   | clip         | `clip_url`, `video_url`, `videoUrl`, `playback_url`, …                   |
   | occurred at  | `timestamp`, `event_time`, `occurred_at`, `detected_at`, `time`          |

   If your DeepAlert profile uses different key names, add them to the map.
   Batched deliveries (`{ alerts: [...] }`, `{ events: [...] }` or a bare
   array) are supported. Alerts are idempotent on `(source, externalId)`.

4. Optionally set `MIN_CONFIDENCE` (e.g. `0.6`) to auto-dismiss low-confidence
   detections. They are still stored and visible under the *dismissed* tab.

Severity is derived from the event type (weapon/panic/fire → critical,
intrusion/breach/tailgating → high, person/vehicle/loitering → medium, high
confidence promotes medium → high) and pre-selects the dispatch priority.

### Other sources

`POST /api/webhooks/generic` accepts:

```json
{
  "id": "evt-123",
  "site": { "ref": "SITE-1", "name": "Riverside Depot" },
  "camera": { "ref": "CAM-4", "name": "Main Gate" },
  "eventType": "person",
  "confidence": 0.93,
  "severity": "high",
  "snapshotUrl": "https://…/snap.jpg",
  "clipUrl": "https://…/clip.mp4",
  "occurredAt": "2026-09-09T10:00:00Z"
}
```

Adding a new source is one file implementing `InboundAdapter` and one line in
`server/src/integrations/inbound/registry.ts`.

## Notifying responders

Each responder has a `channel`:

- **`webhook`** — `channelConfig: { "url": "https://…", "headers": { … } }`.
  The server POSTs the payload below, signed with
  `x-dispatch-signature: sha256=<HMAC-SHA256(body, DISPATCH_SIGNING_SECRET)>`,
  retrying up to 3 times.
- **`log`** — records the dispatch only; the operator phones/radios the
  responder. Use this for response companies without an API.

Adding SMS, email or push is one file implementing `OutboundChannel` in
`server/src/integrations/outbound/`.

Webhook payload:

```json
{
  "type": "dispatch.requested",
  "dispatch": {
    "id": "…", "reference": "DSP-7KQ2M", "priority": "critical",
    "reason": "Perimeter Breach 91% · Yard West Fence",
    "notes": "Two males with bolt cutters at west fence",
    "requestedBy": "T. Naidoo (Shift B)", "requestedAt": "2026-09-09T10:00:05Z",
    "callbackUrl": "https://<host>/api/dispatches/callback/DSP-7KQ2M?token=…"
  },
  "site": { "id": "…", "name": "Riverside Logistics Depot", "address": "…", "latitude": -33.9, "longitude": 18.4, "notes": "Gate code 4471" },
  "alert": { "id": "…", "source": "deepalert", "eventType": "perimeter_breach", "confidence": 0.91, "severity": "high", "camera": "Yard West Fence", "snapshotUrl": "…", "clipUrl": "…", "occurredAt": "…" }
}
```

The responder reports progress by POSTing to `callbackUrl`:

```json
{ "status": "en_route", "actor": "Vehicle 12", "note": "ETA 6 min" }
```

The reference (`DSP-XXXXX`) avoids 0/O/1/I so it can be read over the radio.

## API

All operator endpoints require `x-api-key: <OPERATOR_API_KEY>`; the optional
`x-operator: <name>` header attributes actions to a person.

| Method | Path | Purpose |
|--------|------|---------|
| GET | `/api/health` | liveness, registered sources and channels |
| POST | `/api/webhooks/:source` | inbound alerts (`deepalert`, `generic`) |
| GET | `/api/alerts?status=new,acknowledged&siteId=&limit=` | list alerts |
| GET | `/api/alerts/:id` · `/api/alerts/:id/raw` | alert with dispatches · original payload |
| POST | `/api/alerts/:id/acknowledge` · `/dismiss` | operator triage |
| POST | `/api/alerts/:id/dispatch` | **the dispatch button** `{ responderId?, priority, notes? }` |
| GET/POST | `/api/dispatches` | list · manual dispatch `{ siteId, responderId?, priority, reason }` |
| GET | `/api/dispatches/:id` | dispatch with alert, site, responder, timeline, deliveries |
| POST | `/api/dispatches/:id/status` | `{ status, note? }` |
| POST | `/api/dispatches/:id/redeliver` | retry responder notification |
| POST | `/api/dispatches/callback/:reference?token=` | responder status update (token auth) |
| GET/POST/PATCH | `/api/responders`, `/api/sites` | configuration |
| GET | `/api/stats` · `/api/audit` | dashboard counters · audit trail |
| GET | `/api/events` | Server-Sent Events stream (`?apiKey=` for browsers) |

If `responderId` is omitted the site's `defaultResponderId` is used.

## Project layout

```
server/src
  app.ts                    Fastify wiring, error mapping, static console
  config.ts                 environment → typed config
  db/schema.sql, db.ts      SQLite schema and connection
  domain/                   types, dispatch state machine, ids
  integrations/inbound/     DeepAlert + generic adapters
  integrations/outbound/    webhook + log channels
  services/                 repositories, AlertService, DispatchService, EventBus
  routes/                   webhooks, alerts, dispatches, admin, events (SSE)
server/test                 vitest: adapters, state machine, end-to-end API
server/scripts              seed.ts, simulate.ts
web/src                     React operator console
```

```bash
npm test          # server tests
npm run typecheck # both packages
```

## Configuration

See `.env.example`. Leaving `OPERATOR_API_KEY` or a webhook secret empty
disables that check, which is only appropriate for local development.

## Roadmap / not yet included

- Operator accounts and roles (currently a shared API key + free-text name).
- SMS / email / push channels (interface is in place).
- Map view and nearest-responder selection using site coordinates.
- Reporting (response times per responder and site).

## License

Apache-2.0
