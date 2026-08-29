import { Router, type IRouter } from "express";
import { ForgotPasswordBody, LoginBody, ResetPasswordBody, SignupBody } from "@workspace/api-zod";
import {
 consumePasswordResetToken,
 createPasswordResetToken,
 createSession,
 createUser,
 deleteAllSessionsForUser,
 deleteSession,
 findUserByEmail,
 findUserById,
 updateLastLogin,
 updatePasswordHash,
} from "../lib/auth-store";
import { sendPasswordResetEmail } from "../lib/email";
import { frontendOrigin } from "../lib/frontend-origin";
import { hashPassword, verifyPassword } from "../lib/password";
import { clearSessionCookie, setSessionCookie, SESSION_COOKIE_NAME } from "../lib/session-cookie";
import { requireAuth } from "../middlewares/require-auth";
import { authRateLimit } from "../middlewares/rate-limit";
import { logger } from "../lib/logger";

const router: IRouter = Router();

router.post("/auth/signup", authRateLimit, async (req, res) => {
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

router.post("/auth/login", authRateLimit, async (req, res) => {
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

  updateLastLogin(record.id);

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

router.post("/auth/forgot-password", authRateLimit, async (req, res) => {
  const input = ForgotPasswordBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Please provide a valid email." });
    return;
  }

  const email = input.data.email.trim().toLowerCase();
  const record = findUserByEmail(email);

  // Always respond the same way whether or not the account exists, so this
  // endpoint can't be used to check which emails have accounts.
  if (record) {
    const { token } = createPasswordResetToken(record.id);
    const resetUrl = `${frontendOrigin}/reset-password?token=${token}`;
    try {
      await sendPasswordResetEmail(record.email, resetUrl);
    } catch (err) {
      logger.error({ err }, "Failed to send password reset email");
    }
  }

  res.status(204).end();
});

router.post("/auth/reset-password", authRateLimit, async (req, res) => {
  const input = ResetPasswordBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Please provide a valid reset token and a password of at least 8 characters." });
    return;
  }

  const userId = consumePasswordResetToken(input.data.token);
  if (!userId) {
    res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    return;
  }

  const user = findUserById(userId);
  if (!user) {
    res.status(400).json({ error: "This reset link is invalid or has expired. Please request a new one." });
    return;
  }

  const passwordHash = await hashPassword(input.data.password);
  updatePasswordHash(userId, passwordHash);
  // A password reset is a good signal to invalidate every other session too
  // (e.g. one on a device that no longer should have access).
  deleteAllSessionsForUser(userId);

  const { token, expiresAt } = createSession(userId);
  setSessionCookie(res, token, expiresAt);
  res.json(user);
});

export default router;
