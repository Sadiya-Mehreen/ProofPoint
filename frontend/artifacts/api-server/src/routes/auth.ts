import { Router, type IRouter } from "express";
import { LoginBody, SignupBody } from "@workspace/api-zod";
import {
  createSession,
  createUser,
  deleteSession,
  findUserByEmail,
} from "../lib/auth-store";
import { hashPassword, verifyPassword } from "../lib/password";
import { clearSessionCookie, setSessionCookie, SESSION_COOKIE_NAME } from "../lib/session-cookie";
import { requireAuth } from "../middlewares/require-auth";

const router: IRouter = Router();

router.post("/auth/signup", async (req, res) => {
  const input = SignupBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Please provide your name, a valid email, and a password of at least 8 characters." });
    return;
  }

  const email = input.data.email.trim().toLowerCase();
  if (findUserByEmail(email)) {
    res.status(409).json({ error: "An account with this email already exists." });
    return;
  }

  const passwordHash = await hashPassword(input.data.password);
  const user = createUser(input.data.name.trim(), email, passwordHash);
  const { token, expiresAt } = createSession(user.id);

  setSessionCookie(res, token, expiresAt);
  res.json(user);
});

router.post("/auth/login", async (req, res) => {
  const input = LoginBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Please provide your email and password." });
    return;
  }

  const email = input.data.email.trim().toLowerCase();
  const record = findUserByEmail(email);
  const valid = record ? await verifyPassword(input.data.password, record.password_hash) : false;

  if (!record || !valid) {
    res.status(401).json({ error: "Invalid email or password." });
    return;
  }

  const { token, expiresAt } = createSession(record.id);
  setSessionCookie(res, token, expiresAt);
  res.json({ id: record.id, name: record.name, email: record.email });
});

router.post("/auth/logout", (req, res) => {
  const token = req.signedCookies?.[SESSION_COOKIE_NAME];
  if (typeof token === "string") {
    deleteSession(token);
  }
  clearSessionCookie(res);
  res.status(204).end();
});

router.get("/auth/me", requireAuth, (req, res) => {
  res.json(req.user);
});

export default router;
