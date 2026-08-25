# AuraCheck

AuraCheck helps fresher graduates rehearse interviews and presentations with a live five-agent panel and evidence-backed coaching.

## Run & Operate

- `pnpm --filter @workspace/api-server run dev` — run the API server (port 5000)
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env: `DATABASE_URL` — Postgres connection string

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/auracheck/` — React + Vite frontend with dashboard, session setup, live interview room, scorecard, and settings routes.
- `artifacts/api-server/src/routes/interview.ts` — typed demo API routes for the session flow.
- `lib/api-spec/openapi.yaml` — source of truth for the session, resume, GitHub, and scorecard API contract.

## Architecture decisions

- The frontend uses generated React Query hooks from the shared OpenAPI contract.
- The visual language uses a warm paper surface, ink navigation, and lilac/celadon signal colors derived from the AuraCheck mark.
- Live interview state is designed around a WebSocket-ready room; REST session start/end and evidence setup are already wired.

## Product

- Candidates can review preparation momentum, attach a resume, look up a GitHub footprint, start a practice room, follow a five-agent panel, and review a final scorecard with evidence and coaching notes.

## User preferences

- The user wants a classy, eye-catching, high-contrast UI that matches the AuraCheck logo.

## Gotchas

- Run API codegen after changing `lib/api-spec/openapi.yaml`.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
