import { timingSafeEqual } from "node:crypto";
import type { NextFunction, Request, Response } from "express";

const adminSecret = process.env["ADMIN_SECRET"];

function safeEqual(a: string, b: string): boolean {
  const bufA = Buffer.from(a);
  const bufB = Buffer.from(b);
  // timingSafeEqual throws on length mismatch rather than just returning
  // false, so pad to a matching length first -- the actual comparison result
  // (false, since lengths differ) is still what determines access.
  if (bufA.length !== bufB.length) return false;
  return timingSafeEqual(bufA, bufB);
}

// 404s rather than 401s when ADMIN_SECRET isn't configured, so the route's
// existence isn't revealed to anyone who hasn't been given the secret out of
// band -- there's nothing to probe for.
export function requireAdminSecret(req: Request, res: Response, next: NextFunction): void {
  if (!adminSecret) {
    res.status(404).end();
    return;
  }

  // Accepts either a header (curl/Postman) or a ?secret= query param, so
  // this can be checked by just pasting a URL into a browser address bar.
  const provided = req.header("x-admin-secret") || (req.query["secret"] as string | undefined);
  if (!provided || !safeEqual(provided, adminSecret)) {
    res.status(404).end();
    return;
  }

  next();
}
