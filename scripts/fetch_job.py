#!/usr/bin/env python3
"""
Fetch and extract structured text from a target job posting URL (or local file).
Strategies:
  1. Direct public ATS JSON APIs (Greenhouse, Lever) when URL matches known patterns
  2. Schema.org `JobPosting` JSON-LD metadata embedded in HTML `<script type="application/ld+json">`
  3. Clean HTML-to-text body parser stripping scripts/styles/navs
Never bypasses logins, CAPTCHAs, or anti-bot challenges: returns `status: "needs_manual_paste"`
so the agent cleanly prompts the user to paste the job description if gated.
"""

import argparse
import html
import json
import re
import sys
import urllib.error
import urllib.parse
import urllib.request
from html.parser import HTMLParser
from pathlib import Path


class CleanHTMLTextExtractor(HTMLParser):
    SKIP_TAGS = {"script", "style", "noscript", "svg", "nav", "footer", "header", "iframe"}
    BLOCK_TAGS = {"p", "div", "section", "article", "h1", "h2", "h3", "h4", "h5", "h6", "tr", "br", "hr"}

    def __init__(self) -> None:
        super().__init__()
        self._skip_depth = 0
        self._in_json_ld = False
        self._json_ld_buf: list[str] = []
        self.json_ld_blocks: list[str] = []
        self.title = ""
        self._in_title = False
        self.chunks: list[str] = []

    def handle_starttag(self, tag: str, attrs: list[tuple[str, str | None]]) -> None:
        t = tag.lower()
        attr_map = {k.lower(): (v or "") for k, v in attrs}
        if t == "script" and "ld+json" in attr_map.get("type", "").lower():
            self._in_json_ld = True
            self._json_ld_buf = []
            return
        if t in self.SKIP_TAGS:
            self._skip_depth += 1
            return
        if t == "title":
            self._in_title = True
            return
        if self._skip_depth > 0:
            return
        if t in {"h1", "h2", "h3", "h4"}:
            self.chunks.append("\n\n## ")
        elif t == "li":
            self.chunks.append("\n- ")
        elif t in self.BLOCK_TAGS:
            self.chunks.append("\n")

    def handle_endtag(self, tag: str) -> None:
        t = tag.lower()
        if t == "script" and self._in_json_ld:
            self._in_json_ld = False
            raw = "".join(self._json_ld_buf).strip()
            if raw:
                self.json_ld_blocks.append(raw)
            return
        if t in self.SKIP_TAGS and self._skip_depth > 0:
            self._skip_depth -= 1
            return
        if t == "title":
            self._in_title = False
            return
        if self._skip_depth == 0 and t in self.BLOCK_TAGS:
            self.chunks.append("\n")

    def handle_data(self, data: str) -> None:
        if self._in_json_ld:
            self._json_ld_buf.append(data)
            return
        if self._in_title:
            self.title += data
            return
        if self._skip_depth == 0:
            self.chunks.append(data)

    def get_text(self) -> str:
        raw = html.unescape("".join(self.chunks))
        raw = re.sub(r"[ \t]+", " ", raw)
        raw = re.sub(r"\n[ \t]+", "\n", raw)
        raw = re.sub(r"\n{3,}", "\n\n", raw)
        return raw.strip()


def strip_html_fragment(fragment: str) -> str:
    parser = CleanHTMLTextExtractor()
    parser.feed(fragment)
    return parser.get_text()


def try_ats_json_api(url: str) -> dict | None:
    parsed = urllib.parse.urlparse(url)
    host = parsed.netloc.lower()
    parts = [p for p in parsed.path.split("/") if p]

    # Greenhouse: boards.greenhouse.io/<board>/jobs/<id> or job-boards.greenhouse.io/<board>/jobs/<id>
    if "greenhouse.io" in host and len(parts) >= 3 and parts[1] == "jobs":
        board, job_id = parts[0], parts[2]
        api_url = f"https://boards-api.greenhouse.io/v1/boards/{board}/jobs/{job_id}"
        try:
            data = json.loads(http_fetch(api_url))
            content = strip_html_fragment(html.unescape(data.get("content", "")))
            if content:
                return {
                    "source_method": "greenhouse_public_api",
                    "title": data.get("title"),
                    "company": board,
                    "location": (data.get("location") or {}).get("name"),
                    "content": content,
                }
        except Exception:
            pass

    # Lever: jobs.lever.co/<company>/<uuid>
    if "jobs.lever.co" in host and len(parts) >= 2:
        company, job_id = parts[0], parts[1]
        api_url = f"https://api.lever.co/v0/postings/{company}/{job_id}?mode=json"
        try:
            data = json.loads(http_fetch(api_url))
            sections = [strip_html_fragment(data.get("description", ""))]
            for lst in data.get("lists") or []:
                sections.append(f"## {lst.get('text', '')}\n" + strip_html_fragment(lst.get("content", "")))
            if data.get("additional"):
                sections.append(strip_html_fragment(data["additional"]))
            content = "\n\n".join(s for s in sections if s).strip()
            if content:
                return {
                    "source_method": "lever_public_api",
                    "title": data.get("text"),
                    "company": company,
                    "location": (data.get("categories") or {}).get("location"),
                    "content": content,
                }
        except Exception:
            pass

    return None


def find_job_posting_ld(obj: object) -> dict | None:
    if isinstance(obj, dict):
        t = obj.get("@type")
        types = [t] if isinstance(t, str) else (t if isinstance(t, list) else [])
        if any("JobPosting" in str(x) for x in types):
            return obj
        for val in obj.values():
            found = find_job_posting_ld(val)
            if found:
                return found
    elif isinstance(obj, list):
        for item in obj:
            found = find_job_posting_ld(item)
            if found:
                return found
    return None


def http_fetch(url: str) -> str:
    req = urllib.request.Request(
        url,
        headers={
            "User-Agent": "Mozilla/5.0 (compatible; CVTailorBot/1.0)",
            "Accept": "text/html,application/json;q=0.9,*/*;q=0.8",
            "Accept-Language": "en-US,en;q=0.9",
        },
    )
    with urllib.request.urlopen(req, timeout=20) as resp:
        return resp.read().decode("utf-8", errors="replace")


def parse_html_job(raw_html: str, source_url: str = "") -> dict:
    extractor = CleanHTMLTextExtractor()
    extractor.feed(raw_html)

    # Check JSON-LD JobPosting first
    for block in extractor.json_ld_blocks:
        try:
            parsed_ld = json.loads(block)
            jp = find_job_posting_ld(parsed_ld)
            if jp:
                org = jp.get("hiringOrganization")
                company = org.get("name") if isinstance(org, dict) else str(org or "")
                desc = strip_html_fragment(str(jp.get("description") or ""))
                quals = strip_html_fragment(str(jp.get("qualifications") or ""))
                resps = strip_html_fragment(str(jp.get("responsibilities") or ""))
                combined = "\n\n".join(x for x in [desc, quals, resps] if x).strip()
                if len(combined.split()) >= 20:
                    return {
                        "status": "ok",
                        "url": source_url,
                        "source_method": "schema_org_json_ld",
                        "title": jp.get("title") or extractor.title.strip(),
                        "company": company,
                        "date_posted": jp.get("datePosted"),
                        "employment_type": jp.get("employmentType"),
                        "word_count": len(combined.split()),
                        "content": combined[:35000],
                    }
        except Exception:
            continue

    body_text = extractor.get_text()
    lower_text = body_text.lower()
    challenge_markers = ["verify you are human", "enable javascript and cookies", "captcha", "cf-chl"]
    if any(m in lower_text for m in challenge_markers) and len(body_text.split()) < 150:
        return {
            "status": "needs_manual_paste",
            "url": source_url,
            "reason": "Target site gated by anti-bot challenge or login wall.",
            "instruction": "Do NOT attempt to bypass. Ask the user via the `question` tool to paste the job description text (or save it to `inputs/job.txt`).",
        }

    if len(body_text.split()) < 60:
        return {
            "status": "needs_manual_paste",
            "url": source_url,
            "reason": "Page appears to be a client-side JavaScript SPA with <60 words in static HTML.",
            "extracted_preview": body_text[:400],
            "instruction": "Try OpenCode's `webfetch` tool once; if still empty, ask the user via `question` to paste the job description text.",
        }

    return {
        "status": "ok",
        "url": source_url,
        "source_method": "html_body_text",
        "title": extractor.title.strip(),
        "word_count": len(body_text.split()),
        "content": body_text[:35000],
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Fetch or parse a job description.")
    parser.add_argument("--url", help="Target job posting URL")
    parser.add_argument("--file", help="Local HTML or text file containing the job posting")
    args = parser.parse_args()

    if args.file:
        path = Path(args.file).expanduser().resolve()
        if not path.exists():
            print(json.dumps({"status": "error", "error": f"File not found: {path}"}, indent=2))
            return 1
        raw = path.read_text(encoding="utf-8", errors="replace")
        if path.suffix.lower() in {".html", ".htm"}:
            print(json.dumps(parse_html_job(raw, source_url=str(path)), indent=2))
        else:
            print(
                json.dumps(
                    {
                        "status": "ok",
                        "source_method": "local_text_file",
                        "path": str(path),
                        "word_count": len(raw.split()),
                        "content": raw.strip()[:35000],
                    },
                    indent=2,
                )
            )
        return 0

    if not args.url:
        print(json.dumps({"status": "error", "error": "Provide either --url or --file"}, indent=2))
        return 1

    ats_result = try_ats_json_api(args.url)
    if ats_result:
        ats_result["status"] = "ok"
        ats_result["url"] = args.url
        ats_result["word_count"] = len(ats_result["content"].split())
        print(json.dumps(ats_result, indent=2))
        return 0

    try:
        raw_html = http_fetch(args.url)
        result = parse_html_job(raw_html, source_url=args.url)
        print(json.dumps(result, indent=2))
        return 0
    except urllib.error.HTTPError as exc:
        print(
            json.dumps(
                {
                    "status": "needs_manual_paste",
                    "url": args.url,
                    "http_status": exc.code,
                    "reason": f"HTTP {exc.code} ({exc.reason}) returned by job board.",
                    "instruction": "Do NOT attempt to bypass auth/blocks. Ask the user via the `question` tool to paste the job description text.",
                },
                indent=2,
            )
        )
        return 0
    except Exception as exc:
        print(
            json.dumps(
                {
                    "status": "needs_manual_paste",
                    "url": args.url,
                    "reason": str(exc),
                    "instruction": "Ask the user via the `question` tool to paste the job description text.",
                },
                indent=2,
            )
        )
        return 0


if __name__ == "__main__":
    sys.exit(main())
