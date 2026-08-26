import { Router, type IRouter } from "express";
import { GetInterviewParams } from "@workspace/api-zod";
import { getInterviewForUser, listInterviewsForUser } from "../lib/interview-history-store";

const router: IRouter = Router();

router.get("/interviews", (req, res) => {
  res.json(listInterviewsForUser(req.user!.id));
});

router.get("/interviews/:interviewId", (req, res) => {
  const input = GetInterviewParams.safeParse(req.params);
  if (!input.success) {
    res.status(400).json({ error: "A valid interview id is required." });
    return;
  }

  const interview = getInterviewForUser(req.user!.id, input.data.interviewId);
  if (!interview) {
    res.status(404).json({ error: "This interview was not found." });
    return;
  }

  res.json(interview);
});

export default router;
