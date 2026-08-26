import express, { type Express } from "express";
import cors from "cors";
import cookieParser from "cookie-parser";
import pinoHttp from "pino-http";
import router from "./routes";
import { logger } from "./lib/logger";

const sessionSecret = process.env["SESSION_SECRET"];

if (!sessionSecret) {
  if (process.env.NODE_ENV === "production") {
    throw new Error("SESSION_SECRET environment variable is required in production.");
  }
  logger.warn(
    "SESSION_SECRET is not set -- using a random per-process secret. Signed-in sessions will not survive a server restart. Set SESSION_SECRET for a stable local dev session too.",
  );
}

const app: Express = express();

// Behind a standards-compliant reverse proxy (e.g. in production), trust its
// X-Forwarded-Proto so secure cookies work correctly.
app.set("trust proxy", 1);

app.use(cookieParser(sessionSecret || crypto.randomUUID()));
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
app.use(cors());
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

app.use("/api", router);

export default app;
