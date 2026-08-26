import { Router, type IRouter } from "express";
import { DeleteInterviewParams, GetInterviewParams } from "@workspace/api-zod";
import { deleteInterviewForUser, getInterviewForUser, listInterviewsForUser } from "../lib/interview-history-store";

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

router.delete("/interviews/:interviewId", (req, res) => {
  const input = DeleteInterviewParams.safeParse(req.params);
  if (!input.success) {
    res.status(400).json({ error: "A valid interview id is required." });
    return;
  }

  const deleted = deleteInterviewForUser(req.user!.id, input.data.interviewId);
  if (!deleted) {
    res.status(404).json({ error: "This interview was not found." });
    return;
  }

  res.status(204).end();
});

export default router;
