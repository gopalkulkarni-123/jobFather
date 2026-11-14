---
name: discovery-interview
description: Methodology for conducting the mandatory 5+ question interactive candidate discovery and design interview using OpenCode's question tool.
---

# Discovery & Design Interview Protocol (Minimum 5 Questions)

Never generate final CV or cover letter files before completing a structured discovery interview with the candidate. Every question must be **grounded in actual findings** from comparing the candidate's CV + LinkedIn + GitHub against the target Job Description (JD).

## Delivery Mechanics in OpenCode

- Always use the built-in `question` tool so the user gets interactive options alongside free-text custom input.
- Split the interview into **2 focused rounds** (typically **3–4 questions in Round 1** and **2–4 questions in Round 2**, totaling **5 to 8 questions**) so each prompt stays digestible while exceeding the 5-question minimum.
- Number questions cumulatively (`Q1`, `Q2`, ..., `Q6`) so progress is transparent.

## Mandatory Question Categories

### Round 1: Evidence Gaps, Hidden Metrics & Technical Proof (3–4 Questions)

1. **Critical JD Gap Probe (`Q1`)**
   - Identify the top 1–3 must-have skills, tools, or responsibilities in the JD that are absent or weakly evidenced in the base CV/LinkedIn/GitHub.
   - Ask specifically whether the candidate has hands-on, adjacent, or academic experience with them that wasn't written down.
   - Include an honest option like *"No direct experience — keep off CV and address transferable skills in cover letter"*.

2. **Quantified Impact & Scale Extraction (`Q2`)**
   - Pick 1–2 of the candidate's most relevant roles/bullets that currently read like task descriptions rather than outcomes.
   - Ask for concrete metrics: latency/throughput gains, cost/time saved, dataset/cluster/traffic scale, users served, revenue impact, or team size.

3. **GitHub & Project Selection (`Q3`)**
   - Reference actual repositories discovered via `github_profile` (plus projects on CV/LinkedIn) and explain briefly why specific repos match the JD.
   - Ask which 2–3 projects to spotlight and whether any private/work architecture details should be emphasized instead.

4. **Cross-Source Discrepancy or Domain Depth Follow-Up (`Q4`, when applicable)**
   - Resolve differences noticed between CV and LinkedIn (e.g., titles, dates, missing roles/certifications, recent tech stack shifts) or probe deeper into a domain requirement from the JD.

### Round 2: Narrative Positioning, Cover Letter Strategy & Document Design (2–4 Questions)

5. **Positioning Angle & Cover Letter Hook (`Q5`)**
   - Propose 3 tailored narrative angles suited to this company/role (e.g., *Production Systems & Scale*, *0-to-1 Product Velocity*, *Applied Research-to-Production*, *Cross-Functional Technical Leadership*).
   - Ask what genuinely draws the candidate to this company/mission and their preferred cover letter tone (*Crisp & Direct*, *Warm & Story-Driven*, *Executive & Formal*).

6. **Typesetting & Format Selection (`Q6`)**
   - Ask which typeset source format(s) to generate alongside the `.md` files:
     - **LaTeX (`.tex`)** — classic single-column ATS-safe academic/engineering standard (Overleaf / `pdflatex` ready)
     - **Typst (`.typ`)** — modern, clean, fast-compiling markup (`typst compile` ready)
     - **Both `.tex` and `.typ`** (plus `.md`)

7. **Layout & Content Architecture Decisions (`Q7`)**
   - Ask about concrete CV design decisions:
     - Page budget: *Strict 1-page* vs. *2-page comprehensive*
     - Section ordering: e.g. *Summary -> Experience -> Projects -> Skills -> Education* vs. *Experience -> Skills -> Projects -> Education* (no summary)
     - Pruning trade-off: which older/less-relevant roles or bullets can be condensed to 1 line or dropped to make room for high-signal JD alignment.
