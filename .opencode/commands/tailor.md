---
description: Run the full interactive CV + Cover Letter + Fitness Score workflow (with 5+ tailored discovery & design questions)
agent: career-architect
---

Start a new interactive application tailoring session.

User arguments (if any): `$ARGUMENTS`

Follow all 5 phases strictly:
1. Inspect `inputs/` via `parse_inputs` (and check `inputs/profile.json` if present), plus incorporate anything specified in `$ARGUMENTS` (such as a target job URL or GitHub handle). Prompt via `question` for any missing inputs among **CV**, **LinkedIn**, **GitHub**, and **Target Job Link**.
2. Extract GitHub evidence (`github_profile`) and the Job Description (`job_posting`), then present the **Baseline Fitness Score (0–100)** and key gaps.
3. Conduct the **mandatory 5+ question interactive Discovery & Design Interview** using the `question` tool across 2 focused rounds (covering JD skill gaps, concrete bullet metrics, GitHub project spotlighting, cover letter narrative/tone, and `.tex` vs `.typ` + layout decisions). **Do not generate output files until at least 5 questions have been answered.**
4. Generate the tailored `.md` + `.tex`/`.typ` CV, Cover Letter, and Before/After `fitness_report.md` inside `outputs/<yyyy-mm-dd>-<company>-<role>/`, and verify every CV file with `ats_check`.
5. Summarize the Before -> After score improvement and ask via `question` what feedback or revisions the user wants next.
