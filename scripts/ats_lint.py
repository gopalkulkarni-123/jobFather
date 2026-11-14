#!/usr/bin/env python3
"""
Deterministic ATS Compliance & Quality Linter for Markdown (.md), LaTeX (.tex), and Typst (.typ) CVs.
Checks:
  1. Contact info presence (email, phone/location, GitHub/LinkedIn)
  2. Standard ATS-parseable section headings (Experience, Education, Skills, Projects)
  3. Format-specific ATS hazards (multi-column layouts, tables, images/icons, missing LaTeX glyphtounicode)
  4. Bullet-point quality (quantified metrics ratio, weak passive openers, bullet word length)
  5. Target keyword coverage & anti-keyword-stuffing density checks
"""

import argparse
import json
import re
import sys
from pathlib import Path

STANDARD_SECTIONS = {
    "experience": ["experience", "work experience", "professional experience", "employment"],
    "education": ["education", "academic background"],
    "skills": ["skills", "technical skills", "core competencies", "technologies"],
    "projects": ["projects", "selected projects", "open source", "engineering projects"],
    "summary": ["summary", "professional summary", "profile"],
}

WEAK_OPENERS = [
    "responsible for",
    "helped with",
    "worked on",
    "assisted with",
    "participated in",
    "duties included",
    "tasked with",
]

METRIC_PATTERN = re.compile(
    r"(\b\d+(\.\d+)?\s*(%|x|ms|s|sec|min|hrs?|days?|weeks?|months?|k|m|b|gb|tb|mb|qps|rps|users|clients|repos|services|engineers|developers|pipelines|endpoints)\b|\$\s*\d+|\b\d{2,}\+?)",
    re.IGNORECASE,
)


def strip_markup(raw: str, ext: str) -> str:
    text = raw
    if ext == ".tex":
        text = re.sub(r"%.*$", "", text, flags=re.MULTILINE)
        text = re.sub(r"\\(textbf|textit|emph|underline|href|textsc|large|Large|small)\{([^}]*)\}", r"\2", text)
        text = re.sub(r"\\[a-zA-Z]+\*?(\[[^\]]*\])?", " ", text)
        text = text.replace("{", " ").replace("}", " ")
    elif ext == ".typ":
        text = re.sub(r"(?<!:)//.*$", "", text, flags=re.MULTILINE)
        text = re.sub(r"#set\s+[^\n]+", " ", text)
        text = re.sub(r"#show\s+[^\n]+", " ", text)
        text = re.sub(r"#[a-zA-Z0-9_-]+", " ", text)
    return text


def extract_bullets(raw: str, ext: str) -> list[str]:
    bullets: list[str] = []
    in_skills_section = False
    for line in raw.splitlines():
        s = line.strip()
        # Track current section so Skills category lists aren't scored as Experience/Project bullets
        sec_match = (
            re.match(r"^\\section\*?\{([^}]+)\}", s)
            if ext == ".tex"
            else re.match(r"^={1,3}\s+(.+)$", s)
            if ext == ".typ"
            else re.match(r"^#{1,3}\s+(.+)$", s)
        )
        if sec_match:
            sec_title = sec_match.group(1).strip().lower()
            in_skills_section = any(k in sec_title for k in STANDARD_SECTIONS["skills"]) or any(
                k in sec_title for k in STANDARD_SECTIONS["education"]
            )
            continue
        if in_skills_section:
            continue

        if ext == ".tex":
            m = re.match(r"^\\(resumeItem|item)\s*\{?(.*)$", s)
            if m:
                cleaned = strip_markup(m.group(2), ext).strip(" }")
                if len(cleaned.split()) >= 4:
                    bullets.append(cleaned)
        elif ext == ".typ":
            if s.startswith("- ") and not s.startswith("---"):
                cleaned = strip_markup(s[2:], ext).strip()
                if len(cleaned.split()) >= 4:
                    bullets.append(cleaned)
        else:
            m = re.match(r"^[-*•]\s+(.*)$", s)
            if m:
                cleaned = re.sub(r"\*\*([^*]+)\*\*", r"\1", m.group(1)).strip()
                if len(cleaned.split()) >= 4:
                    bullets.append(cleaned)
    return bullets


def extract_headings(raw: str, ext: str) -> list[str]:
    headings: list[str] = []
    if ext == ".tex":
        for m in re.finditer(r"\\section\*?\{([^}]+)\}", raw):
            headings.append(strip_markup(m.group(1), ext).strip().lower())
    elif ext == ".typ":
        for m in re.finditer(r"^={1,3}\s+(.+)$", raw, flags=re.MULTILINE):
            headings.append(strip_markup(m.group(1), ext).strip().lower())
    else:
        for m in re.finditer(r"^#{1,3}\s+(.+)$", raw, flags=re.MULTILINE):
            headings.append(re.sub(r"[*_`]", "", m.group(1)).strip().lower())
    return headings


def check_format_hazards(raw: str, ext: str) -> tuple[list[str], list[str]]:
    errors: list[str] = []
    warnings: list[str] = []

    if ext == ".tex":
        if "pdfgentounicode" not in raw and "glyphtounicode" not in raw:
            warnings.append(
                "LaTeX file is missing `\\input{glyphtounicode}` and `\\pdfgentounicode=1` — compiled PDFs may fail ATS Unicode text extraction."
            )
        if re.search(r"\\begin\{(multicols|paracol|minipage)\}", raw) or "twocolumn" in raw:
            errors.append(
                "Multi-column / minipage layout detected in LaTeX. Many legacy ATS parsers scramble reading order across columns."
            )
        if re.search(r"\\includegraphics", raw):
            errors.append("Embedded image (`\\includegraphics`) detected — remove photos/logos/icons for ATS safety.")
    elif ext == ".typ":
        if re.search(r"columns\s*:\s*[2-9]", raw) or re.search(r"#columns\(\s*[2-9]", raw):
            errors.append("Multi-column layout detected in Typst. Keep CV strictly single-column for ATS parsing.")
        if re.search(r"#image\s*\(", raw):
            errors.append("Embedded `#image(...)` detected in Typst — remove images/headshots for ATS safety.")
    else:
        if "<table" in raw.lower() or re.search(r"^\|.+\|.+\|$", raw, flags=re.MULTILINE):
            warnings.append("Table markup detected in Markdown CV — avoid layout tables in ATS-facing CVs.")
        if re.search(r"!\[[^\]]*\]\([^)]+\)", raw):
            errors.append("Embedded Markdown image detected — remove images/headshots for ATS safety.")

    return errors, warnings


def evaluate_keywords(plain_cv: str, keywords: list[str]) -> dict:
    lower_cv = plain_cv.lower()
    total_words = max(len(plain_cv.split()), 1)
    matched: list[str] = []
    missing: list[str] = []
    stuffing_warnings: list[str] = []

    for kw in keywords:
        term = kw.strip()
        if not term:
            continue
        pattern = re.compile(r"(?<![a-zA-Z0-9])" + re.escape(term.lower()) + r"(?![a-zA-Z0-9])")
        hits = len(pattern.findall(lower_cv))
        if hits > 0:
            matched.append(term)
            density = (hits * len(term.split())) / total_words
            if hits >= 8 and density > 0.025:
                stuffing_warnings.append(
                    f"Keyword '{term}' appears {hits} times ({density*100:.1f}% density) — risk of ATS keyword-stuffing penalty."
                )
        else:
            missing.append(term)

    total = len(matched) + len(missing)
    coverage_pct = round((len(matched) / total) * 100, 1) if total else 100.0
    return {
        "total_checked": total,
        "matched_count": len(matched),
        "coverage_percent": coverage_pct,
        "matched": matched,
        "missing": missing,
        "stuffing_warnings": stuffing_warnings,
    }


def main() -> int:
    parser = argparse.ArgumentParser(description="Lint CV source file (.md, .tex, .typ) for ATS compliance.")
    parser.add_argument("--cv", required=True, help="Path to tailored CV (.md, .tex, or .typ)")
    parser.add_argument("--keywords", default="", help="Comma-separated target JD keywords to verify")
    args = parser.parse_args()

    cv_path = Path(args.cv).expanduser().resolve()
    if not cv_path.exists():
        print(json.dumps({"status": "error", "error": f"CV file not found: {cv_path}"}, indent=2))
        return 1

    ext = cv_path.suffix.lower()
    raw = cv_path.read_text(encoding="utf-8", errors="replace")
    plain = strip_markup(raw, ext)
    headings = extract_headings(raw, ext)
    bullets = extract_bullets(raw, ext)

    errors, warnings = check_format_hazards(raw, ext)

    # Contact checks
    has_email = bool(re.search(r"[A-Za-z0-9._%+-]+@[A-Za-z0-9.-]+\.[A-Za-z]{2,}", raw))
    has_github = "github.com" in raw.lower()
    has_linkedin = "linkedin.com" in raw.lower()
    if not has_email:
        errors.append("Missing email address in CV contact header.")
    if not has_linkedin:
        warnings.append("LinkedIn URL not found in CV header.")
    if not has_github:
        warnings.append("GitHub URL not found in CV header.")

    # Section checks
    detected_sections: dict[str, bool] = {}
    for canonical, aliases in STANDARD_SECTIONS.items():
        detected_sections[canonical] = any(
            any(alias == h or alias in h for alias in aliases) for h in headings
        )
    for req_sec in ("experience", "education", "skills"):
        if not detected_sections.get(req_sec):
            warnings.append(
                f"Standard ATS section heading for '{req_sec.title()}' not clearly detected (found headings: {headings})."
            )

    # Bullet quality checks
    quantified_count = sum(1 for b in bullets if METRIC_PATTERN.search(b))
    quantified_pct = round((quantified_count / len(bullets)) * 100, 1) if bullets else 0.0
    weak_bullets = [
        b[:90] for b in bullets if any(b.lower().startswith(w) for w in WEAK_OPENERS)
    ]
    long_bullets = [b[:90] for b in bullets if len(b.split()) > 36]

    if bullets and quantified_pct < 45.0:
        warnings.append(
            f"Only {quantified_pct}% ({quantified_count}/{len(bullets)}) of bullets include concrete metrics. Aim for >=50%."
        )
    if weak_bullets:
        warnings.append(f"{len(weak_bullets)} bullet(s) start with passive phrasing (e.g. '{weak_bullets[0]}...').")
    if long_bullets:
        warnings.append(f"{len(long_bullets)} bullet(s) exceed 36 words — tighten for 6-second recruiter scan.")

    kw_list = [k.strip() for k in args.keywords.split(",") if k.strip()]
    kw_report = evaluate_keywords(plain, kw_list) if kw_list else None
    if kw_report and kw_report["stuffing_warnings"]:
        warnings.extend(kw_report["stuffing_warnings"])

    ats_ready = len(errors) == 0
    result = {
        "status": "ok",
        "file": str(cv_path),
        "format": ext,
        "ats_compliant": ats_ready,
        "word_count": len(plain.split()),
        "contact_checks": {
            "email": has_email,
            "linkedin": has_linkedin,
            "github": has_github,
        },
        "sections_detected": detected_sections,
        "headings_found": headings,
        "bullet_metrics": {
            "total_bullets": len(bullets),
            "quantified_bullets": quantified_count,
            "quantified_percent": quantified_pct,
            "weak_opener_count": len(weak_bullets),
            "overlong_bullet_count": len(long_bullets),
        },
        "keyword_check": kw_report,
        "errors": errors,
        "warnings": warnings,
    }
    print(json.dumps(result, indent=2))
    return 0


if __name__ == "__main__":
    sys.exit(main())
