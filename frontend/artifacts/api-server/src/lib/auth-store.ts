import { randomUUID, randomBytes } from "node:crypto";
import { db } from "./sqlite";

db.exec(`
  CREATE TABLE IF NOT EXISTS users (
    id TEXT PRIMARY KEY,
    name TEXT NOT NULL,
    email TEXT NOT NULL UNIQUE COLLATE NOCASE,
    password_hash TEXT NOT NULL,
    created_at TEXT NOT NULL,
    last_login TEXT
  );

  CREATE TABLE IF NOT EXISTS sessions (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
  );
`);

// Safe migration for databases created before last_login was added.
const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{
  name: string;
}>;

if (!userColumns.some((column) => column.name === "last_login")) {
  db.exec("ALTER TABLE users ADD COLUMN last_login TEXT");
}

export type User = { id: string; name: string; email: string };
type UserRow = User & { password_hash: string };

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createUser(
  name: string,
  email: string,
  passwordHash: string,
): User {
  const id = randomUUID();

  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, created_at) VALUES (?, ?, ?, ?, ?)",
  ).run(id, name, email, passwordHash, new Date().toISOString());

  return { id, name, email };
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db
    .prepare("SELECT * FROM users WHERE email = ?")
    .get(email) as UserRow | undefined;
}

export function findUserById(id: string): User | undefined {
  return db
    .prepare("SELECT id, name, email FROM users WHERE id = ?")
    .get(id) as User | undefined;
}

export function updateLastLogin(userId: string): void {
  db.prepare(
    "UPDATE users SET last_login = ? WHERE id = ?",
  ).run(new Date().toISOString(), userId);
}

export function createSession(
  userId: string,
): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + SESSION_TTL_MS);

  db.prepare(
    "INSERT INTO sessions (token, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(token, userId, expiresAt.toISOString());

  return { token, expiresAt };
}

export function findUserBySessionToken(token: string): User | undefined {
  const session = db
    .prepare("SELECT user_id, expires_at FROM sessions WHERE token = ?")
    .get(token) as
    | { user_id: string; expires_at: string }
    | undefined;

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