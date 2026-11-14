# Candidate Inputs Drop-Zone (`inputs/`)

Drop your base application materials into this directory before running `/tailor` or `/score` in OpenCode:

1. **Base CV**: e.g. `inputs/cv.pdf`, `inputs/cv.docx`, `inputs/cv.md`, or `inputs/cv.tex`
2. **LinkedIn Export**:
   - On your LinkedIn profile, click **More -> Save to PDF** and place it here as `inputs/linkedin.pdf`
   - *Or* paste your profile text / "About" + Experience into `inputs/linkedin.txt`
3. **Optional Default Profile Config** (`inputs/profile.json`):
   - Copy `profile.example.json` to `profile.json` and set your `github` handle so you don't have to type it every session!
4. **Optional Job Description Fallback** (`inputs/job.txt`):
   - Normally you just pass a live URL (`/tailor https://...`), and OpenCode extracts it automatically. If a company portal requires login, paste the job text into `inputs/job.txt` or directly into OpenCode when asked.
