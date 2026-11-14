---
description: Compute a fast Baseline Fitness Score and gap breakdown for a target job link before full tailoring
agent: career-architect
---

Run a quick **Pre-Flight Baseline Fitness Assessment** for: `$ARGUMENTS`

1. Parse candidate inputs in `inputs/` via `parse_inputs` (and fetch GitHub via `github_profile` if configured or known; ask via `question` if CV or target job URL/text is missing).
2. Fetch and parse the target job posting via `job_posting`.
3. Compute the **Baseline Fitness Score (0–100)** using the `fitness-rubric` skill (`Hard Skills 35`, `Experience Scope 30`, `Domain Alignment 20`, `Impact & Proof 15`).
4. Present:
   - Score breakdown table
   - Top matching strengths (including relevant GitHub repos)
   - Top missing must-haves / risks
   - Estimated realistic **Post-Tailoring Score Range**
5. Ask via `question` whether the user wants to proceed into the **5+ question `/tailor` interview** to generate the tailored CV and cover letter.
