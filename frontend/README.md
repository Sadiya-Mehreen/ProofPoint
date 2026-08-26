# AuraCheck

AuraCheck helps fresher graduates rehearse interviews and presentations with a live five-agent panel and evidence-backed coaching.

## Live

- **App** (Vercel): https://auracheck-taupe.vercel.app
- **api-server** (Railway): https://api-server-production-582a.up.railway.app -- not meant to be browsed directly, this is what the deployed frontend talks to
- The Python engine (`backend/`) runs as a second Railway service with no public domain -- `api-server` reaches it over Railway's private network only.

### Deploying

`vercel.json` builds and serves `artifacts/auracheck` as a static site; `render.yaml` at the repo root was an earlier Render-based attempt that's no longer used now that both backends run on Railway instead. Cross-origin deploys (frontend and api-server on different domains) need these production env vars beyond the local-dev ones below:

- `auracheck` (build-time, baked into the static bundle by Vite): `VITE_API_BASE_URL` -- absolute URL of the deployed `api-server`. Leave unset for local dev.
- `api-server`: `NODE_ENV=production`, `FRONTEND_ORIGIN` (the deployed frontend's origin(s), comma-separated -- required once `NODE_ENV=production`, since `cors()` with `credentials: true` can't pair with a wildcard origin), and `AUTH_DB_PATH` pointed at a mounted persistent volume (its SQLite file is lost on redeploy otherwise).
- In production the session cookie switches to `SameSite=None; Secure` (see `lib/session-cookie.ts`) since the two services are cross-origin; locally it stays `SameSite=Lax`.

## Run & Operate

- `PORT=8080 pnpm --filter @workspace/api-server run dev` — run the API server
- `PORT=25575 BASE_PATH=/ pnpm --filter @workspace/auracheck run dev` — run the AuraCheck frontend
- `pnpm run typecheck` — full typecheck across all packages
- `pnpm run build` — typecheck + build all packages
- `pnpm --filter @workspace/api-spec run codegen` — regenerate API hooks and Zod schemas from the OpenAPI spec
- `pnpm --filter @workspace/db run push` — push DB schema changes (dev only)
- Required env for `api-server`: `PORT`, `DATABASE_URL` (Postgres connection string), `BACKEND_URL` (the Python interview-engine service, see `backend/README.md`; defaults to `http://localhost:8000`), `SESSION_SECRET` (signs the auth session cookie; required in production, auto-generated per-process in dev if unset), optionally `AUTH_DB_PATH` (defaults to `artifacts/api-server/data/auracheck.db`)
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

- `artifacts/auracheck/` — React + Vite frontend with login/signup, dashboard, session setup, live interview room, scorecard, and settings routes.
- `artifacts/api-server/src/routes/interview.ts` — typed API routes for the session flow; proxies to the Python interview engine (`backend/`) via `BACKEND_URL` and translates between its snake_case/text-based responses and this contract's shapes.
- `artifacts/api-server/src/routes/auth.ts` — signup/login/logout/me routes. Accounts live in a local SQLite file (`node:sqlite`, no native dependency, no external DB required) rather than the Postgres `lib/db` package, since this project doesn't assume every environment it runs in has Postgres available. Passwords are hashed with `scrypt`; sessions are an opaque token in a signed, httpOnly cookie.
- `artifacts/api-server/src/middlewares/require-auth.ts` — gates every route in `interview.ts` behind a signed-in session; `interview.ts` also tracks which user started each interview `session_id` so one account can't read or end another account's session.
- `artifacts/api-server/src/lib/ws-proxy.ts` — proxies `/api/ws/{sessionId}` upgrade requests to the Python backend's live transcript WebSocket, gated by the same auth + session-ownership check as the REST routes.
- `lib/api-spec/openapi.yaml` — source of truth for the auth, session, resume, GitHub, and scorecard API contract.

## Architecture decisions

- The frontend uses generated React Query hooks from the shared OpenAPI contract.
- The visual language uses a warm paper surface, ink navigation, and lilac/celadon signal colors derived from the AuraCheck mark.
- The live interview room speaks to the real backend: the browser's Web Speech API (`SpeechRecognition`) turns the candidate's voice into text locally, which is sent over a WebSocket to `api-server` at `/api/ws/{sessionId}`; `api-server` pipes that connection through to the Python backend's `WS /ws/{session_id}` (see `backend/README.md`) via `http-proxy`, so the same live agent-panel logic that already existed there now actually runs during a session instead of only at the very end. Findings stream back and render live in the "Panel notes" feed. `SpeechSynthesis` speaks the opening prompt aloud. Requires a Chromium-based browser (Chrome/Edge) for voice input; Firefox/Safari don't support `SpeechRecognition` and the UI degrades to text-transcript-only with a note.

## Product

- Candidates sign up / log in, then can review preparation momentum, attach a resume, look up a GitHub footprint, start a practice room, follow a five-agent panel, and review a final scorecard with a qualitative read, red flags, and repair steps.
- Every route except `/login` and `/signup` requires a signed-in session; visiting a protected route while signed out redirects to `/login`.

## User preferences

- The user wants a classy, eye-catching, high-contrast UI that matches the AuraCheck logo.

## Gotchas

- Run API codegen after changing `lib/api-spec/openapi.yaml` (`pnpm --filter @workspace/api-spec run codegen`). Note: `format: email` on a schema property makes orval emit `zod.email()`, which only exists on zod's v4 API — the installed `zod` (pinned `^3.25.76` in the catalog) doesn't have it at the top level, so codegen fails. Stick to plain `type: string` for email fields until the zod dependency moves to v4, or the generated `zod` import is changed to `zod/v4`.
- Also watch for a schema component name colliding with orval's own auto-derived `{operationId}Body`/`{operationId}Response`/`{operationId}Params` names for the zod client (e.g. a component literally named `LoginBody` collides with the `login` operation's auto-generated request-body validator) — pick a different component name (e.g. `LoginInput`) if this happens.
- Don't hand-roll a WebSocket proxy by terminating the browser's connection and opening a second `WebSocket` *client* connection to the upstream server from inside the `upgrade` handler. That reproducibly failed on the Windows dev machine this was built on -- the outbound client connection closed instantly (code 1006, no error event) every single time, but *only* when opened from inside that upgrade callback in the running `api-server` process; the exact same connection succeeded from a plain script, and succeeded when the surrounding server had never itself accepted a real inbound request first. Root cause was never pinned down (ruled out: the `ws` package specifically, Node's native `WebSocket`, DNS/`localhost` vs `127.0.0.1`, `node:sqlite`, `multer`, the full Express middleware stack in isolation, and `scrypt`/threadpool timing). `ws-proxy.ts` instead pipes the raw upgraded socket straight through with `http-proxy`'s `ws: true` support -- the same category of library Vite's own dev-server proxy uses for the frontend's `/api` WS traffic -- and that has been reliable. If you're tempted to "simplify" this back to a hand-rolled client bridge, test it thoroughly against the real running server first.
- `api-server` calls the Python backend under `backend/` for resume parsing, GitHub lookups, and interview scoring. That service has no numeric score in its scorecard output — it produces narrative text per dimension plus red flags and repair steps — so don't reintroduce a numeric `overallScore` without a real source for it.
- Start the Python backend (`cd backend && uvicorn main:app --reload`, see `backend/README.md`) before `api-server` in local dev, or session/resume/GitHub calls will 502.

## Pointers

- See the `pnpm-workspace` skill for workspace structure, TypeScript setup, and package details
