import { randomUUID } from "node:crypto";
import { logger } from "./logger";

const configured = process.env["SESSION_SECRET"];

if (!configured) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET environment variable is required in production.");
  }
  logger.warn(
    "SESSION_SECRET is not set -- using a random per-process secret. Signed-in sessions will not survive a server restart. Set SESSION_SECRET for a stable local dev session too.",
  );
}

// Resolved once so every consumer (the cookie-parser middleware, the
// WebSocket upgrade handler) signs/verifies against the exact same secret.
export const sessionSecret = configured || randomUUID();
