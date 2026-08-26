import { randomUUID } from "node:crypto";
import { db } from "./sqlite";

db.exec(`
  CREATE TABLE IF NOT EXISTS interviews (
    id TEXT PRIMARY KEY,
    user_id TEXT NOT NULL REFERENCES users(id),
    candidate_name TEXT NOT NULL,
    target_role TEXT,
    started_at TEXT NOT NULL,
    ended_at TEXT NOT NULL,
    scorecard_json TEXT NOT NULL,
    transcript_json TEXT NOT NULL,
    topics_json TEXT NOT NULL
  );
`);

export type InterviewSummary = {
  id: string;
  candidateName: string;
  targetRole: string | null;
  startedAt: string;
  endedAt: string;
  overallScore: number | null;
};

export type InterviewDetail = InterviewSummary & {
  scorecard: Record<string, unknown>;
  transcript: unknown[];
  topics: string[];
};

type InterviewRow = {
  id: string;
  candidate_name: string;
  target_role: string | null;
  started_at: string;
  ended_at: string;
  scorecard_json: string;
  transcript_json: string;
  topics_json: string;
};

function toSummary(row: InterviewRow): InterviewSummary {
  let overallScore: number | null = null;
  try {
    const scorecard = JSON.parse(row.scorecard_json);
    overallScore = typeof scorecard?.overallScore === "number" ? scorecard.overallScore : null;
  } catch {
    overallScore = null;
  }

  return {
    id: row.id,
    candidateName: row.candidate_name,
    targetRole: row.target_role,
    startedAt: row.started_at,
    endedAt: row.ended_at,
    overallScore,
  };
}

export function saveInterview(input: {
  userId: string;
  candidateName: string;
  targetRole: string | null;
  startedAt: string;
  scorecard: Record<string, unknown>;
  transcript: unknown[];
  topics: string[];
}): string {
  const id = randomUUID();
  db.prepare(
    `INSERT INTO interviews
      (id, user_id, candidate_name, target_role, started_at, ended_at, scorecard_json, transcript_json, topics_json)
     VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)`,
  ).run(
    id,
    input.userId,
    input.candidateName,
    input.targetRole,
    input.startedAt,
    new Date().toISOString(),
    JSON.stringify(input.scorecard),
    JSON.stringify(input.transcript),
    JSON.stringify(input.topics),
  );
  return id;
}

export function listInterviewsForUser(userId: string): InterviewSummary[] {
  const rows = db
    .prepare("SELECT * FROM interviews WHERE user_id = ? ORDER BY ended_at DESC")
    .all(userId) as unknown as InterviewRow[];
  return rows.map(toSummary);
}

export function getInterviewForUser(userId: string, id: string): InterviewDetail | undefined {
  const row = db
    .prepare("SELECT * FROM interviews WHERE id = ? AND user_id = ?")
    .get(id, userId) as InterviewRow | undefined;
  if (!row) return undefined;

  return {
    ...toSummary(row),
    scorecard: JSON.parse(row.scorecard_json),
    transcript: JSON.parse(row.transcript_json),
    topics: JSON.parse(row.topics_json),
  };
}

// Flattened, de-duplicated topics across a user's past interviews -- passed
// to the Python backend as `previous_topics` at the start of a new session so
// the live conductor (backend/crew/interview_conductor.py) can steer away
// from repeating exactly what was already covered.
export function getPreviousTopicsForUser(userId: string, limit = 10): string[] {
  const rows = db
    .prepare("SELECT topics_json FROM interviews WHERE user_id = ? ORDER BY ended_at DESC LIMIT ?")
    .all(userId, limit) as unknown as { topics_json: string }[];

  const topics = new Set<string>();
  for (const row of rows) {
    try {
      const parsed = JSON.parse(row.topics_json);
      if (Array.isArray(parsed)) {
        for (const topic of parsed) {
          if (typeof topic === "string") topics.add(topic);
        }
      }
    } catch {
      // skip malformed rows rather than fail the whole lookup
    }
  }
  return [...topics];
}
