import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// `lib/db` (Drizzle + Postgres) is the intended store for real deployments, but
// this project has no Postgres available in every environment it runs in.
// Auth and interview history share this single zero-setup SQLite file via
// Node's built-in `node:sqlite` -- no native dependency, no external service
// required to run the app locally.
// This module only ever runs bundled (esbuild packs it into dist/index.mjs --
// see package.json's build/start scripts), so import.meta.dirname at runtime
// is always artifacts/api-server/dist/; one level up is the package root.
const dbPath =
  process.env["AUTH_DB_PATH"] || path.join(import.meta.dirname, "..", "data", "auracheck.db");

mkdirSync(path.dirname(dbPath), { recursive: true });

export const db = new DatabaseSync(dbPath);
