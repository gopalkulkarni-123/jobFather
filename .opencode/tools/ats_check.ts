import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export default tool({
  description:
    "Run deterministic ATS compliance, formatting, bullet quantification, and JD keyword checks on a CV source file (.md, .tex, or .typ).",
  args: {
    cvPath: tool.schema
      .string()
      .describe("Path to the CV file (.md, .tex, or .typ) to audit"),
    keywords: tool.schema
      .string()
      .optional()
      .describe("Comma-separated list of target JD keywords (e.g. 'Python,Kubernetes,PyTorch,CI/CD,gRPC')"),
  },
  async execute(args, context) {
    const baseDir = context.directory || projectRoot
    const resolvedCv = path.isAbsolute(args.cvPath)
      ? args.cvPath
      : path.resolve(baseDir, args.cvPath)
    const scriptPath = path.join(projectRoot, "scripts", "ats_lint.py")
    const cliArgs = [scriptPath, "--cv", resolvedCv]
    if (args.keywords) {
      cliArgs.push("--keywords", args.keywords)
    }

    try {
      const { stdout } = await execFileAsync("python3", cliArgs, {
        maxBuffer: 5 * 1024 * 1024,
      })
      return stdout.trim()
    } catch (err: any) {
      return (err?.stdout || err?.stderr || String(err)).trim()
    }
  },
})
