import { Router, type IRouter } from "express";
import healthRouter from "./health";
import authRouter from "./auth";
import adminRouter from "./admin";
import interviewRouter from "./interview";
import interviewsRouter from "./interviews";
import { requireAuth } from "../middlewares/require-auth";

const router: IRouter = Router();

router.use(healthRouter);
router.use(authRouter);
router.use(adminRouter);
router.use(requireAuth, interviewRouter);
router.use(requireAuth, interviewsRouter);

export default router;
