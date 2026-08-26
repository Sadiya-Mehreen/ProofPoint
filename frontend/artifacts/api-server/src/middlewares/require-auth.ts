import type { NextFunction, Request, Response } from "express";
import { findUserBySessionToken, type User } from "../lib/auth-store";
import { SESSION_COOKIE_NAME } from "../lib/session-cookie";

declare global {
  // eslint-disable-next-line @typescript-eslint/no-namespace
  namespace Express {
    interface Request {
      user?: User;
    }
  }
}

export function requireAuth(req: Request, res: Response, next: NextFunction): void {
  const token = req.signedCookies?.[SESSION_COOKIE_NAME];
  const user = typeof token === "string" ? findUserBySessionToken(token) : undefined;

  if (!user) {
    res.status(401).json({ error: "Please sign in to continue." });
    return;
  }

  req.user = user;
  next();
}
