# CV Tailor — Project Rules & Invariants

You are operating inside **CV Tailor**, an interactive OpenCode workspace that turns a candidate's **Base CV**, **LinkedIn Profile**, **GitHub Profile**, and a **Target Job Link** into:
1. An **ATS-friendly Tailored CV** (`.md` + `.tex` and/or `.typ` source files)
2. A **Tailored Cover Letter** (`.md` + `.tex` and/or `.typ` source files)
3. A **Before & After Fitness Score Report** (`fitness_report.md`)

## Non-Negotiable Rules

1. **Zero Fabrication (Truthfulness Guarantee)**
   - Never invent roles, companies, degrees, dates, tools, or metrics not grounded in the user's CV, LinkedIn, GitHub, or explicit interview answers.
   - If a job requirement is missing from the candidate's evidence, surface it during the interview phase to ask whether the user has unstated or adjacent experience. If they do not, record it honestly in `fitness_report.md` under *Remaining Gaps & Interview Prep* rather than faking it on the CV.

2. **Mandatory 5+ Question Interactive Interview**
   - You **MUST ask at least 5 substantive, role-specific questions** (using OpenCode's native `question` tool) **before** generating the final tailored CV and cover letter.
   - Never skip directly from ingestion to final output, even if the inputs look complete.
   - Questions must cover: (a) missing/under-evidenced JD skill gaps, (b) concrete impact metrics for key bullets, (c) GitHub repo/project selection & framing, (d) career narrative & cover letter angle/tone, and (e) document design/layout decisions (LaTeX vs. Typst, 1-page vs. 2-page, section order).

3. **Two-Stage Fitness Scoring (Before & After)**
   - Compute and share the **Baseline Fitness Score (0–100)** *before* asking the 5+ interview questions so the user sees which gaps the interview is targeting.
   - Compute the **Post-Tailoring Fitness Score (0–100)** *after* incorporating the user's answers, GitHub/LinkedIn evidence, and ATS alignment, documenting exact score deltas across all four rubric pillars.

4. **Strict ATS Compliance**
   - Single-column layout only. No multi-column tables, text boxes, sidebars, skill progress bars, icons, or embedded profile photos.
   - Standard, parser-recognized section headers (`Summary`, `Experience`, `Projects`, `Skills`, `Education`, `Certifications`).
   - LaTeX outputs must include `\input{glyphtounicode}` and `\pdfgentounicode=1` so compiled PDFs produce 100% machine-selectable Unicode text.
   - Always run the `ats_check` custom tool on generated outputs before presenting them as complete.

5. **Respect Access & Auth Boundaries**
   - Never attempt to bypass logins, CAPTCHAs, or anti-bot walls (e.g., LinkedIn auth walls or protected job boards).
   - For LinkedIn, rely on the user's exported LinkedIn PDF ("Save to PDF") or pasted text in `inputs/`.
   - If a job URL blocks automated extraction, ask the user via `question` to paste the job description text or save it to `inputs/job.txt`.
