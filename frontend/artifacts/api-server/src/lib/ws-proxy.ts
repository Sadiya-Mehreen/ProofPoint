import type { IncomingMessage, Server } from "node:http";
import type { Duplex } from "node:stream";
import cookieParser from "cookie-parser";
import httpProxy from "http-proxy";
import { findUserBySessionToken } from "./auth-store";
import { logger } from "./logger";
import { ownsSession } from "./session-ownership";
import { sessionSecret } from "./session-secret";
import { SESSION_COOKIE_NAME } from "./session-cookie";

const backendUrl = (process.env["BACKEND_URL"] || "http://127.0.0.1:8000").replace(/\/+$/, "");

const parseCookies = cookieParser(sessionSecret);

// The `upgrade` event hands us a raw http.IncomingMessage that never went
// through Express's middleware chain, so cookie-parser hasn't run on it yet.
// It's a plain (req, res, next) middleware, so it can be invoked directly --
// this reuses the exact same parsing/verification as every other route
// instead of reimplementing cookie-signature checks here.
function readSignedSessionCookie(req: IncomingMessage): string | undefined {
  let token: string | undefined;
  // eslint-disable-next-line @typescript-eslint/no-explicit-any
  parseCookies(req as any, {} as any, () => {
    // eslint-disable-next-line @typescript-eslint/no-explicit-any
    token = (req as any).signedCookies?.[SESSION_COOKIE_NAME];
  });
  return token;
}

function reject(socket: Duplex, statusLine: string): void {
  socket.write(`HTTP/1.1 ${statusLine}\r\n\r\n`);
  socket.destroy();
}

// Bridges the browser to the Python backend's live transcript WebSocket
// (`WS /ws/{session_id}`, see backend/api/routes.py) so the interview room
// gets real-time agent findings instead of the interview engine being
// unreachable from the browser directly. Mirrors the REST proxying in
// interview.ts: same auth gate, same per-user session ownership check.
//
// Uses http-proxy (the same class of library Vite's own dev-server proxy
// uses for its `ws: true` support) to pipe the raw upgraded socket straight
// through to the backend. An earlier hand-rolled version -- terminate the
// browser's WS locally, open a second WebSocket *client* connection to the
// backend, relay messages between them -- reproducibly failed on this
// machine: the outbound client connection closed instantly (code 1006, no
// error event) every time, but only when opened from inside this process's
// own upgrade handler; the exact same connection succeeded from a plain
// script. Piping the raw socket instead of speaking the WS client protocol
// ourselves sidesteps whatever that was.
export function attachInterviewWebSocketProxy(server: Server): void {
  const proxy = httpProxy.createProxyServer();

  proxy.on("error", (err, _req, socketOrRes) => {
    logger.warn({ errMessage: err.message }, "Interview engine WebSocket proxy error");
    if ("destroy" in socketOrRes) socketOrRes.destroy();
  });

  server.on("upgrade", (req, socket, head) => {
    const url = new URL(req.url || "", "http://localhost");
    const match = url.pathname.match(/^\/api\/ws\/([^/]+)$/);

    if (!match) {
      // Not ours -- leave it alone in case something else wants to upgrade it.
      return;
    }

    const sessionId = decodeURIComponent(match[1]);
    const token = readSignedSessionCookie(req);
    const user = token ? findUserBySessionToken(token) : undefined;

    if (!user) {
      reject(socket, "401 Unauthorized");
      return;
    }

    if (!ownsSession(sessionId, user.id)) {
      reject(socket, "404 Not Found");
      return;
    }

    // Rewrite /api/ws/<id> -> /ws/<id> for the backend, which doesn't know
    // about the /api prefix api-server's REST routes are mounted under.
    req.url = `/ws/${encodeURIComponent(sessionId)}`;
    proxy.ws(req, socket, head, { target: backendUrl, ws: true });
  });
}
