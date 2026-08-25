import { Router, type IRouter } from "express";
import { randomUUID } from "node:crypto";
import {
  EndSessionParams,
  StartSessionBody,
  UploadResumeBody,
  GetGithubFootprintParams,
} from "@workspace/api-zod";

const router: IRouter = Router();

const agents = [
  { name: "Alex", role: "Communication", color: "#8b5cf6", status: "listening" },
  { name: "Dave", role: "Technical depth", color: "#2dd4bf", status: "ready" },
  { name: "Sarah", role: "Clarity & English", color: "#f59e0b", status: "ready" },
  { name: "Marcus", role: "Evidence check", color: "#fb7185", status: "ready" },
  { name: "Judge", role: "Final assessment", color: "#60a5fa", status: "observing" },
];

router.post("/session/start", (req, res) => {
  const input = StartSessionBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Please provide a candidate name and target role." });
    return;
  }

  res.json({
    sessionId: randomUUID(),
    status: "live",
    openingPrompt: `Hi ${input.data.candidateName}, let’s begin. Tell us about a project you're proud of and the problem it solved.`,
    agents,
  });
});

router.post("/session/:sessionId/end", (req, res) => {
  const input = EndSessionParams.safeParse(req.params);
  if (!input.success) {
    res.status(400).json({ error: "A valid session is required." });
    return;
  }

  res.json({
    overallScore: 78,
    summary:
      "You brought strong practical energy and explained your work with conviction. Your next level is adding more structure to technical answers and making outcomes measurable.",
    dimensions: [
      { label: "Communication", score: 82, note: "Warm, confident delivery with a clear point of view." },
      { label: "Technical depth", score: 76, note: "Good instincts; add more trade-offs and implementation detail." },
      { label: "Clarity", score: 80, note: "Natural pacing. Tighten a few longer sentences." },
      { label: "Evidence alignment", score: 74, note: "Your examples are credible; connect them to shipped outcomes." },
    ],
    evidence: [
      "GitHub footprint supports hands-on project experience.",
      "Resume projects align with the role you selected.",
      "Live answer showed clear ownership of the implementation.",
    ],
  });
});

router.post("/resume/upload", (req, res) => {
  const input = UploadResumeBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Please provide a resume file name." });
    return;
  }
  res.json({
    name: "Ayesha Khan",
    headline: "Computer Science graduate · Frontend developer",
    skills: ["React", "TypeScript", "Python", "PostgreSQL"],
    experience: "Built and shipped three academic and freelance products.",
  });
});

router.get("/github/:username", (req, res) => {
  const input = GetGithubFootprintParams.safeParse(req.params);
  if (!input.success) {
    res.status(400).json({ error: "A valid GitHub username is required." });
    return;
  }
  res.json({
    username: input.data.username,
    repositories: 18,
    topLanguages: ["TypeScript", "Python", "CSS"],
    summary: "Consistent activity across frontend products, APIs, and developer tooling.",
  });
});

export default router;