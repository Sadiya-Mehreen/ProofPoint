"""Fetches and normalizes a candidate's public GitHub footprint via the REST API.

Uses an authenticated request when GITHUB_TOKEN is set (5,000 requests/hour),
falling back to unauthenticated (60 requests/hour, shared across every caller
on this server's IP -- easy to exhaust with just a couple of lookups, since
each one costs 1 + 2*len(repos analyzed) calls).
"""

import logging
import os
from urllib.parse import parse_qs, urlparse

import httpx

logger = logging.getLogger(__name__)

GITHUB_API_BASE = "https://api.github.com"
MAX_REPOS_TO_ANALYZE = 10
REQUEST_TIMEOUT = 10.0


def _auth_headers() -> dict:
    headers = {"Accept": "application/vnd.github+json"}
    token = os.environ.get("GITHUB_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"
    return headers


class _RateLimitedError(Exception):
    pass


def _raise_if_rate_limited(response: httpx.Response) -> None:
    if response.status_code == 403 and (
        response.headers.get("X-RateLimit-Remaining") == "0" or "Retry-After" in response.headers
    ):
        raise _RateLimitedError()


def _parse_last_page(link_header: str) -> int | None:
    for part in link_header.split(","):
        segment = part.strip()
        if 'rel="last"' not in segment:
            continue
        url_part = segment[segment.index("<") + 1 : segment.index(">")]
        page = parse_qs(urlparse(url_part).query).get("page", [None])[0]
        if page and page.isdigit():
            return int(page)
    return None


def _get_commit_count(client: httpx.Client, owner: str, repo: str) -> int:
    response = client.get(
        f"{GITHUB_API_BASE}/repos/{owner}/{repo}/commits", params={"per_page": 1}
    )
    _raise_if_rate_limited(response)
    if response.status_code != 200:
        logger.warning(
            "Failed to fetch commits for %s/%s: HTTP %s", owner, repo, response.status_code
        )
        return 0

    last_page = _parse_last_page(response.headers.get("Link", ""))
    if last_page is not None:
        return last_page

    return len(response.json())


def _get_languages(client: httpx.Client, owner: str, repo: str) -> list[str]:
    response = client.get(f"{GITHUB_API_BASE}/repos/{owner}/{repo}/languages")
    _raise_if_rate_limited(response)
    if response.status_code != 200:
        logger.warning(
            "Failed to fetch languages for %s/%s: HTTP %s", owner, repo, response.status_code
        )
        return []

    languages = response.json()
    return sorted(languages, key=languages.get, reverse=True)


def _empty_footprint(username: str, error: str) -> dict:
    return {
        "username": username,
        "repositories": [],
        "total_repositories": 0,
        "total_commits": 0,
        "languages": [],
        "error": error,
    }


def get_github_footprint(username: str) -> dict:
    try:
        with httpx.Client(
            timeout=REQUEST_TIMEOUT,
            headers=_auth_headers(),
        ) as client:
            response = client.get(
                f"{GITHUB_API_BASE}/users/{username}/repos",
                params={"per_page": 100, "sort": "updated", "direction": "desc"},
            )

            if response.status_code == 404:
                logger.warning("GitHub user not found: %s", username)
                return _empty_footprint(username, "user_not_found")

            _raise_if_rate_limited(response)

            if response.status_code != 200:
                logger.warning(
                    "Unexpected GitHub API response for %s: HTTP %s",
                    username,
                    response.status_code,
                )
                return _empty_footprint(username, "github_api_error")

            repos = response.json()

            non_forks = [repo for repo in repos if not repo.get("fork")]
            candidates = non_forks if non_forks else repos
            candidates.sort(key=lambda repo: repo.get("updated_at") or "", reverse=True)
            analyzed = candidates[:MAX_REPOS_TO_ANALYZE]

            repositories = []
            total_commits = 0
            all_languages = set()

            for repo in analyzed:
                owner = repo["owner"]["login"]
                name = repo["name"]

                languages = _get_languages(client, owner, name)
                commit_count = _get_commit_count(client, owner, name)

                all_languages.update(languages)
                total_commits += commit_count

                repositories.append(
                    {
                        "name": name,
                        "description": repo.get("description"),
                        "url": repo.get("html_url"),
                        "languages": languages,
                        "commit_count": commit_count,
                        "stars": repo.get("stargazers_count", 0),
                        "forks": repo.get("forks_count", 0),
                        "size_kb": repo.get("size", 0),
                        "updated_at": repo.get("updated_at"),
                    }
                )

            return {
                "username": username,
                "repositories": repositories,
                "total_repositories": len(candidates),
                "total_commits": total_commits,
                "languages": sorted(all_languages),
                "error": None,
            }

    except _RateLimitedError:
        logger.warning("GitHub API rate limit hit while fetching footprint for %s", username)
        return _empty_footprint(username, "rate_limited")
    except httpx.TimeoutException:
        logger.warning("Network timeout while fetching GitHub footprint for %s", username)
        return _empty_footprint(username, "network_error")
    except httpx.RequestError as exc:
        logger.warning("Network error while fetching GitHub footprint for %s: %s", username, exc)
        return _empty_footprint(username, "network_error")
    except Exception:
        logger.exception("Unexpected failure fetching GitHub footprint for %s", username)
        return _empty_footprint(username, "unknown_error")
