import { Router, type IRouter } from "express";
import { listUsers } from "../lib/auth-store";
import { requireAdminSecret } from "../middlewares/require-admin-secret";
import { adminRateLimit } from "../middlewares/rate-limit";

const router: IRouter = Router();

router.get("/admin/users", adminRateLimit, requireAdminSecret, (_req, res) => {
  res.json(listUsers());
});

export default router;
