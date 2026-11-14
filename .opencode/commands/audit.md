---
description: Run ATS compliance, syntax, and keyword audit on an existing tailored output folder or CV file
agent: career-architect
---

Audit the tailored CV and application bundle specified in `$ARGUMENTS` (if empty, inspect the most recent folder under `outputs/`).

1. Run `ats_check` on all CV files (`.md`, `.tex`, `.typ`) in the target folder, checking against the target job keywords recorded in `fitness_report.md` (if present).
2. Delegate to `@ats-auditor` to verify LaTeX/Typst escaping & compilation safety, single-column ATS structure, bullet quantification density, and truthfulness.
3. Report all findings clearly and ask via `question` whether you should apply the recommended fixes automatically.
