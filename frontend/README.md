# AuraCheck

AuraCheck helps fresher graduates rehearse interviews and presentations with a live five-agent panel and evidence-backed coaching.

## Run & Operate

- `PORT=8080 pnpm --filter @workspace/api-server run dev` — run the API server
- `PORT=25575 BASE_PATH=/ pnpm --filter @workspace/auracheck run dev` — run the AuraCheck frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env for `api-server`: `PORT`, `DATABASE_URL` (Postgres connection string), `BACKEND_URL` (the Python interview-engine service, see `backend/README.md`; defaults to `http://localhost:8000`)
- Required env for `auracheck`: `PORT`, `BASE_PATH` (use `/`); optionally `API_SERVER_URL` to point its dev-server `/api` proxy at a non-default api-server host/port (defaults to `http://localhost:8080`)
- In production (Replit), path-based routing sends `/api` to `api-server` and `/` to `auracheck` automatically. When running the two services locally outside Replit, `auracheck`'s Vite dev server proxies `/api` to `api-server` itself (see `vite.config.ts`), so start `api-server` first.

## Stack

- pnpm workspaces, Node.js 24, TypeScript 5.9
- API: Express 5
- DB: PostgreSQL + Drizzle ORM
- Validation: Zod (`zod/v4`), `drizzle-zod`
- API codegen: Orval (from OpenAPI spec)
- Build: esbuild (CJS bundle)

## Where things live

- `artifacts/auracheck/` — React + Vite frontend with dashboard, session setup, live interview room, scorecard, and settings routes.
- `artifacts/api-server/src/routes/interview.ts` — typed API routes for the session flow; proxies to the Python interview engine (`backend/`) via `BACKEND_URL` and translates between its snake_case/text-based responses and this contract's shapes.
- `lib/api-spec/openapi.yaml` — source of truth for the session, resume, GitHub, and scorecard API contract.

## Architecture decisions

- The frontend uses generated React Query hooks from the shared OpenAPI contract.
- The visual language uses a warm paper surface, ink navigation, and lilac/celadon signal colors derived from the AuraCheck mark.
- Live interview state is designed around a WebSocket-ready room; REST session start/end and evidence setup are already wired.

## Product

- Candidates can review preparation momentum, attach a resume, look up a GitHub footprint, start a practice room, follow a five-agent panel, and review a final scorecard with a qualitative read, red flags, and repair steps.

## User preferences

- The user wants a classy, eye-catching, high-contrast UI that matches the AuraCheck logo.

## Gotchas

- Run API codegen after changing `lib/api-spec/openapi.yaml`. (`pnpm --filter @workspace/api-spec run codegen` wasn't runnable in the environment this contract was last edited in — the generated output under `lib/api-zod` and `lib/api-client-react` was hand-updated to match; re-run codegen to confirm it reproduces the same output.)
- `api-server` calls the Python backend under `backend/` for resume parsing, GitHub lookups, and interview scoring. That service has no numeric score in its scorecard output — it produces narrative text per dimension plus red flags and repair steps — so don't reintroduce a numeric `overallScore` without a real source for it.
- Start the Python backend (`cd backend && uvicorn main:app --reload`, see `backend/README.md`) before `api-server` in local dev, or session/resume/GitHub calls will 502.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
