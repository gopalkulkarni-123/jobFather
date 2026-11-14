---
name: fitness-rubric
description: Transparent 100-point Before & After candidate-to-job Fitness Score methodology and calibration guide.
---

# Candidate Fitness Score Rubric (Before & After)

Compute the candidate's Fitness Score **twice** during every `/tailor` workflow:
1. **Baseline Score (Before Tailoring)**: Evaluated strictly against what is currently visible on the untouched Base CV relative to the target Job Description (JD).
2. **Tailored Score (After Interview & Tailoring)**: Evaluated on the final tailored CV + cover letter after surfacing unstated metrics from the interview, integrating relevant GitHub/LinkedIn proof, and aligning terminology with the JD — **without ever fabricating skills**.

## Weighted 100-Point Breakdown

| Pillar | Max Points | What It Measures |
| :--- | :---: | :--- |
| **1. Hard Skills & Tech Stack** | **35** | Coverage and demonstrated depth (in bullets, not just a keyword list) of required languages, frameworks, infrastructure, and methodologies. |
| **2. Experience Scope & Seniority** | **30** | Years of relevant experience, ownership level, system/project complexity, leadership/mentorship, and direct overlap with core JD responsibilities. |
| **3. Domain & Role Alignment** | **20** | Industry/problem-space familiarity, product vs. platform vs. research orientation, and alignment with the team's mission and pain points. |
| **4. Quantified Impact & Proof** | **15** | Concrete metrics (XYZ/STAR outcomes), verifiable GitHub repositories/open-source proof, publications, or shipped systems. |

## Calibration Anchors (Avoid Score Inflation)

- **85–100 (Strong / High-Priority Match)**: Meets nearly all must-haves + several nice-to-haves with quantified production/research evidence.
- **70–84 (Competitive Match)**: Meets ~75%+ of core requirements; minor gaps are offset by strong adjacent depth or standout GitHub/impact proof.
- **55–69 (Stretch / Partial Match)**: Solid transferable foundation, but missing 1–2 core must-haves or seniority expectations; tailoring + cover letter framing are critical.
- **< 55 (High-Risk / Pivot Match)**: Significant must-have or seniority gap; advise candidate candidly on realistic odds and positioning strategy.

## Hard Calibration Rules

1. **Tailoring lifts presentation and surfaces hidden truth — it cannot invent years of experience.** If a JD requires 7+ years of Rust kernel work and the candidate has 2 years of C++/Python, the Tailored Score can improve via better framing of systems depth, but Pillar 2 must still reflect the genuine seniority gap.
2. **Keyword lists alone earn <= 50% of Pillar 1 points.** Full points require skills to be evidenced inside Experience or Project bullets.
3. **Document every delta** in `fitness_report.md` with a clear Before -> After table explaining *why* each pillar moved (e.g., *"Added GitHub repo `distributed-kv` + latency metrics from Q2: +7 pts in Pillar 4"*).
