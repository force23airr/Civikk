# Civik — Features, Services, and Components

A working map of what Civik does today, what each part is for, and who it serves.
This is a living doc — keep it short and accurate as the app evolves.

## What Civik Is

Civik turns a phone that is already in a moving vehicle into a road-intelligence
device: it records the trip, captures footage, lets the driver flag hazards, and
turns that into real-time roadway data for drivers, fleets, and cities.

It runs on the driver's existing phone — nothing new to install in the vehicle.

## Branded Service Lines

These are the product surfaces under the Civik name (think AWS-style naming):

| Name | What it is | Primary user |
| --- | --- | --- |
| Civik Drive | The mobile driver app — trip recording, footage capture, hazard reporting | Individual drivers, fleet drivers |
| Civik Alerts | Real-time notifications about hazards on or near a route | Drivers, fleets |
| Civik Road Intelligence | The web dashboard / map of reported road events | Cities, fleets, analysts |
| Civik API | Backend API for trips, road events, media clips | Internal apps, future partners |
| Civik Fleet | Fleet-level grouping of drivers/devices, safety visibility, incident evidence | Logistics, rideshare, care-transport operators |
| Civik Municipal | City/infrastructure-facing data products | Municipalities, contractors, infrastructure owners |

Today only **Civik Drive**, **Civik Road Intelligence**, and **Civik API** exist
in code; the rest are direction.

## Mobile App (Civik Drive) — Features

| Feature | Status | Notes |
| --- | --- | --- |
| Trip recording (start/stop) | ✅ | GPS captured at start and end |
| Active trip persistence | ✅ | Trip state saved to `AsyncStorage`; resumes after app kill/restart |
| Manual road event reporting | ✅ | Pothole, debris, dangerous intersection, crash, etc. with GPS |
| Offline event queue | ✅ | Failed reports queue locally with stable idempotency keys; auto-retry on app foreground |
| Camera trip capture | ✅ | Rolling ~30s video segments while a trip is active; resumes on foreground |
| Local clip storage | ✅ | Completed clips copied to app document directory before metadata is sent |
| Offline clip-metadata queue | ⬜ | Not yet — clip file is saved but metadata POST is not queued if offline |
| Clip retention / cleanup | ⬜ | Not yet — old clips are never deleted |
| Auto-attach clips to road events (before/after window) | ⬜ | Direction |
| Sensor / ML event detection | ⬜ | Direction |

## Web Dashboard (Civik Road Intelligence) — Features

| Feature | Status | Notes |
| --- | --- | --- |
| Road events map | ✅ | Leaflet + OpenStreetMap, severity-colored markers, popups |
| Road events table | ✅ | Type, severity, source, confidence, coordinates, trip, timestamp |
| Loading / error / empty states | ✅ | Fetches `GET /api/road-events` |
| Auth / admin views | ⬜ | Direction |
| Fleet / municipal filtered views | ⬜ | Direction |

## Backend (Civik API) — Services & Endpoints

Fastify + Prisma. Idempotent writes via `idempotency-key` header.

| Area | Endpoints | Status |
| --- | --- | --- |
| Health | `GET /health` | ✅ |
| Trips | `POST /api/trips/start`, `POST /api/trips/:id/end` | ✅ |
| Road events | `POST /api/road-events`, `GET /api/road-events`, nearby query | ✅ |
| Media clips | `POST /api/media/clips`, `GET /api/trips/:tripId/media-clips`, `GET /api/media/clips/:clipId`, `POST /api/media/clips/:clipId/complete` | ✅ (storage provider stubbed) |
| Real object storage / presigned uploads | — | ⬜ `createPresignPlaceholder` is a stub |
| Auth (real users/devices) | — | ⬜ everything uses `dev_user` today |

## Data Model (Prisma)

| Model | Purpose |
| --- | --- |
| User | Account owner (placeholder `dev_user` for now) |
| Device | A phone/device tied to a user |
| Trip | A driving session; start/end time + coordinates |
| RoadEvent | A reported hazard; type, location, severity, source, confidence |
| MediaClip | A video segment; tied to trip (and optionally a road event); upload status |
| IdempotencyKey | Stored result of an idempotent write, for safe retries |

## Repo Layout (where things live)

```text
apps/mobile/        Civik Drive — Expo React Native app
apps/web/           Civik Road Intelligence — Next.js dashboard
services/api/       Civik API — Fastify backend
packages/db/        Prisma schema, migrations, client
packages/types/     Shared TypeScript types
infrastructure/     Docker / deployment
docs/               This doc and other product/architecture notes
```

## Who Civik Serves (uses)

- **Individual drivers** — passive trip + incident record, useful for insurance and disputes
- **Fleets / operators** (logistics, rideshare, assisted-living transport, municipal/contractor) — fleet safety visibility, evidence around incidents, no in-vehicle hardware
- **Cities & infrastructure owners** — denser, real-time roadway hazard data

## Right Now: Getting Set Up Simply

Current priority is a clean, simple working setup — get the existing pieces
(mobile app, API, dashboard, DB) running together reliably before expanding into
the Fleet/Municipal/Alerts service lines.
