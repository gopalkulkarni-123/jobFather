# CV Tailor

CV Tailor is an OpenCode workspace that tailors your CV and cover letter to a specific job.

You give it four inputs:

- your CV
- your LinkedIn profile
- your GitHub profile
- a link to the job posting

The agent reads them, scores how well your current CV fits the job, and asks you at least five questions about gaps, metrics and layout. It then writes:

1. A tailored, ATS-friendly CV (`.md`, plus `.tex` and/or `.typ`)
2. A matching cover letter in the same formats
3. A fitness report (`fitness_report.md`) with a before and after score out of 100

The agent does not invent experience. If you lack a skill the job asks for, it lists that in the report instead of adding it to the CV.

**The project is containerized.** The Docker image contains everything it needs: OpenCode, Python, the PDF reader and the web UI. If you have Docker, you do not need to install anything else. You can also run it without Docker (see "Run without Docker").

## Quick start with Docker

You need:

- Docker with Docker Compose 2.24 or newer (`docker compose version`)
- An API key for a model provider that OpenCode supports, for example Google Gemini, OpenAI or Anthropic

Steps:

```bash
git clone https://github.com/gopalkulkarni-123/jobFather.git cv-tailor
cd cv-tailor

# run the container as your own user, so the files it writes belong to you
echo "UID=$(id -u)" > .env
echo "GID=$(id -g)" >> .env

# add your model API key (use the line for your provider)
echo "GOOGLE_GENERATIVE_AI_API_KEY=your-key" >> .env
# echo "OPENAI_API_KEY=your-key" >> .env
# echo "ANTHROPIC_API_KEY=your-key" >> .env

docker compose up -d --build
```

Open http://127.0.0.1:8765 in your browser. The first build takes a few minutes.

Instead of an API key in `.env`, you can log in through OpenCode once. The login is saved in a Docker volume and kept across restarts:

```bash
docker compose exec cv-tailor opencode auth login
docker compose restart
```

Useful commands:

```bash
docker compose logs -f        # show server output
docker compose restart        # restart after changing .env
docker compose down           # stop
docker compose down -v        # stop and delete the saved login and sessions
```

`.env` holds your API key. It is ignored by git and not copied into the image. Do not commit it.

## Using the web UI

- **Left panel:** upload your CV and LinkedIn PDF (or paste the LinkedIn text), enter your GitHub, paste the job URL (or the job text), and choose the output format. Press **Start tailoring** for the full run, or **Score** for a quick baseline score.
- **Center panel:** the agent's messages. Tool calls are shown as short one-line steps. Questions appear as cards, one at a time. Permission requests appear as Allow and Deny buttons. Use the box at the bottom to ask for changes, for example "make the summary shorter".
- **Right panel:** the before and after scores, and the generated CV, cover letter and report. You can copy, download, zip, or run an ATS check on the CV.
- **Model list** in the top bar: pick which model OpenCode uses.
- **Details** in the top bar shows the agent's reasoning and the full tool inputs and outputs. Use it when something goes wrong.
- The current session is kept when you reload the page. **New session** starts over.
- The older wizard UI is still available at http://127.0.0.1:8765/classic/.

Files you upload are saved in `inputs/`. Results are written to `outputs/`. Both folders are on your machine, not only inside the container, and both are ignored by git.

## Output

Each run writes to its own folder:

```
outputs/<yyyy-mm-dd>-<company>-<role>/
  tailored_cv.md
  tailored_cv.tex and/or tailored_cv.typ
  cover_letter.md
  cover_letter.tex and/or cover_letter.typ
  fitness_report.md
```

To get a PDF, upload the `.tex` file to Overleaf, or compile on your machine:

```bash
typst compile outputs/<folder>/tailored_cv.typ
pdflatex -output-directory=outputs/<folder> outputs/<folder>/tailored_cv.tex
```

## Docker details

### What is in the image

| Component | Purpose |
|---|---|
| OpenCode 1.19.5 | Runs the agent, tools and slash commands |
| Python 3 | Web UI server and helper scripts (standard library only) |
| `pdftotext` (poppler-utils) | Reads PDF CVs and LinkedIn exports |
| `@opencode-ai/plugin` | Needed by the custom tools, installed at build time |
| Typst (optional) | Compiles `.typ` files to PDF inside the container |

LaTeX is not included because it makes the image very large.

### What is mounted from your machine

| Host | Container | Contents |
|---|---|---|
| `./inputs` | `/app/inputs` | Your CV, LinkedIn export, job text, `profile.json` |
| `./outputs` | `/app/outputs` | Generated CVs, cover letters and reports |
| volume `opencode-home` | `/data/home` | OpenCode login, sessions and cache |

The UI port is published only on `127.0.0.1`, so other machines on your network cannot reach it.

### Build options

```bash
docker compose build --build-arg INSTALL_TYPST=true          # include the Typst compiler
docker compose build --build-arg OPENCODE_VERSION=1.19.5     # pin another OpenCode version
```

### Without Docker Compose

```bash
docker build -t cv-tailor .
docker run -d --name cv-tailor \
  --user "$(id -u):$(id -g)" \
  -p 127.0.0.1:8765:8765 \
  -v "$PWD/inputs:/app/inputs" \
  -v "$PWD/outputs:/app/outputs" \
  -v cv-tailor-home:/data/home \
  -e GOOGLE_GENERATIVE_AI_API_KEY=your-key \
  cv-tailor
```

## Run without Docker

### Prerequisites

| Tool | Version | Why it is needed | Check |
|---|---|---|---|
| OpenCode | 1.19 or newer recommended | Runs the agent, tools and slash commands | `opencode --version` |
| Python | 3.10 or newer | Web UI server and helper scripts | `python3 --version` |
| A model provider | any provider OpenCode supports | The agent needs an LLM | `opencode auth list` |
| Internet access | | Job pages, GitHub API, model API, and a one-time download of the package for the custom tools | |

Optional:

| Tool | What it adds |
|---|---|
| `pdftotext` (from `poppler-utils`) | Reads PDF files. Recommended. |
| `pypdf` (`pip install pypdf`) | Fallback PDF reader if `pdftotext` is not installed |
| `typst`, `pdflatex` or `tectonic` | Compile the generated files to PDF |
| `GITHUB_TOKEN` or `GH_TOKEN` environment variable | Raises the GitHub API rate limit |

The Python scripts use only the standard library. You do not need `pip install`.

### Install and run

```bash
# install OpenCode (one of these)
curl -fsSL https://opencode.ai/install | bash
npm install -g opencode-ai

# log in to a model provider
opencode auth login

git clone https://github.com/gopalkulkarni-123/jobFather.git cv-tailor
cd cv-tailor
./start-ui.sh
```

This starts `opencode serve` in the background and serves the UI at http://127.0.0.1:8765.

Options:

```bash
./start-ui.sh --port 9000                 # use another port
./start-ui.sh --no-autostart-opencode     # start OpenCode only on the first request
OPENCODE_SERVER_URL=http://127.0.0.1:4096 ./start-ui.sh   # use an OpenCode server you already started
```

If you run it on a remote machine, forward the port from your laptop first:

```bash
ssh -L 8765:127.0.0.1:8765 <user>@<host>
```

### Terminal mode

You can also skip the web UI. Put your files in `inputs/` (see `inputs/README.md`), then start OpenCode in the project folder:

```bash
opencode .
```

| Command | What it does |
|---|---|
| `/tailor <job-url>` | Full run: read inputs, baseline score, at least 5 questions, write the CV, cover letter and report, run the ATS check |
| `/score <job-url>` | Baseline score and main gaps only |
| `/audit [output-folder]` | Run the ATS check and a review again after you edit the files by hand |

With Docker, the same works inside the container:

```bash
docker compose exec -it cv-tailor sh -c "cd /app && opencode ."
```

## Project layout

| Path | Contents |
|---|---|
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | Container setup |
| `opencode.json` | Sets `career-architect` as the default agent and sets tool permissions |
| `AGENTS.md` | Project rules: no invented experience, at least 5 questions, before and after scoring, ATS rules |
| `.opencode/agents/` | `career-architect` (main agent), `profile-researcher` and `ats-auditor` (subagents) |
| `.opencode/commands/` | The `/tailor`, `/score` and `/audit` commands |
| `.opencode/skills/` | Interview, scoring rubric and ATS guidance |
| `.opencode/tools/` | Custom tools `parse_inputs`, `github_profile`, `job_posting`, `ats_check` |
| `scripts/` | Python scripts behind the custom tools |
| `templates/` | CV and cover letter templates in Markdown, LaTeX and Typst |
| `ui/server.py` | Web server. Starts OpenCode and passes requests to it |
| `ui/quiet/` | Default web UI |
| `ui/static/` | Older wizard UI, served at `/classic/` |
| `inputs/`, `outputs/` | Your files and the results. Ignored by git |

## Troubleshooting

| Problem | What to do |
|---|---|
| The page does not load (Docker) | Run `docker compose ps` and `docker compose logs`. The container must show as running. |
| No models in the model list | Add an API key to `.env` and run `docker compose restart`, or log in with `docker compose exec cv-tailor opencode auth login`. |
| Files in `outputs/` belong to root | Set `UID` and `GID` in `.env` as shown in the quick start, then run `docker compose up -d`. |
| `Address already in use` | Another program uses port 8765. Stop it, or change the port in `docker-compose.yml` (for example `127.0.0.1:9000:8765`). |
| Stuck on "Working..." | Look at the server output (`docker compose logs -f` or the `./start-ui.sh` terminal), and turn on **Details** in the UI. |
| The page still shows the old UI (without Docker) | Stop the old server (`pkill -f ui/server.py; pkill -f "opencode serve"`), run `./start-ui.sh` again, then reload with Ctrl+Shift+R. |
| `Could not find opencode binary` (without Docker) | Install OpenCode, or make sure `opencode` is on your `PATH`. |
| PDF text is empty (without Docker) | Install `pdftotext` (`poppler-utils`) or `pypdf`. |
| The job page cannot be read | Some job sites need a login or block scripts. Paste the job text in the UI instead. |
| GitHub rate limit errors | Add `GITHUB_TOKEN=...` to `.env` (Docker) or set it in your shell. |