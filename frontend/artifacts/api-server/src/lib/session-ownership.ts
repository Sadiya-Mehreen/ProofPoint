// Shared between the REST interview routes and the WebSocket proxy: ties an
// interview session_id (opaque, from the Python backend) to the user who
// started it, so a session_id alone doesn't grant access to someone else's
// session. Also carries the metadata needed to persist an interview-history
// record once the session ends. In-memory only, same lifetime as the Python
// backend's session store.
type SessionMeta = {
  userId: string;
  candidateName: string;
  targetRole: string | null;
  startedAt: string;
};

const sessionMeta = new Map<string, SessionMeta>();

export function registerSessionOwner(sessionId: string, meta: SessionMeta): void {
  sessionMeta.set(sessionId, meta);
}

export function ownsSession(sessionId: string, userId: string): boolean {
  return sessionMeta.get(sessionId)?.userId === userId;
}

export function getSessionMeta(sessionId: string): SessionMeta | undefined {
  return sessionMeta.get(sessionId);
}

export function releaseSession(sessionId: string): void {
  sessionMeta.delete(sessionId);
}
