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
import {
  getSessionMeta,
  ownsSession,
  registerSessionOwner,
  releaseSession,
} from "../lib/session-ownership";
import { getPreviousTopicsForUser, saveInterview } from "../lib/interview-history-store";

const router: IRouter = Router();
const upload = multer({
  storage: multer.memoryStorage(),
  limits: { fileSize: 10 * 1024 * 1024 },
});

// Matches backend/crew/interview_conductor.py's INTERVIEWERS roster exactly --
// "speaker" values on live WebSocket events (interviewer_turn, etc.) are
// these same lowercase names.
const agents = [
  { name: "Sarah", role: "HR", color: "#f59e0b", status: "listening" },
  { name: "Alex", role: "Technical", color: "#8b5cf6", status: "ready" },
  { name: "Dave", role: "Projects", color: "#2dd4bf", status: "ready" },
  // Doesn't ask questions live -- checks domain/business-pitch plausibility
  // in the background, same as Sarah/Alex/Dave's critique-agent halves do.
  // status: "background" is a signal to the frontend to render this pill
  // visually distinct (dashed, muted) from the three live interviewers.
  { name: "Marcus", role: "Evidence check", color: "#fb7185", status: "background" },
  // Only weighs in when the panel's live findings hit "high" severity (see
  // crew/interruption_engine.py's should_run_judge) -- otherwise silent
  // until the end-of-session scorecard. Same background treatment as Marcus.
  { name: "Judge", role: "Weighs in on serious flags", color: "#60a5fa", status: "background" },
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

function asNumberOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? value : null;
}

function asStringOrNull(value: unknown): string | null {
  return typeof value === "string" ? value : null;
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
    const previousTopics = getPreviousTopicsForUser(req.user!.id);

    const backendResponse = asRecord(
      await backendPostJson("/session/start", {
        candidate_name: input.data.candidateName,
        github_username: input.data.githubUsername || null,
        target_role: input.data.targetRole,
        previous_topics: previousTopics,
      }),
    );

    const sessionId = asString(backendResponse["session_id"]);
    if (!sessionId) {
      res.status(502).json({ error: "The interview engine did not return a session." });
      return;
    }

    registerSessionOwner(sessionId, {
      userId: req.user!.id,
      candidateName: input.data.candidateName,
      targetRole: input.data.targetRole,
      startedAt: new Date().toISOString(),
    });

    res.json({
      sessionId,
      status: "live",
      // The real opening line comes from the live WebSocket's introduction
      // sequence (backend/crew/interview_conductor.py's build_introduction_turns)
      // moments after connecting -- this is just what's shown before that arrives.
      openingPrompt: "The panel is joining the room. Listen for their introductions, then you'll be asked to introduce yourself.",
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
    const meta = getSessionMeta(input.data.sessionId);
    const backendResponse = asRecord(
      await backendPostEmpty(`/session/${encodeURIComponent(input.data.sessionId)}/end`),
    );
    const scorecard = asRecord(backendResponse["scorecard"]);
    const transcript = Array.isArray(backendResponse["transcript"]) ? backendResponse["transcript"] : [];
    const topics = asStringArray(backendResponse["topics_covered"]);
    releaseSession(input.data.sessionId);

    const responseScorecard = {
      sessionId: asString(backendResponse["session_id"], input.data.sessionId),
      overallAssessment: asString(
        scorecard["overall_assessment"],
        "The panel didn't reach a final verdict for this session.",
      ),
      dimensions: [
        { label: "Technical knowledge", note: asString(scorecard["technical_integrity"], "Not assessed."), score: asNumberOrNull(scorecard["technical_score"]) },
        { label: "Problem solving", note: asString(scorecard["domain_strategy"], "Not assessed."), score: asNumberOrNull(scorecard["problem_solving_score"]) },
        { label: "Communication", note: asString(scorecard["communication"], "Not assessed."), score: asNumberOrNull(scorecard["communication_score"]) },
        { label: "Project knowledge", note: asString(scorecard["reality_vs_resume"], "Not assessed."), score: asNumberOrNull(scorecard["project_knowledge_score"]) },
        { label: "Behavioral", note: "See overall assessment for details.", score: asNumberOrNull(scorecard["behavioral_score"]) },
        { label: "Practical experience", note: "See overall assessment for details.", score: asNumberOrNull(scorecard["practical_experience_score"]) },
        { label: "Confidence & clarity", note: "See overall assessment for details.", score: asNumberOrNull(scorecard["confidence_score"]) },
      ],
      redFlags: asStringArray(scorecard["biggest_red_flags"]),
      mandatoryRepairSteps: asStringArray(scorecard["mandatory_repair_steps"]),
      parseWarning: scorecard["parse_warning"] === true,
      overallScore: asNumberOrNull(scorecard["overall_score"]),
      strengths: asStringArray(scorecard["strengths"]),
      weaknesses: asStringArray(scorecard["weaknesses"]),
      areasToImprove: asStringArray(scorecard["areas_to_improve"]),
      finalRecommendation: asStringOrNull(scorecard["final_recommendation"]),
    };

    const interviewId = saveInterview({
      userId: req.user!.id,
      candidateName: meta?.candidateName || "Candidate",
      targetRole: meta?.targetRole ?? null,
      startedAt: meta?.startedAt || new Date().toISOString(),
      scorecard: responseScorecard,
      transcript,
      topics,
    });

    res.json({ ...responseScorecard, interviewId });
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
        found: false,
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
      found: true,
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
