import { randomUUID, randomBytes } from "node:crypto";
import { mkdirSync } from "node:fs";
import path from "node:path";
import { DatabaseSync } from "node:sqlite";

// `lib/db` (Drizzle + Postgres) is the intended store for real deployments, but
// this project has no Postgres available in every environment it runs in. Auth
// only needs a users table and a sessions table, so it gets its own zero-setup
// SQLite file via Node's built-in `node:sqlite` -- no native dependency, no
// external service required to run the app locally.
// This module only ever runs bundled (esbuild packs it into dist/index.mjs --
// see package.json's build/start scripts), so import.meta.dirname at runtime
// is always artifacts/api-server/dist/; one level up is the package root.
const dbPath =
  process.env["AUTH_DB_PATH"] || path.join(import.meta.dirname, "..", "data", "auracheck.db");

mkdirSync(path.dirname(dbPath), { recursive: true });

const db = new DatabaseSync(dbPath);

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
  );
`);

export type User = { id: string; name: string; email: string };
type UserRow = User & { password_hash: string };

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000; // 30 days

export function createUser(name: string, email: string, passwordHash: string): User {
  const id = randomUUID();
  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, name, email, passwordHash, new Date().toISOString());

  return { id, name, email };
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
}

export function findUserById(id: string): User | undefined {
  return db.prepare("SELECT id, name, email FROM users WHERE id = ?").get(id) as User | undefined;
}

export function createSession(userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  db.prepare("INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)").run(
    token,
    userId,
    expiresAt.toISOString(),
  );

  return { token, expiresAt };
}

export function findUserBySessionToken(token: string): User | undefined {
  const session = db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?")
    .get(token) as { user_id: string; expires_at: string } | undefined;

  if (!session) return undefined;

  if (new Date(session.expires_at).getTime() < Date.now()) {
    db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
    return undefined;
  }

  return findUserById(session.user_id);
}

export function deleteSession(token: string): void {
  db.prepare("DELETE FROM sessions WHERE token = ?").run(token);
}
