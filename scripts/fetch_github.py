#!/usr/bin/env python3
"""
Fetch a candidate's public GitHub profile, top/recent repositories, languages, topics,
and README excerpts via the public GitHub REST API.
Supports optional GITHUB_TOKEN environment variable for higher rate limits.
"""

import argparse
import json
import os
import re
import sys
import urllib.error
import urllib.parse
import urllib.request


def extract_username(raw: str) -> str:
    cleaned = raw.strip().rstrip("/")
    cleaned = re.sub(r"^@", "", cleaned)
    if "github.com/" in cleaned.lower():
        parsed = urllib.parse.urlparse(cleaned if "://" in cleaned else f"https://{cleaned}")
        parts = [p for p in parsed.path.split("/") if p]
        if parts:
            return parts[0]
    return cleaned


def github_get(url: str, accept: str = "application/vnd.github+json") -> object:
    headers = {
        "Accept": accept,
        "User-Agent": "cv-tailor-opencode-tool/1.0",
        "X-GitHub-Api-Version": "2022-11-28",
    }
    token = os.environ.get("GITHUB_TOKEN") or os.environ.get("GH_TOKEN")
    if token:
        headers["Authorization"] = f"Bearer {token}"

    req = urllib.request.Request(url, headers=headers)
    with urllib.request.urlopen(req, timeout=20) as resp:
        raw = resp.read().decode("utf-8", errors="replace")
        if "raw" in accept:
            return raw
        return json.loads(raw)


def clean_readme(markdown_text: str, max_chars: int = 1500) -> str:
    # Strip HTML badges/images and excessive whitespace to keep high-signal technical content
    text = re.sub(r"!\[[^\]]*\]\([^)]*\)", "", markdown_text)
    text = re.sub(r"<img[^>]*>", "", text, flags=re.IGNORECASE)
    text = re.sub(r"\n{3,}", "\n\n", text).strip()
    if len(text) > max_chars:
        return text[:max_chars] + "\n...[README excerpt truncated]..."
    return text


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch GitHub profile and repository evidence.")
    parser.add_argument("--user", required=True, help="GitHub username or profile URL")
    parser.add_argument("--max-repos", type=int, default=10, help="Max top repositories to return")
    parser.add_argument("--readme-repos", type=int, default=5, help="Number of top repos to fetch README excerpts for")
    args = parser.parse_args()

    username = extract_username(args.user)
    if not username or not re.match(r"^[A-Za-z0-9-]+$", username):
        print(json.dumps({"status": "error", "error": f"Invalid GitHub username extracted from '{args.user}'"}, indent=2))
        return 1

    try:
        user_data = github_get(f"https://api.github.com/users/{username}")
        assert isinstance(user_data, dict)
        repos_data = github_get(f"https://api.github.com/users/{username}/repos?per_page=100&sort=updated")
        assert isinstance(repos_data, list)
    except urllib.error.HTTPError as exc:
        body = exc.read().decode("utf-8", errors="replace")[:400]
        print(
            json.dumps(
                {
                    "status": "error",
                    "username": username,
                    "http_status": exc.code,
                    "error": f"GitHub API HTTP {exc.code}: {exc.reason}",
                    "details": body,
                },
                indent=2,
            )
        )
        return 1
    except Exception as exc:
        print(json.dumps({"status": "error", "username": username, "error": str(exc)}, indent=2))
        return 1

    # Prioritize original (non-fork) repos, sorted by stars + recency
    non_forks = [r for r in repos_data if isinstance(r, dict) and not r.get("fork") and not r.get("archived")]
    forks = [r for r in repos_data if isinstance(r, dict) and r.get("fork") and (r.get("stargazers_count", 0) >= 2)]

    def repo_score(r: dict) -> tuple:
        stars = int(r.get("stargazers_count") or 0)
        has_desc = 1 if (r.get("description") or "").strip() else 0
        pushed = str(r.get("pushed_at") or "")
        return (stars > 0, stars, has_desc, pushed)

    ranked = sorted(non_forks, key=repo_score, reverse=True)[: args.max_repos]
    if len(ranked) < args.max_repos and forks:
        ranked.extend(sorted(forks, key=repo_score, reverse=True)[: args.max_repos - len(ranked)])

    # Aggregate language counts across all non-fork repos
    language_counts: dict[str, int] = {}
    for r in non_forks:
        lang = r.get("language")
        if lang:
            language_counts[lang] = language_counts.get(lang, 0) + 1

    summarized_repos = []
    for idx, r in enumerate(ranked):
        repo_name = r.get("name", "")
        entry = {
            "name": repo_name,
            "html_url": r.get("html_url"),
            "description": r.get("description") or "",
            "language": r.get("language"),
            "topics": r.get("topics") or [],
            "stars": r.get("stargazers_count", 0),
            "forks": r.get("forks_count", 0),
            "is_fork": bool(r.get("fork")),
            "pushed_at": r.get("pushed_at"),
            "homepage": r.get("homepage") or "",
        }
        if idx < args.readme_repos and repo_name:
            try:
                readme_raw = github_get(
                    f"https://api.github.com/repos/{username}/{repo_name}/readme",
                    accept="application/vnd.github.raw+json",
                )
                if isinstance(readme_raw, str) and readme_raw.strip():
                    entry["readme_excerpt"] = clean_readme(readme_raw)
            except Exception:
                pass
        summarized_repos.append(entry)

    output = {
        "status": "ok",
        "profile": {
            "username": user_data.get("login", username),
            "name": user_data.get("name"),
            "bio": user_data.get("bio"),
            "company": user_data.get("company"),
            "location": user_data.get("location"),
            "blog": user_data.get("blog"),
            "html_url": user_data.get("html_url"),
            "public_repos": user_data.get("public_repos"),
            "followers": user_data.get("followers"),
        },
        "top_languages_by_repo_count": dict(
            sorted(language_counts.items(), key=lambda kv: kv[1], reverse=True)
        ),
        "repositories": summarized_repos,
    }
    print(json.dumps(output, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
