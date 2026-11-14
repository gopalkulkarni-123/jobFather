#!/usr/bin/env python3
"""
Extract clean text from local CV / LinkedIn / Job files (.pdf, .docx, .md, .tex, .typ, .txt, .json)
or scan an inputs directory to inventory all available candidate files.
Zero external dependencies required (uses system `pdftotext` for PDFs and stdlib `zipfile`+`xml` for DOCX).
"""

import argparse
import json
import os
import re
import shutil
import subprocess
import sys
import xml.etree.ElementTree as ET
import zipfile
from pathlib import Path

SUPPORTED_EXTENSIONS = {".pdf", ".docx", ".md", ".tex", ".typ", ".txt", ".json", ".csv"}


def extract_pdf(path: Path) -> str:
    pdftotext_bin = shutil.which("pdftotext")
    if pdftotext_bin:
        proc = subprocess.run(
            [pdftotext_bin, "-layout", "-enc", "UTF-8", str(path), "-"],
            capture_output=True,
            text=True,
            timeout=30,
        )
        if proc.returncode == 0 and proc.stdout.strip():
            return clean_text(proc.stdout)

    # Optional Python library fallbacks if installed
    try:
        import pypdf  # type: ignore

        reader = pypdf.PdfReader(str(path))
        pages = [page.extract_text() or "" for page in reader.pages]
        return clean_text("\n\n".join(pages))
    except ImportError:
        pass

    raise RuntimeError(
        f"Could not extract text from PDF '{path}'. Ensure `pdftotext` (poppler-utils) or `pypdf` is installed."
    )


def extract_docx(path: Path) -> str:
    lines: list[str] = []
    with zipfile.ZipFile(path, "r") as zf:
        if "word/document.xml" not in zf.namelist():
            raise ValueError(f"'{path}' is not a valid Word .docx archive (missing word/document.xml).")
        xml_bytes = zf.read("word/document.xml")

    root = ET.fromstring(xml_bytes)
    ns = {"w": "http://schemas.openxmlformats.org/wordprocessingml/2006/main"}

    for elem in root.iter():
        tag = elem.tag.split("}")[-1] if "}" in elem.tag else elem.tag
        if tag == "p":
            runs = [t.text for t in elem.findall(".//w:t", ns) if t.text]
            para = "".join(runs).strip()
            if para:
                lines.append(para)
    return clean_text("\n".join(lines))


def clean_text(raw: str) -> str:
    text = raw.replace("\r\n", "\n").replace("\r", "\n").replace("\x0c", "\n")
    # Collapse runs of >2 blank lines while keeping layout spacing readable
    text = re.sub(r"[ \t]{4,}", "  ", text)
    text = re.sub(r"\n{3,}", "\n\n", text)
    return text.strip()


def parse_single_file(path: Path, max_chars: int = 40000) -> dict:
    ext = path.suffix.lower()
    if not path.exists():
        return {"path": str(path), "status": "error", "error": "File does not exist"}
    if ext not in SUPPORTED_EXTENSIONS:
        return {
            "path": str(path),
            "status": "unsupported",
            "error": f"Unsupported extension '{ext}'. Supported: {sorted(SUPPORTED_EXTENSIONS)}",
        }

    try:
        if ext == ".pdf":
            content = extract_pdf(path)
        elif ext == ".docx":
            content = extract_docx(path)
        else:
            content = clean_text(path.read_text(encoding="utf-8", errors="replace"))

        truncated = len(content) > max_chars
        if truncated:
            content = content[:max_chars] + "\n...[TRUNCATED]..."

        words = len(content.split())
        return {
            "path": str(path),
            "filename": path.name,
            "extension": ext,
            "status": "ok",
            "word_count": words,
            "truncated": truncated,
            "content": content,
        }
    except Exception as exc:
        return {"path": str(path), "filename": path.name, "status": "error", "error": str(exc)}


def main() -> int:
    parser = argparse.ArgumentParser(description="Parse CV, LinkedIn export, or job files into clean text.")
    parser.add_argument("--path", required=True, help="File path or directory path (e.g. inputs/)")
    parser.add_argument("--max-chars", type=int, default=40000, help="Max characters per file")
    args = parser.parse_args()

    target = Path(args.path).expanduser().resolve()
    if not target.exists():
        print(json.dumps({"status": "error", "error": f"Path not found: {target}"}, indent=2))
        return 1

    if target.is_dir():
        files = sorted(
            p
            for p in target.iterdir()
            if p.is_file()
            and p.suffix.lower() in SUPPORTED_EXTENSIONS
            and p.name.lower() not in {"readme.md", "profile.example.json"}
        )
        results = [parse_single_file(f, max_chars=args.max_chars) for f in files]
        print(
            json.dumps(
                {
                    "status": "ok",
                    "directory": str(target),
                    "file_count": len(results),
                    "files": results,
                },
                indent=2,
            )
        )
        return 0

    result = parse_single_file(target, max_chars=args.max_chars)
    print(json.dumps(result, indent=2))
    return 0 if result.get("status") == "ok" else 1


if __name__ == "__main__":
    sys.exit(main())
