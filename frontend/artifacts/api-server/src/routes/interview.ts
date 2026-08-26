import { Router, type IRouter } from "express";
import multer from "multer";
import {
  EndSessionParams,
  StartSessionBody,
  UploadResumeBody,
  GetGithubFootprintParams,
} from "@workspace/api-zod";
import {
  backendGet,
  backendPostEmpty,
  backendPostForm,
  backendPostJson,
  BackendRequestError,
  BackendUnavailableError,
} from "../lib/backend-client";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// The Python backend has no concept of users -- its session store is keyed
// only by an opaque session_id. This map ties each session back to the
// signed-in user who started it, so one account can't read or end another
// account's session just by guessing/observing its id. It lives only as long
// as the process, same as the Python backend's in-memory SessionManager.
const sessionOwners = new Map<string, string>();

function ownsSession(sessionId: string, userId: string): boolean {
  return sessionOwners.get(sessionId) === userId;
}

const agents = [
  { name: "Alex", role: "Communication", color: "#8b5cf6", status: "listening" },
  { name: "Dave", role: "Technical depth", color: "#2dd4bf", status: "ready" },
  { name: "Sarah", role: "Clarity & English", color: "#f59e0b", status: "ready" },
  { name: "Marcus", role: "Evidence check", color: "#fb7185", status: "ready" },
  { name: "Judge", role: "Final assessment", color: "#60a5fa", status: "observing" },
];

function asRecord(value: unknown): Record<string, unknown> {
  return value && typeof value === "object" ? (value as Record<string, unknown>) : {};
}

function asString(value: unknown, fallback = ""): string {
  return typeof value === "string" ? value : fallback;
}

function asNumber(value: unknown, fallback = 0): number {
  return typeof value === "number" && Number.isFinite(value) ? value : fallback;
}

function asStringArray(value: unknown): string[] {
  return Array.isArray(value) ? value.filter((item): item is string => typeof item === "string") : [];
}

// The Python backend only extracts raw resume text (see backend/services/resume_parser.py) --
// it has no structured-profile output. This is a lightweight heuristic over that real text,
// not fabricated data: most resumes lead with the candidate's name, then a headline/title,
// then a skills section.
function extractProfileFromResumeText(resumeText: string): {
  name: string;
  headline: string;
  skills: string[];
  experience: string;
} {
  const lines = resumeText
    .split(/\r?\n/)
    .map((line) => line.trim())
    .filter(Boolean);

  const name = lines[0] || "Candidate";
  const headline = lines[1] && lines[1].length <= 120 ? lines[1] : "";

  const skillsLineIndex = lines.findIndex((line) => /^skills\b/i.test(line));
  let skills: string[] = [];
  if (skillsLineIndex !== -1) {
    const inline = lines[skillsLineIndex].replace(/^skills[:\-]?\s*/i, "");
    const source = inline || lines[skillsLineIndex + 1] || "";
    skills = source
      .split(/[,•|]/)
      .map((skill) => skill.trim())
      .filter(Boolean)
      .slice(0, 12);
  }

  const experience = lines.slice(2, 6).join(" ").slice(0, 400) || "No experience section detected.";

  return { name, headline, skills, experience };
}

function handleBackendError(err: unknown, res: import("express").Response, notFoundMessage?: string): void {
  if (err instanceof BackendUnavailableError) {
    res.status(502).json({ error: "The interview engine is unavailable. Please try again shortly." });
    return;
  }
  if (err instanceof BackendRequestError) {
    if (err.status === 404 && notFoundMessage) {
      res.status(404).json({ error: notFoundMessage });
      return;
    }
    res.status(502).json({ error: "The interview engine could not complete this request." });
    return;
  }
  throw err;
}

router.post("/session/start", async (req, res) => {
  const input = StartSessionBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Please provide a candidate name and target role." });
    return;
  }

  try {
    const backendResponse = asRecord(
      await backendPostJson("/session/start", {
        candidate_name: input.data.candidateName,
        github_username: input.data.githubUsername || null,
      }),
    );

    const sessionId = asString(backendResponse["session_id"]);
    if (!sessionId) {
      res.status(502).json({ error: "The interview engine did not return a session." });
      return;
    }

    sessionOwners.set(sessionId, req.user!.id);

    res.json({
      sessionId,
      status: "live",
      openingPrompt: `Hi ${input.data.candidateName}, let’s begin. Tell us about a project you're proud of and the problem it solved.`,
      agents,
    });
  } catch (err) {
    handleBackendError(err, res);
  }
});

router.post("/session/:sessionId/end", async (req, res) => {
  const input = EndSessionParams.safeParse(req.params);
  if (!input.success) {
    res.status(400).json({ error: "A valid session is required." });
    return;
  }
  if (!ownsSession(input.data.sessionId, req.user!.id)) {
    res.status(404).json({ error: "This session was not found or has already ended." });
    return;
  }

  try {
    const backendResponse = asRecord(
      await backendPostEmpty(`/session/${encodeURIComponent(input.data.sessionId)}/end`),
    );
    const scorecard = asRecord(backendResponse["scorecard"]);
    sessionOwners.delete(input.data.sessionId);

    res.json({
      sessionId: asString(backendResponse["session_id"], input.data.sessionId),
      overallAssessment: asString(
        scorecard["overall_assessment"],
        "The panel didn't reach a final verdict for this session.",
      ),
      dimensions: [
        { label: "Reality vs. resume", note: asString(scorecard["reality_vs_resume"], "Not assessed.") },
        { label: "Technical integrity", note: asString(scorecard["technical_integrity"], "Not assessed.") },
        { label: "Communication", note: asString(scorecard["communication"], "Not assessed.") },
        { label: "Domain strategy", note: asString(scorecard["domain_strategy"], "Not assessed.") },
      ],
      redFlags: asStringArray(scorecard["biggest_red_flags"]),
      mandatoryRepairSteps: asStringArray(scorecard["mandatory_repair_steps"]),
      parseWarning: scorecard["parse_warning"] === true,
    });
  } catch (err) {
    handleBackendError(err, res, "This session was not found or has already ended.");
  }
});

router.post("/resume/upload", upload.single("file"), async (req, res) => {
  const input = UploadResumeBody.safeParse(req.body);
  if (!input.success) {
    res.status(400).json({ error: "Please provide the sessionId for this upload." });
    return;
  }
  if (!req.file) {
    res.status(400).json({ error: "Please attach a resume file." });
    return;
  }
  if (!ownsSession(input.data.sessionId, req.user!.id)) {
    res.status(404).json({ error: "This session was not found." });
    return;
  }

  try {
    const form = new FormData();
    form.append(
      "file",
      new Blob([new Uint8Array(req.file.buffer)], { type: req.file.mimetype || "application/octet-stream" }),
      req.file.originalname || "resume",
    );

    const backendResponse = asRecord(
      await backendPostForm(`/resume/upload?session_id=${encodeURIComponent(input.data.sessionId)}`, form),
    );

    res.json(extractProfileFromResumeText(asString(backendResponse["resume_text"])));
  } catch (err) {
    handleBackendError(err, res, "This session was not found.");
  }
});

router.get("/github/:username", async (req, res) => {
  const input = GetGithubFootprintParams.safeParse(req.params);
  if (!input.success) {
    res.status(400).json({ error: "A valid GitHub username is required." });
    return;
  }

  try {
    const backendResponse = asRecord(await backendGet(`/github/${encodeURIComponent(input.data.username)}`));
    const errorCode = typeof backendResponse["error"] === "string" ? backendResponse["error"] : null;

    if (errorCode) {
      res.json({
        username: input.data.username,
        repositories: 0,
        topLanguages: [],
        summary:
          errorCode === "user_not_found"
            ? "We couldn't find a public GitHub account with this username."
            : "We couldn't read this GitHub account's public activity right now.",
      });
      return;
    }

    const totalRepositories = asNumber(backendResponse["total_repositories"]);
    const totalCommits = asNumber(backendResponse["total_commits"]);
    const languages = asStringArray(backendResponse["languages"]);

    res.json({
      username: input.data.username,
      repositories: totalRepositories,
      topLanguages: languages,
      summary:
        totalRepositories > 0
          ? `${totalRepositories} public ${totalRepositories === 1 ? "repository" : "repositories"} analyzed, with ${totalCommits} commits across ${languages.length ? languages.join(", ") : "a mix of languages"}.`
          : "No public repository activity found yet.",
    });
  } catch (err) {
    handleBackendError(err, res);
  }
});

export default router;
