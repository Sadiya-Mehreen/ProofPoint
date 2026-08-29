import rateLimit from "express-rate-limit";

// Signup/login are unauthenticated, so the only key we have is IP -- guards
// against credential stuffing and signup spam ahead of a launch traffic spike.
export const authRateLimit = rateLimit({
  windowMs: 15 * 60 * 1000,
  limit: 20,
  standardHeaders: true,
  legacyHeaders: false,
  message: { error: "Too many attempts. Please wait a few minutes and try again." },
});

// Every session burns a Groq LLM call, Groq speech-to-text, and a GitHub API
// lookup, so this exists to stop one account (or one leaked cookie) from
// running up the bill rather than to police normal practice-interview use.
// Runs after requireAuth, so req.user is always set -- key by account, not
// IP, so a shared office/NAT connection doesn't get throttled together.
export const sessionStartRateLimit = rateLimit({
  windowMs: 60 * 60 * 1000,
  limit: 15,
  standardHeaders: true,
  legacyHeaders: false,
  keyGenerator: (req) => req.user?.id ?? req.ip ?? "unknown",
  message: { error: "You've started a lot of sessions in the last hour. Please wait a bit and try again." },
});
