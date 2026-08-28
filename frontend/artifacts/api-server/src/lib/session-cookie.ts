import type { Response } from "express";

export const SESSION_COOKIE_NAME = "auracheck_session";

const isProduction = process.env.NODE_ENV === "production";

const COOKIE_OPTIONS = {
  httpOnly: true,
  // "none" in production: the frontend (Vercel) and this server (Render)
  // are deployed to different origins, so the cookie needs SameSite=None to
  // be sent on those cross-origin requests -- which browsers only honor
  // when `secure` is also true, hence tying the two to the same flag.
  sameSite: isProduction ? ("none" as const) : ("lax" as const),
  secure: isProduction,
  signed: true,
  path: "/",
};

export function setSessionCookie(res: Response, token: string, expiresAt: Date): void {
  res.cookie(SESSION_COOKIE_NAME, token, { ...COOKIE_OPTIONS, expires: expiresAt });
}

export function clearSessionCookie(res: Response): void {
  res.clearCookie(SESSION_COOKIE_NAME, COOKIE_OPTIONS);
}
