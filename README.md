# Civik

Civik turns a driver's phone into a smart road-intelligence tool.

Drivers can record their trip, report road issues, and help generate real-time civic data such as potholes, debris, dangerous intersections, crashes, and other roadway hazards.

## Vision

Civik is not just a dash cam app.

It is a mobile sensing network where every participating vehicle becomes a data point for safer roads, smarter cities, fleet safety, and infrastructure intelligence.

## Core V1

The first version focuses on basic but reliable functionality:

- Mobile app for drivers
- Record button to begin a driving session
- GPS/location capture
- Manual road event reporting
- Backend API for trips and road events
- Web dashboard to view reported events
- Future support for media clips and AI event detection

## Product Flow

```text
Driver opens Civik
-> taps Record
-> driving session starts
-> driver reports an event
-> app sends GPS + metadata to API
-> backend stores RoadEvent
-> dashboard/API displays roadway intelligence
```

## Monorepo Structure

```text
civik/
├── apps/
│   ├── mobile/          # Expo React Native driver app
│   └── web/             # Web dashboard for map/admin views
│
├── services/
│   ├── api/             # Main backend API
│   ├── event-engine/    # Future event scoring/routing service
│   └── ml-worker/       # Future AI/video processing service
│
├── packages/
│   ├── db/              # Prisma schema and database client
│   ├── types/           # Shared TypeScript types
│   ├── sdk/             # Future API client/SDK
│   └── utils/           # Shared utilities
│
├── infrastructure/      # Deployment, Docker, scripts, infra configs
├── docs/                # Architecture and product documentation
├── package.json
├── turbo.json
└── README.md
```

## Core Concepts

### Trip

A Trip is a driving session created when the user taps **Record**.

Trips group together:

- start time
- end time
- GPS metadata
- road events
- optional clips
- device data

### RoadEvent

A RoadEvent is a detected or reported roadway issue.

Examples:

- pothole
- debris
- hard brake
- crash
- reckless driver
- flooding
- dangerous intersection
- road obstruction

Example RoadEvent:

```json
{
  "id": "evt_123",
  "tripId": "trip_123",
  "type": "pothole",
  "lat": 25.7617,
  "lng": -80.1918,
  "speedMph": 37,
  "accuracyMeters": 8,
  "source": "manual",
  "severity": "medium",
  "confidence": 0.75,
  "createdAt": "2026-05-08T22:42:00Z"
}
```

## V1 API Routes

### Health

```http
GET /api/health
```

### Auth

```http
POST /api/auth/register
POST /api/auth/login
GET  /api/auth/me
```

### Trips

```http
POST /api/trips/start
POST /api/trips/:tripId/end
GET  /api/trips/:tripId
```

### Road Events

```http
POST /api/road-events
GET  /api/road-events
GET  /api/road-events/nearby
GET  /api/road-events/:eventId
PATCH /api/road-events/:eventId/confirm
```

### Media

```http
POST /api/media/presign-upload
POST /api/media/complete-upload
GET  /api/media/:mediaId
```

### Alerts

```http
GET  /api/alerts/nearby
POST /api/alerts
PATCH /api/alerts/:alertId/resolve
```

### Insights

```http
GET /api/insights/potholes
GET /api/insights/dangerous-intersections
GET /api/insights/road-risk
```

## Recommended Stack

### Mobile

- Expo
- React Native
- TypeScript
- Camera support
- Location services
- Device motion sensors

### Web

- Next.js
- TypeScript
- Map dashboard
- Admin/event views

### Backend

- Node.js
- Fastify or NestJS
- TypeScript
- Zod validation
- Prisma
- PostgreSQL
- PostGIS

### Future Infrastructure

- Redis/BullMQ for background jobs
- S3-compatible storage for media clips
- WebSockets for real-time alerts
- ML worker for camera/video analysis

## V1 Goal

The first milestone is simple:

```text
User taps Record
-> Trip starts
-> user reports road event
-> app sends GPS metadata
-> backend stores event
-> dashboard shows event on map
```

## Mobile Resilience Direction

The driver app should protect trip state first, then add media capture on top.

Current mobile behavior:

- active Trip state is persisted locally on the phone
- manual RoadEvent reports can be queued locally if upload fails
- queued reports retry when the app becomes active again

Future video behavior:

- camera footage should use short rolling local segments, not one giant file
- if the driver switches apps or the OS interrupts capture, Civik should keep the last completed segment
- older footage can expire by retention policy, but recent evidence around a RoadEvent should be preserved
- uploads should happen in the background queue after metadata is safely stored

## Local Development

Copy the example environment file once:

```sh
cp .env.example .env
```

Start PostGIS:

```sh
docker compose -f infrastructure/docker/docker-compose.yml up -d
```

Install dependencies and prepare Prisma:

```sh
npm install
npm run db:generate
npm --workspace @civik/db run db:migrate -- --name init
```

Run the active V1 services:

```sh
npm run dev:api
npm run dev:web
npm run dev:mobile
```

Default local URLs:

- API: `http://localhost:3000`
- Web dashboard: `http://localhost:3001`
- Mobile API env: `EXPO_PUBLIC_API_URL`

## Resilience Principles

Every write endpoint should support:

- `requestId`
- `idempotencyKey`
- Zod validation
- authentication middleware
- structured logging
- retry-safe writes
- clean error responses
- rate limiting

## Long-Term Platform

Civik can expand into:

- Road Hazard API
- Pothole Detection API
- Municipal Dashboard
- Fleet Safety Dashboard
- Insurance Evidence Packets
- Dangerous Intersection Analytics
- Real-time Road Risk Scoring

## Mission

Civik helps everyday drivers turn road observations into actionable intelligence for safer roads, smarter cities, and better infrastructure.
