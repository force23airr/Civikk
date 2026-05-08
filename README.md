# Civik

Civik is a monorepo for driver reporting, road event intelligence, municipal dashboards, fleet tools, and future ML-based road detection.

## Structure

```text
civik/
├── apps/
│   ├── mobile/
│   └── web/
├── services/
│   ├── api/
│   ├── event-engine/
│   └── ml-worker/
├── packages/
│   ├── db/
│   ├── types/
│   ├── sdk/
│   └── utils/
├── infrastructure/
│   ├── docker/
│   ├── terraform/
│   └── scripts/
└── docs/
```

## V1 Goal

Driver starts trip -> app records metadata -> user reports event -> backend stores event -> dashboard displays event.

## Initial Build Focus

- `apps/mobile`: Expo React Native driver app
- `services/api`: Fastify API with Prisma and Postgres
- `packages/db`: shared Prisma schema
- `packages/types`: shared TypeScript contracts
