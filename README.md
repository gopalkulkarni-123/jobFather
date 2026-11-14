# CV Tailor — Interactive OpenCode Career Workspace

An interactive **OpenCode** workspace that takes your **CV**, **LinkedIn**, **GitHub**, and a **Target Job Link**, interviews you with **5+ targeted discovery & design questions**, and outputs:

1. **ATS-Friendly Tailored CV** — clean `.md` source + `.tex` (LaTeX) and/or `.typ` (Typst) source files
2. **Tailored Cover Letter** — matching `.md` + `.tex` / `.typ` source files
3. **Before & After Fitness Score Report** (`fitness_report.md`) — 100-point weighted rubric comparing your untouched CV against the tailored version, with full JD traceability and honest gap analysis

---

## Quick Start (Web Studio UI — Recommended)

Launch the **CV Tailor Studio** web interface (zero extra packages needed — automatically starts `opencode serve` in the background):

```bash
/home/hpcgkulk/.gemini/antigravity/scratch/cv-tailor/start-ui.sh
```

Then open **http://127.0.0.1:8765** in your browser:
1. **Left Panel (Inputs):** Drag-and-drop your CV (`.pdf`, `.docx`, `.md`, `.tex`) and LinkedIn PDF (or paste text), enter your GitHub URL and Target Job URL, and click **Start Tailoring**.
2. **Center Panel (5+ Question Interview):** Watch your **Baseline Fitness Score**, click through interactive multi-choice + custom answer cards for the **5+ discovery & design questions**, and chat live with `career-architect`.
3. **Right Panel (Score & Deliverables):** View your **Before -> After Fitness Score**, switch tabs across `.md`, `.tex`, and `.typ` CV/Cover Letter files, edit in-place, run **1-click ATS Checks**, or download a `.zip` bundle.
4. *(Built-in Google SDK Cache Fix)*: Includes a **Fix SDK Cache** button in the top bar that clears stale `~/.cache/opencode` packages without touching your saved API keys.

---

## Alternative: Terminal TUI Mode

### 1. Add Your Base Materials in `inputs/`
Place your files in `inputs/`:
- `inputs/cv.pdf` (or `.docx`, `.md`, `.tex`, `.typ`, `.txt`)
- `inputs/linkedin.pdf` (from LinkedIn **More -> Save to PDF**, or `inputs/linkedin.txt`)
- *(Optional)* Copy `inputs/profile.example.json` -> `inputs/profile.json` to save your GitHub username/URL permanently.

### 2. Launch OpenCode TUI
```bash
opencode /home/hpcgkulk/.gemini/antigravity/scratch/cv-tailor
```

The workspace automatically boots into the **`career-architect`** primary agent with custom tools (`parse_inputs`, `github_profile`, `job_posting`, `ats_check`) and interactive `question` prompts enabled.

### 3. Run a Slash Command Inside OpenCode

| Slash Command | What It Does |
| :--- | :--- |
| `/tailor <job-url>` | **Full end-to-end flow**: Ingests CV + LinkedIn + GitHub + Job URL -> computes **Baseline Fitness Score** -> asks **5+ interactive gap & design questions** -> generates `.md` + `.tex`/`.typ` CV, Cover Letter, & Post-Tailoring Fitness Report -> runs deterministic ATS lint. |
| `/score <job-url>` | **Quick triage**: Computes your Baseline Fitness Score (0–100) and lists key gaps before you commit to full tailoring. |
| `/audit [output-dir]` | **Re-verify after manual edits**: Runs the deterministic ATS linter (`ats_check`) + `@ats-auditor` syntax/truthfulness review on your `.md`, `.tex`, or `.typ` files. |

---

## How the 5-Phase Interactive Loop Works

```text
Inputs (CV + LinkedIn + GitHub + Job URL)
   │
   ▼
[Phase 1] Parse local PDF/DOCX/MD (`parse_inputs`) + GitHub API (`github_profile`) + Job Posting (`job_posting`)
   │
   ▼
[Phase 2] Cross-reference evidence & compute Baseline Fitness Score (0–100)
   │
   ▼
[Phase 3] Mandatory 5+ Question Interactive Interview (`question` tool)
          • Q1: Unstated experience for missing JD must-haves
          • Q2: Concrete metrics (%, $, latency, scale) for key bullets
          • Q3: Which GitHub repos/projects to spotlight & technical framing
          • Q4: CV vs. LinkedIn nuances or secondary technical/leadership probes
          • Q5: Career narrative angle & Cover Letter hook/tone
          • Q6–Q7: Design choices (.tex vs .typ, 1-page vs 2-page, section order)
   │
   ▼
[Phase 4] Generate `outputs/<date>-<company>-<role>/` + run `ats_check` linter + compute After Score
   │
   ▼
[Phase 5] Interactive feedback & refinement loop
```

---

## Compiling `.tex` or `.typ` Sources to PDF

Your generated `.tex` and `.typ` files are zero-external-package, single-column ATS-compliant sources:

- **Overleaf (Zero Local Install)**: Upload `tailored_cv.tex` or `cover_letter.tex` directly into Overleaf and click **Recompile**.
- **Local Typst** (lightweight single binary):
  ```bash
  typst compile outputs/<folder>/tailored_cv.typ
  ```
- **Local LaTeX** (`pdflatex` or `tectonic`):
  ```bash
  pdflatex -output-directory=outputs/<folder> outputs/<folder>/tailored_cv.tex
  ```

---

## Architecture Overview

- `opencode.json` — Configures `career-architect` as default primary agent and enables OpenCode's native `question` tool + custom tools.
- `AGENTS.md` — Enforces strict project guardrails (zero fabrication, >=5 questions before output, Before/After fitness scoring, single-column ATS compliance).
- `.opencode/agents/` — `career-architect.md` (primary), `profile-researcher.md` (subagent), `ats-auditor.md` (subagent).
- `.opencode/commands/` — `/tailor`, `/score`, and `/audit` slash commands.
- `.opencode/skills/` — `discovery-interview`, `fitness-rubric`, and `ats-optimization` domain modules.
- `.opencode/tools/` — Custom TypeScript tools (`parse_inputs`, `github_profile`, `job_posting`, `ats_check`) backed by zero-dependency Python 3 scripts in `scripts/`.
- `templates/` — Clean, linear-text-stream ATS templates in Markdown (`.md`), LaTeX (`.tex`), and Typst (`.typ`).
