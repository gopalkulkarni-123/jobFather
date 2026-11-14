---
name: ats-optimization
description: ATS parsing standards, XYZ bullet engineering, and LaTeX/Typst/Markdown compliance rules for high-conversion resumes and cover letters.
---

# ATS Optimization & Document Engineering Rules

Modern Applicant Tracking Systems (Workday, Greenhouse, Lever, iCIMS, Ashby, Taleo) parse text streams top-to-bottom and extract structured entities (Contact, Work History, Titles, Dates, Skills, Education) before ranking keyword/semantic match and presenting a parsed view to recruiters.

## 1. Structural & Layout Invariants

- **Strictly Single-Column**: Never use multi-column layouts, sidebars, `multicols`, `minipage` columns, Typst `#columns(2)`, or layout tables. Multi-column PDFs frequently cause parsers to merge left-column skill words into right-column job dates.
- **Standard Section Headings Only**: Use exact, unambiguous headers:
  - `Summary` (optional, 2–3 lines tailored to target role)
  - `Experience`
  - `Projects`
  - `Skills`
  - `Education`
  - `Certifications` / `Publications` (only when applicable)
- **Clean Date & Role Formatting**:
  - Consistent `Mon YYYY – Mon YYYY` or `Mon YYYY – Present` format (e.g., `Jan 2024 – Present`).
  - Keep **Company Name**, **Job Title**, **Location**, and **Date Range** clearly separated on standard lines.
- **Zero Graphics / Icons / Skill Bars**:
  - Never include headshots, company logos, progress bars (`80% Python`), or icon-only contact items (write `github.com/user` and `linkedin.com/in/user` explicitly in plain text).

## 2. Keyword & Semantic Alignment

- **Mirror Exact JD Terminology + Acronyms**: Include both full form and acronym at least once when relevant (e.g., `Continuous Integration / Continuous Deployment (CI/CD)`, `Retrieval-Augmented Generation (RAG)`).
- **Evidence Over Keyword Dumping**: Every critical JD skill listed in `Skills` should ideally appear in context inside at least one `Experience` or `Projects` bullet.
- **Never Keyword-Stuff**: Keep language natural for human hiring managers; never use hidden white text or repetitive unnatural lists.

## 3. Bullet Engineering (Google XYZ Formula)

Rewrite bullets using **Accomplished [X] as measured by [Y], by doing [Z]**:
- Start every bullet with a high-agency past-tense action verb (`Architected`, `Reduced`, `Automated`, `Scaled`, `Spearheaded`, `Optimized`, `Shipped`) — present tense only for active ongoing ownership if appropriate, though past tense for completed achievements is preferred.
- Eliminate weak openers (`Responsible for`, `Helped with`, `Worked on`, `Assisted in`).
- Keep bullets to **1–2 lines (16–32 words)** for effortless 6-second recruiter scanning.

## 4. Source Format Specifics

### LaTeX (`.tex`)
- Always base on `templates/cv_template.tex` (clean `article` class, zero obscure non-CTAN packages).
- **Mandatory preamble lines**:
  ```latex
  \input{glyphtounicode}
  \pdfgentounicode=1
  ```
- Escape all LaTeX special characters properly (`\%`, `\&`, `\$`, `\#`, `\_`) so `pdflatex` / Overleaf compiles cleanly on the first run!

### Typst (`.typ`)
- Always base on `templates/cv_template.typ`.
- Escape literal `$`, `#`, `@`, and `*` inside prose when not used as Typst markup (e.g., `\$120K`, `C\#`).
- Use standard `= Section` headings so PDF document outline/tags remain hierarchical and machine-readable.

### Cover Letter Best Practices
- **250–350 words (3–4 tight paragraphs)** — never rehash the CV chronologically.
- **Paragraph 1 (Hook)**: Target role, why this specific company/problem matters to the candidate, and a 1-sentence thesis of value.
- **Paragraphs 2–3 (Proof Stories)**: 1–2 concrete engineering/domain stories (with metrics or GitHub proof) directly solving the core challenges in the JD.
- **Paragraph 4 (Call to Action)**: Crisp, confident close without clichés.
