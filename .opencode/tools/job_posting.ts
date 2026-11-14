import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export default tool({
  description:
    "Extract clean structured text from a target job link (supports Greenhouse/Lever public APIs, Schema.org JobPosting JSON-LD, and HTML parsing) or from a local job text file. Returns status='needs_manual_paste' if gated by auth/anti-bot.",
  args: {
    url: tool.schema
      .string()
      .optional()
      .describe("Target job posting URL"),
    localFile: tool.schema
      .string()
      .optional()
      .describe("Optional path to a local job description file (e.g. 'inputs/job.txt')"),
  },
  async execute(args, context) {
    const scriptPath = path.join(projectRoot, "scripts", "fetch_job.py")
    const cliArgs = [scriptPath]

    if (args.localFile) {
      const baseDir = context.directory || projectRoot
      const resolved = path.isAbsolute(args.localFile)
        ? args.localFile
        : path.resolve(baseDir, args.localFile)
      cliArgs.push("--file", resolved)
    } else if (args.url) {
      cliArgs.push("--url", args.url)
    } else {
      return JSON.stringify({ status: "error", error: "Provide either 'url' or 'localFile'." })
    }

    try {
      const { stdout } = await execFileAsync("python3", cliArgs, {
        maxBuffer: 10 * 1024 * 1024,
      })
      return stdout.trim()
    } catch (err: any) {
      return (err?.stdout || err?.stderr || String(err)).trim()
    }
  },
})
