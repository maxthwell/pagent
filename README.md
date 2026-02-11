# pagent

TypeScript AI-agent platform (Web admin + API + Worker) with:
- Next.js web console
- Fastify REST API + OpenAPI
- BullMQ/Redis long-running jobs
- Postgres + Prisma + pgvector (RAG)
- SSE run event streaming

## Prereqs
- Node.js 20+
- pnpm 9+
- Docker (for Postgres/Redis)

## Quickstart (dev)
1) Install deps
```bash
pnpm install
```

2) Start Postgres + Redis
```bash
docker compose up -d postgres redis
```

3) Configure env
```bash
cp .env.example .env
```

4) Initialize DB
```bash
pnpm db:generate
pnpm db:migrate
```

5) Run everything
```bash
pnpm dev
```

## Quickstart (Docker-only dev)
This runs web+api+worker inside containers (slower because it runs `pnpm install` in-container).
```bash
cp .env.example .env
docker compose --profile app up
```

## Services
- Web: http://localhost:3000
- API: http://localhost:4000 (OpenAPI JSON at `/docs/json`, UI at `/docs`)
