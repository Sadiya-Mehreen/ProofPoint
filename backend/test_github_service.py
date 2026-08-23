import unittest
from unittest.mock import patch

import httpx

from services.github_service import get_github_footprint


class GithubFootprintTests(unittest.TestCase):
    def test_valid_public_username_returns_populated_footprint(self):
        result = get_github_footprint("octocat")

        self.assertIsNone(result["error"])
        self.assertEqual(result["username"], "octocat")
        self.assertGreater(len(result["repositories"]), 0)
        self.assertGreaterEqual(result["total_repositories"], len(result["repositories"]))

        repo = result["repositories"][0]
        for key in (
            "name",
            "description",
            "url",
            "languages",
            "commit_count",
            "stars",
            "forks",
            "size_kb",
            "updated_at",
        ):
            self.assertIn(key, repo)

    def test_nonexistent_username_returns_user_not_found(self):
        result = get_github_footprint("this-user-almost-certainly-does-not-exist-xyz-123456789")

        self.assertEqual(result["error"], "user_not_found")
        self.assertEqual(result["repositories"], [])
        self.assertEqual(result["total_repositories"], 0)

    def test_network_failure_returns_network_error(self):
        with patch(
            "httpx.Client.get", side_effect=httpx.TimeoutException("connection timed out")
        ):
            result = get_github_footprint("octocat")

        self.assertEqual(result["error"], "network_error")
        self.assertEqual(result["repositories"], [])


if __name__ == "__main__":
    unittest.main()
