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

## Prerequisites

### Required

| Tool | Version | Why it is needed | Check |
|---|---|---|---|
| OpenCode | 1.19 or newer recommended | Runs the agent, tools and slash commands | `opencode --version` |
| Python | 3.10 or newer | Web UI server and helper scripts in `scripts/` | `python3 --version` |
| A model provider | any provider OpenCode supports | The agent needs an LLM | `opencode auth list` |
| Internet access | | Job pages, GitHub API, model API, and a one-time download of the OpenCode plugin package for the custom tools | |

Install OpenCode with one of these:

```bash
curl -fsSL https://opencode.ai/install | bash
# or
npm install -g opencode-ai
```

Then log in to a model provider:

```bash
opencode auth login
```

The Python scripts use only the standard library. You do not need `pip install` for the web UI or the scripts.

### Optional

| Tool | What it adds |
|---|---|
| `pdftotext` (from `poppler-utils`) | Reads PDF CVs and LinkedIn exports. Recommended. |
| `pypdf` (`pip install pypdf`) | Fallback PDF reader if `pdftotext` is not installed. |
| `typst` | Compiles `.typ` files to PDF on your machine. |
| `pdflatex` or `tectonic` | Compiles `.tex` files to PDF on your machine. You can also use Overleaf. |
| `GITHUB_TOKEN` or `GH_TOKEN` environment variable | Raises the GitHub API rate limit when reading your repositories. |
| Docker with Compose 2.24 or newer, or Apptainer | Run everything in a container instead of installing OpenCode and Python. See "Run in a container". |

If you only use `.md`, `.docx` or `.txt` files as input, you do not need a PDF reader.

## Setup

```bash
git clone https://github.com/gopalkulkarni-123/jobFather.git cv-tailor
cd cv-tailor
```

Optional: save your GitHub handle so you do not have to enter it each time.

```bash
cp inputs/profile.example.json inputs/profile.json
# then edit "github" in inputs/profile.json
```

Files you put in `inputs/` and everything in `outputs/` are ignored by git, so your personal data is not committed.

## Run the web UI

```bash
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

### Using the UI

- **Left panel:** upload your CV and LinkedIn PDF (or paste the LinkedIn text), enter your GitHub, paste the job URL (or the job text), and choose the output format. Press **Start tailoring** for the full run, or **Score** for a quick baseline score.
- **Center panel:** the agent's messages. Tool calls are shown as short one-line steps. Questions appear as cards, one at a time. Permission requests appear as Allow and Deny buttons. Use the box at the bottom to ask for changes, for example "make the summary shorter".
- **Right panel:** the before and after scores, and the generated CV, cover letter and report. You can copy, download, zip, or run an ATS check on the CV.
- **Details** in the top bar shows the agent's reasoning and the full tool inputs and outputs. Use it when something goes wrong.
- The current session is kept when you reload the page. **New session** starts over.
- The older wizard UI is still available at http://127.0.0.1:8765/classic/.

## Run in a container

The image contains OpenCode, Python, `pdftotext` and the packages the custom tools need. You only need Docker (or Podman) on the host. Your files in `inputs/` and `outputs/` stay on the host and are mounted into the container.

### With Docker Compose

```bash
echo "UID=$(id -u)" > .env
echo "GID=$(id -g)" >> .env
docker compose up -d --build
```

Open http://127.0.0.1:8765.

Log in to a model provider once. The login is stored in the `opencode-home` volume and kept across restarts:

```bash
docker compose exec cv-tailor opencode auth login
docker compose restart
```

Instead of logging in, you can put API keys in `.env`, for example:

```
GOOGLE_GENERATIVE_AI_API_KEY=...
OPENAI_API_KEY=...
ANTHROPIC_API_KEY=...
GITHUB_TOKEN=...
```

`.env` is not copied into the image. Do not commit it.

Stop with `docker compose down`. Add `-v` to also delete the stored login and sessions.

### With plain Docker

```bash
docker build -t cv-tailor .
docker run -d --name cv-tailor \
  --user "$(id -u):$(id -g)" \
  -p 127.0.0.1:8765:8765 \
  -v "$PWD/inputs:/app/inputs" \
  -v "$PWD/outputs:/app/outputs" \
  -v cv-tailor-home:/data/home \
  cv-tailor
docker exec -it cv-tailor opencode auth login
```

### Build options

```bash
docker build --build-arg INSTALL_TYPST=true -t cv-tailor .          # include the Typst compiler
docker build --build-arg OPENCODE_VERSION=1.19.5 -t cv-tailor .     # pin another OpenCode version
```

LaTeX is not included because it makes the image very large. Use Overleaf or a local `pdflatex` for `.tex` files.

### With Apptainer (HPC systems without Docker)

Build the image on a machine with Docker, then copy it over:

```bash
docker build -t cv-tailor .
docker save cv-tailor -o cv-tailor.tar
scp cv-tailor.tar <user>@<host>:
```

On the HPC system:

```bash
apptainer build cv-tailor.sif docker-archive://cv-tailor.tar
cd cv-tailor   # the folder with inputs/ and outputs/
apptainer run --writable-tmpfs \
  --bind "$PWD/inputs:/app/inputs,$PWD/outputs:/app/outputs" \
  cv-tailor.sif
```

Apptainer uses your normal home directory, so the container uses the same OpenCode login as `opencode` on the host. Run `opencode auth login` on the host first if needed. The node needs internet access for the model API and job pages, so run it on a login node, not a compute node without network. Use SSH port forwarding to open the UI from your laptop.

## Run in the terminal instead

Put your files in `inputs/` (see `inputs/README.md`), then start OpenCode in the project folder:

```bash
opencode .
```

Then use one of these commands:

| Command | What it does |
|---|---|
| `/tailor <job-url>` | Full run: read inputs, baseline score, at least 5 questions, write the CV, cover letter and report, run the ATS check |
| `/score <job-url>` | Baseline score and main gaps only |
| `/audit [output-folder]` | Run the ATS check and a review again after you edit the files by hand |

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

To get a PDF:

```bash
typst compile outputs/<folder>/tailored_cv.typ
pdflatex -output-directory=outputs/<folder> outputs/<folder>/tailored_cv.tex
```

Or upload the `.tex` file to Overleaf.

## Project layout

| Path | Contents |
|---|---|
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
| `Dockerfile`, `docker-compose.yml`, `.dockerignore` | Container setup |

## Troubleshooting

| Problem | What to do |
|---|---|
| `Could not find opencode binary` | Install OpenCode, or make sure `opencode` is on your `PATH`. |
| The page still shows the old UI | Stop the old server (`pkill -f ui/server.py; pkill -f "opencode serve"`), run `./start-ui.sh` again, then reload with Ctrl+Shift+R. |
| `Address already in use` | Another server is using port 8765. Stop it, or use `--port`. |
| Stuck on "Working..." | Look at the terminal running `./start-ui.sh` for errors, and turn on **Details** in the UI. |
| PDF text is empty | Install `pdftotext` (`poppler-utils`) or `pypdf`. |
| The job page cannot be read | Some job sites need a login or block scripts. Paste the job text in the UI instead. |
| GitHub rate limit errors | Set `GITHUB_TOKEN` before starting the UI. |
