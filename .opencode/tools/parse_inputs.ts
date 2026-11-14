import { tool } from "@opencode-ai/plugin"
import { execFile } from "node:child_process"
import path from "node:path"
import { fileURLToPath } from "node:url"
import { promisify } from "node:util"

const execFileAsync = promisify(execFile)
const projectRoot = path.resolve(path.dirname(fileURLToPath(import.meta.url)), "../..")

export default tool({
  description:
    "Parse local candidate input files (CV in PDF/DOCX/MD/TEX/TYP/TXT, LinkedIn 'Save to PDF' export or text) or scan an entire directory like 'inputs/' into clean text.",
  args: {
    targetPath: tool.schema
      .string()
      .default("inputs")
      .describe("File or directory path to parse (relative to project root or absolute, defaults to 'inputs')"),
    maxChars: tool.schema
      .number()
      .default(40000)
      .describe("Maximum extracted characters per file"),
  },
  async execute(args, context) {
    const baseDir = context.directory || projectRoot
    const resolvedTarget = path.isAbsolute(args.targetPath)
      ? args.targetPath
      : path.resolve(baseDir, args.targetPath)
    const scriptPath = path.join(projectRoot, "scripts", "parse_document.py")

    try {
      const { stdout } = await execFileAsync(
        "python3",
        [scriptPath, "--path", resolvedTarget, "--max-chars", String(args.maxChars)],
        { maxBuffer: 10 * 1024 * 1024 }
      )
      return stdout.trim()
    } catch (err: any) {
      return (err?.stdout || err?.stderr || String(err)).trim()
    }
  },
})
