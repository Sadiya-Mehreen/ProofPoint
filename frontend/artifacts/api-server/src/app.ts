import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";
import { sessionSecret } from "./lib/session-secret";

const app: Express = express();

// Behind a standards-compliant reverse proxy (e.g. in production), trust its
// X-Forwarded-Proto so secure cookies work correctly.
app.set("trust proxy", 1);

app.use(cookieParser(sessionSecret));
app.use(
  pinoHttp({
    logger,
    serializers: {
      req(req) {
        return {
          id: req.id,
          method: req.method,
          url: req.url?.split("?")[0],
        };
      },
      res(res) {
        return {
          statusCode: res.statusCode,
        };
      },
    },
  }),
);
// FRONTEND_ORIGIN is required in production because a signed cross-origin
// cookie (see lib/session-cookie.ts) needs `credentials: true` here, and the
// `cors` package refuses to pair that with a wildcard origin. Comma-separated
// to allow more than one deployed frontend origin (e.g. a preview + prod URL).
const allowedOrigins = (process.env["FRONTEND_ORIGIN"] || "")
  .split(",")
  .map((origin) => origin.trim())
  .filter(Boolean);

if (allowedOrigins.length === 0 && process.env.NODE_ENV === "production") {
  throw new Error("FRONTEND_ORIGIN environment variable is required in production.");
}

app.use(
  cors({
    origin: allowedOrigins.length > 0 ? allowedOrigins : true,
    credentials: true,
  }),
);
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
