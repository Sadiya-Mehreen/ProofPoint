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

  CREATE TABLE IF NOT EXISTS password_reset_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
  );

  CREATE TABLE IF NOT EXISTS email_verification_tokens (
    token TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    expires_at TEXT NOT NULL
  );
`);

// Safe migration for databases created before last_login/email_verified were added.
const userColumns = db.prepare("PRAGMA table_info(users)").all() as Array<{
  name: string;
}>;

if (!userColumns.some((column) => column.name === "last_login")) {
  db.exec("ALTER TABLE users ADD COLUMN last_login TEXT");
}
if (!userColumns.some((column) => column.name === "email_verified")) {
  // Existing accounts predate this feature -- treat them as already
  // verified rather than surprising everyone with a banner on next login.
  db.exec("ALTER TABLE users ADD COLUMN email_verified INTEGER NOT NULL DEFAULT 1");
}

export type User = { id: string; name: string; email: string; emailVerified: boolean };
type UserRow = Omit<User, "emailVerified"> & { password_hash: string; email_verified: number };

export function toUser(row: UserRow): User {
  return { id: row.id, name: row.name, email: row.email, emailVerified: row.email_verified === 1 };
}

const SESSION_TTL_MS = 30 * 24 * 60 * 60 * 1000;

export function createUser(
  name: string,
  email: string,
  passwordHash: string,
): User {
  const id = randomUUID();

  db.prepare(
    "INSERT INTO users (id, name, email, password_hash, created_at, email_verified) VALUES (?, ?, ?, ?, ?, 0)",
  ).run(id, name, email, passwordHash, new Date().toISOString());

  return { id, name, email, emailVerified: false };
}

export function findUserByEmail(email: string): UserRow | undefined {
  return db.prepare("SELECT * FROM users WHERE email = ?").get(email) as UserRow | undefined;
}

export function findUserById(id: string): User | undefined {
  const row = db
    .prepare("SELECT id, name, email, email_verified FROM users WHERE id = ?")
    .get(id) as UserRow | undefined;
  return row ? toUser(row) : undefined;
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

const RESET_TOKEN_TTL_MS = 60 * 60 * 1000;

export function createPasswordResetToken(userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + RESET_TOKEN_TTL_MS);

  // A user can only have one live reset link at a time -- older ones (e.g.
  // from a previous "forgot password" click) stop working once a new one
  // is requested.
  db.prepare("DELETE FROM password_reset_tokens WHERE user_id = ?").run(userId);
  db.prepare(
    "INSERT INTO password_reset_tokens (token, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(token, userId, expiresAt.toISOString());

  return { token, expiresAt };
}

export function consumePasswordResetToken(token: string): string | undefined {
  const row = db
    .prepare("SELECT user_id, expires_at FROM password_reset_tokens WHERE token = ?")
    .get(token) as { user_id: string; expires_at: string } | undefined;

  if (!row) return undefined;

  db.prepare("DELETE FROM password_reset_tokens WHERE token = ?").run(token);

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return undefined;
  }

  return row.user_id;
}

export function updatePasswordHash(userId: string, passwordHash: string): void {
  db.prepare("UPDATE users SET password_hash = ? WHERE id = ?").run(passwordHash, userId);
}

export function deleteAllSessionsForUser(userId: string): void {
  db.prepare("DELETE FROM sessions WHERE user_id = ?").run(userId);
}

const VERIFICATION_TOKEN_TTL_MS = 24 * 60 * 60 * 1000;

export function createEmailVerificationToken(userId: string): { token: string; expiresAt: Date } {
  const token = randomBytes(32).toString("hex");
  const expiresAt = new Date(Date.now() + VERIFICATION_TOKEN_TTL_MS);

  db.prepare("DELETE FROM email_verification_tokens WHERE user_id = ?").run(userId);
  db.prepare(
    "INSERT INTO email_verification_tokens (token, user_id, expires_at) VALUES (?, ?, ?)",
  ).run(token, userId, expiresAt.toISOString());

  return { token, expiresAt };
}

export function consumeEmailVerificationToken(token: string): string | undefined {
  const row = db
    .prepare("SELECT user_id, expires_at FROM email_verification_tokens WHERE token = ?")
    .get(token) as { user_id: string; expires_at: string } | undefined;

  if (!row) return undefined;

  db.prepare("DELETE FROM email_verification_tokens WHERE token = ?").run(token);

  if (new Date(row.expires_at).getTime() < Date.now()) {
    return undefined;
  }

  return row.user_id;
}

export function markEmailVerified(userId: string): void {
  db.prepare("UPDATE users SET email_verified = 1 WHERE id = ?").run(userId);
}