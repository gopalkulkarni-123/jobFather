import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export default tool({
  description:
    "Fetch a candidate's public GitHub profile, top/recent non-fork repositories, primary languages, topics, stars, and README excerpts for technical project evidence.",
  args: {
    userOrUrl: tool.schema
      .string()
      .describe("GitHub username (e.g. 'torvalds') or profile URL (e.g. 'https://github.com/torvalds')"),
    maxRepos: tool.schema
      .number()
      .default(10)
      .describe("Maximum number of ranked repositories to inspect"),
    readmeRepos: tool.schema
      .number()
      .default(5)
      .describe("Number of top repositories for which to pull README excerpts"),
  },
  async execute(args) {
    const scriptPath = path.join(projectRoot, "scripts", "fetch_github.py")
    try {
      const { stdout } = await execFileAsync(
        "python3",
        [
          scriptPath,
          "--user",
          args.userOrUrl,
          "--max-repos",
          String(args.maxRepos),
          "--readme-repos",
          String(args.readmeRepos),
        ],
        { maxBuffer: 10 * 1024 * 1024 }
      )
      return stdout.trim()
    } catch (err: any) {
      return (err?.stdout || err?.stderr || String(err)).trim()
    }
  },
})
