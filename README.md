# Dispatch

On-demand emergency response, the way ride-hailing works. A person who needs
help taps **Security**, **Medical** or **Fire**. The nearest available units
are offered the job; the first to accept is assigned, and the requester
watches them approach on a live map with an ETA until they arrive. A control
room sees every unit and incident and can step in when nobody accepts.

```
 Requester app            Dispatch server                 Responder app
 ─────────────            ───────────────                 ─────────────
 tap MEDICAL  ─────────▶  create request
                          find nearest available
                          medical units in range ──────▶  offer (20 s countdown)
                                                  ◀──────  accept
 "MED-Echo 5, 4 min" ◀──  assign, withdraw other offers
 live map + ETA      ◀──  location stream         ◀──────  GPS updates
 "Arrived"           ◀──  status                  ◀──────  en route / arrived / complete
 rate ★★★★★          ──▶  rating on unit

 Control room: live map of all units and incidents, manual assign, retry, cancel.
```

## Features

- **One-tap request** with quick situation flags (e.g. *Unconscious*, *Suspects
  armed*, *People trapped*) that set the priority automatically. GPS location,
  or tap the map to place the pin.
- **Uber-style matching**: nearest available units of the right service within
  a radius are offered the job, N at a time, with a countdown. Declines and
  timeouts move to the next unit. First acceptance wins; other offers are
  withdrawn. A unit that comes online or moves into range is picked up
  immediately. If nobody accepts within the search timeout the request is
  flagged *unfulfilled* for the control room.
- **Live tracking** for the requester: unit name, vehicle, organisation,
  rating, call button, moving marker, trail, distance and ETA. All updates
  arrive over Server-Sent Events.
- **Responder app**: online/offline toggle, GPS sharing (or manual pin for
  desktop demos), incoming offers with distance/ETA/countdown, accept or
  decline, navigate link, En route → Arrived → Complete, release a job back
  to the pool.
- **Control room**: live map of every online unit (dimmed when busy) and open
  incident, request list with status steppers, request detail with offer
  history and timeline, manual assignment to any free unit, retry search,
  cancel. Header shows waiting/active counts and average accept/arrival times.
- **Privacy by role**: requesters only see their own requests; responders only
  see jobs offered to or held by them; the event stream is filtered per user.
- **Audit trail** of every request, offer, acceptance, status change and
  rating.
- Single Node process, SQLite (built-in `node:sqlite`, no native build),
  Docker image, GitHub Actions CI.

## Quick start

Requires Node 22.13+.

```bash
npm install
cp .env.example .env          # set DISPATCHER_CODE at least
npm run build
npm start                     # http://localhost:8080
```

Then, in a second terminal, put a simulated fleet online (7 units around
Cape Town that accept jobs and drive to the scene):

```bash
npm run simulate
# other city:  CENTER_LAT=-26.2041 CENTER_LNG=28.0473 npm run simulate
```

Open http://localhost:8080 on your phone or desktop:

1. **I need help** → enter name and number → tap a service → *Request*.
2. Watch a simulated unit accept, drive in and arrive; rate them.
3. Open another tab as **Control room** (code from `.env`) to see the map.
4. Open a third tab as **I'm a responder** to play a real unit: set up your
   call sign, go online (allow location or tap the map), accept an offer.

`npm run dev` runs the server on 8080 and Vite on 5173 with hot reload.

### Docker

```bash
docker compose up --build
```

Set `DISPATCHER_CODE` and `PUBLIC_BASE_URL` in the environment. Data lives in
the `dispatch-data` volume.

## How matching works

Configured through `.env` (defaults in brackets):

| Setting | Meaning |
|---------|---------|
| `OFFER_FANOUT` [3] | how many nearest units are asked at once. `1` gives strict one-at-a-time Uber behaviour. |
| `OFFER_TIMEOUT_SECONDS` [20] | time a unit has to accept before the offer expires and the next unit is asked. |
| `MAX_RADIUS_KM` [30] | units further than this are not considered. |
| `LOCATION_STALE_SECONDS` [300] | units whose last GPS fix is older are skipped. |
| `SEARCH_TIMEOUT_SECONDS` [300] | with no acceptance after this the request becomes *unfulfilled* and the control room is alerted. |
| `AVERAGE_SPEED_KMH` [45] | ETA = straight-line × 1.3 road factor ÷ speed + 60 s. |

Request lifecycle:

```
searching ─▶ assigned ─▶ en_route ─▶ arrived ─▶ completed
    │            │           │
    │            └───────────┴──▶ searching   (responder releases the job)
    ├──▶ unfulfilled ──▶ searching            (dispatcher retry / manual assign)
    └──▶ cancelled  (requester or dispatcher, any open state)
```

Priorities: security requests are *standard* unless flagged; medical and fire
are *urgent* by default; flags such as *armed*, *not breathing*, *people
trapped* make a request *critical*. Priority is shown to units and the
control room; matching order is by distance.

## Roles and sign-in

Sign-in is by mobile number and name and issues a bearer token; one account
per (number, role). Dispatchers must also supply `DISPATCHER_CODE`.

> Production note: put an SMS one-time-code step in front of
> `POST /api/auth/login` before exposing this publicly. The token model stays
> the same.

## API

All endpoints except login and the catalogue require
`Authorization: Bearer <token>` (or `?token=` for the SSE stream).

| Method | Path | Role | Purpose |
|--------|------|------|---------|
| POST | `/api/auth/login` | – | `{ role, name, phone, dispatcherCode? }` → `{ token, user }` |
| GET | `/api/catalogue` | – | services, quick flags, matching parameters |
| GET | `/api/auth/me` | any | current user (+ responder profile) |
| POST | `/api/requests` | requester | `{ service, lat, lng, address?, description?, flags? }` |
| GET | `/api/requests/mine` | requester | my requests |
| GET | `/api/requests/:id/track` | owner / unit / dispatcher | status, unit, position, distance, ETA, trail |
| POST | `/api/requests/:id/cancel` | requester, dispatcher | `{ reason? }` |
| POST | `/api/requests/:id/rate` | requester | `{ rating 1–5, comment? }` |
| GET/PUT | `/api/responders/me` | responder | profile, active job, pending offers / save profile |
| POST | `/api/responders/me/status` | responder | `{ status: available \| offline }` |
| POST | `/api/responders/me/location` | responder | `{ lat, lng, heading? }` |
| POST | `/api/offers/:id/accept` · `/decline` | responder | respond to an offer |
| POST | `/api/requests/:id/progress` | responder | `{ status: en_route \| arrived \| completed, note? }` |
| POST | `/api/requests/:id/release` | responder | give the job back to the pool |
| GET | `/api/requests?status=` · `/api/responders` | dispatcher | lists |
| GET | `/api/requests/:id` | dispatcher (+ owner/unit) | detail with offers and timeline |
| POST | `/api/requests/:id/assign` · `/retry` | dispatcher | `{ responderId }` / restart search |
| GET | `/api/stats` · `/api/audit` | dispatcher | counters, audit log |
| GET | `/api/events` | any | SSE: `request.*`, `offer.*`, `responder.*`, filtered per user |

## Project layout

```
server/src
  app.ts                       Fastify wiring, auth hook, error mapping, 1 s matching tick
  config.ts                    environment → typed config
  db/schema.sql, db.ts         SQLite schema and connection
  domain/                      types + flags, geo maths, request state machine, ids
  services/dispatchService.ts  matching engine and request/offer/job lifecycle
  services/authService.ts      phone sign-in, bearer tokens
  services/repositories.ts     SQL access
  routes/                      auth, requester, responder, dispatcher, SSE
server/test                    vitest: geo, state machine, matching scenarios, HTTP flows
server/scripts/simulate.ts     demo fleet that accepts and drives to jobs
web/src/screens                RequesterScreen, ResponderScreen, DispatcherScreen
web/src/components             Leaflet map wrapper, login, shared UI
```

```bash
npm test            # server tests
npm run typecheck   # both packages
```

Maps use OpenStreetMap tiles; the browser needs internet access to
`tile.openstreetmap.org`.

## Roadmap / not yet included

- SMS one-time-code verification and push notifications for responders when
  the app is in the background.
- Payments / subscriptions for paid response.
- Turn-by-turn routing and road-based ETAs (currently straight-line estimate).
- Organisation admin: manage units, shifts and coverage areas.
- Reporting exports.

## License

Apache-2.0
