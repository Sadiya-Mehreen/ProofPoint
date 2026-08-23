import unittest

from models.candidate_context import CandidateContext
from models.session_manager import SessionManager


class CandidateContextTests(unittest.TestCase):
    def test_defaults(self):
        ctx = CandidateContext(session_id="abc")
        self.assertIsNone(ctx.candidate_name)
        self.assertEqual(ctx.resume_text, "")
        self.assertEqual(ctx.github_data, {})
        self.assertEqual(ctx.conversation_history, [])
        self.assertEqual(ctx.detected_claims, [])
        self.assertEqual(ctx.agent_findings, [])
        self.assertTrue(ctx.created_at)

    def test_default_lists_are_independent_between_instances(self):
        a = CandidateContext(session_id="a")
        b = CandidateContext(session_id="b")
        a.add_transcript_chunk("hello")
        self.assertEqual(len(a.conversation_history), 1)
        self.assertEqual(len(b.conversation_history), 0)

    def test_add_transcript_chunk(self):
        ctx = CandidateContext(session_id="abc")
        ctx.add_transcript_chunk("I built a REST API in Python.")
        self.assertEqual(ctx.current_transcript, "I built a REST API in Python.")
        self.assertEqual(len(ctx.conversation_history), 1)
        entry = ctx.conversation_history[0]
        self.assertEqual(entry["role"], "candidate")
        self.assertEqual(entry["text"], "I built a REST API in Python.")
        self.assertIn("timestamp", entry)

    def test_add_agent_finding(self):
        ctx = CandidateContext(session_id="abc")
        ctx.add_agent_finding("alex", "Repo has no commit history matching claim.", "high")
        self.assertEqual(len(ctx.agent_findings), 1)
        finding = ctx.agent_findings[0]
        self.assertEqual(finding["agent"], "alex")
        self.assertEqual(finding["finding"], "Repo has no commit history matching claim.")
        self.assertEqual(finding["severity"], "high")
        self.assertIn("timestamp", finding)

    def test_to_summary_dict_is_lean_and_counts_severity(self):
        ctx = CandidateContext(
            session_id="abc", candidate_name="Jane Doe", github_username="janedoe"
        )
        ctx.add_agent_finding("alex", "finding 1", "high")
        ctx.add_agent_finding("sarah", "finding 2", "high")
        ctx.add_agent_finding("marcus", "finding 3", "low")
        for i in range(8):
            ctx.add_transcript_chunk(f"line {i}")

        summary = ctx.to_summary_dict()

        self.assertEqual(summary["candidate_name"], "Jane Doe")
        self.assertEqual(summary["github_username"], "janedoe")
        self.assertEqual(summary["total_findings"], 3)
        self.assertEqual(summary["findings_by_severity"], {"high": 2, "low": 1})
        self.assertEqual(len(summary["recent_transcript"]), 5)
        self.assertEqual(summary["recent_transcript"][-1], "line 7")
        self.assertNotIn("resume_text", summary)
        self.assertNotIn("github_data", summary)


class SessionManagerTests(unittest.TestCase):
    def test_create_and_get_session(self):
        manager = SessionManager()
        session = manager.create_session()

        self.assertIsInstance(session, CandidateContext)
        self.assertTrue(session.session_id)

        fetched = manager.get_session(session.session_id)
        self.assertIs(fetched, session)

    def test_get_unknown_session_returns_none(self):
        manager = SessionManager()
        self.assertIsNone(manager.get_session("does-not-exist"))

    def test_sessions_have_unique_ids(self):
        manager = SessionManager()
        a = manager.create_session()
        b = manager.create_session()
        self.assertNotEqual(a.session_id, b.session_id)

    def test_delete_session_removes_it_and_returns_true(self):
        manager = SessionManager()
        session = manager.create_session()

        self.assertTrue(manager.delete_session(session.session_id))
        self.assertIsNone(manager.get_session(session.session_id))

    def test_delete_unknown_session_returns_false(self):
        manager = SessionManager()
        self.assertFalse(manager.delete_session("does-not-exist"))


if __name__ == "__main__":
    unittest.main()
