import { type Plugin, tool } from "@opencode-ai/plugin"

interface ProcessInfo {
  id: string
  command: string
  proc: ReturnType<typeof Bun.spawn>
  output: string[]
  maxOutputLines: number
  startedAt: Date
  cwd: string
  exited: boolean
  exitCode: number | null
}

const processes = new Map<string, ProcessInfo>()

let processCounter = 0

function generateId(command: string): string {
  const shortCmd = command.split(" ")[0].split("/").pop() || "proc"
  return `${shortCmd}-${++processCounter}`
}

function appendOutput(info: ProcessInfo, data: string) {
  const lines = data.split("\n")
  for (const line of lines) {
    if (line.trim()) {
      info.output.push(line)
      if (info.output.length > info.maxOutputLines) {
        info.output.shift()
      }
    }
  }
}

function getProcessStatus(info: ProcessInfo): string {
  if (info.exited) {
    return `exited (code ${info.exitCode})`
  }
  return "running"
}

function formatProcessList(): string {
  if (processes.size === 0) {
    return "No background processes running."
  }

  const lines: string[] = ["Background Processes:", ""]
  for (const [id, info] of processes) {
    const status = getProcessStatus(info)
    const runtime = Math.round((Date.now() - info.startedAt.getTime()) / 1000)
    const pid = info.proc.pid
    lines.push(`[${id}] PID: ${pid} | Status: ${status} | Runtime: ${runtime}s`)
    lines.push(`    Command: ${info.command}`)
    lines.push(`    CWD: ${info.cwd}`)
    lines.push("")
  }
  return lines.join("\n")
}

async function streamToOutput(stream: ReadableStream<Uint8Array> | null, info: ProcessInfo, prefix = "") {
  if (!stream) return
  const reader = stream.getReader()
  const decoder = new TextDecoder()
  try {
    while (true) {
      const { done, value } = await reader.read()
      if (done) break
      const text = decoder.decode(value, { stream: true })
      appendOutput(info, prefix ? `${prefix}${text}` : text)
    }
  } catch {
    // Stream closed
  }
}

export const BackgroundProcessPlugin: Plugin = async ({ directory }) => {
  return {
    tool: {
      background_process_launch: tool({
        description: `Launch a command as a background process. The process runs independently and its output is captured for later reading. Useful for long-running tasks like dev servers, watchers, or build processes. Returns the process ID for future reference.`,
        args: {
          command: tool.schema.string().describe("The shell command to run in the background"),
          cwd: tool.schema
            .string()
            .optional()
            .describe("Working directory for the command (defaults to current directory)"),
          id: tool.schema.string().optional().describe("Custom ID for this process (auto-generated if not provided)"),
          maxOutputLines: tool.schema
            .number()
            .optional()
            .default(500)
            .describe("Maximum output lines to keep in buffer (default: 500)"),
        },
        async execute(args) {
          const cwd = args.cwd || directory
          const id = args.id || generateId(args.command)

          if (processes.has(id)) {
            return `Error: Process with ID "${id}" already exists. Use a different ID or kill the existing process first.`
          }

          const proc = Bun.spawn(["sh", "-c", args.command], {
            cwd,
            stdin: "pipe",
            stdout: "pipe",
            stderr: "pipe",
          })

          const info: ProcessInfo = {
            id,
            command: args.command,
            proc,
            output: [],
            maxOutputLines: args.maxOutputLines,
            startedAt: new Date(),
            cwd,
            exited: false,
            exitCode: null,
          }

          // Start streaming stdout and stderr in background
          streamToOutput(proc.stdout, info)
          streamToOutput(proc.stderr, info, "[stderr] ")

          // Track exit
          proc.exited.then((code) => {
            info.exited = true
            info.exitCode = code
            appendOutput(info, `[exit] Process exited with code ${code}`)
          })

          processes.set(id, info)

          // Wait briefly to catch immediate errors
          await Bun.sleep(100)

          if (info.exited) {
            return `Process "${id}" started but exited immediately with code ${info.exitCode}.\nOutput:\n${info.output.join("\n")}`
          }

          return `Background process started successfully.
ID: ${id}
PID: ${proc.pid}
Command: ${args.command}
CWD: ${cwd}

Use background_process_read to see output, or background_process_kill to stop it.`
        },
      }),

      background_process_list: tool({
        description:
          "List all background processes with their status, PID, runtime, and command. Shows both running and recently exited processes.",
        args: {},
        async execute() {
          return formatProcessList()
        },
      }),

      background_process_read: tool({
        description:
          "Read the captured output from a background process. Returns the most recent lines from the output buffer.",
        args: {
          id: tool.schema.string().describe("The process ID to read output from"),
          lines: tool.schema.number().optional().default(50).describe("Number of recent lines to return (default: 50)"),
          clear: tool.schema.boolean().optional().default(false).describe("Clear the output buffer after reading"),
        },
        async execute(args) {
          const info = processes.get(args.id)
          if (!info) {
            const available = Array.from(processes.keys())
            return `Error: No process found with ID "${args.id}". Available processes: ${available.length ? available.join(", ") : "none"}`
          }

          const status = getProcessStatus(info)
          const output = info.output.slice(-args.lines)

          if (args.clear) {
            info.output = []
          }

          if (output.length === 0) {
            return `Process "${args.id}" (${status}): No output captured yet.`
          }

          const header = `Process "${args.id}" (${status}) - Last ${output.length} lines:`
          return `${header}\n${"─".repeat(50)}\n${output.join("\n")}`
        },
      }),

      background_process_write: tool({
        description:
          "Send input to a running background process's stdin. Useful for interactive processes that accept commands.",
        args: {
          id: tool.schema.string().describe("The process ID to send input to"),
          input: tool.schema.string().describe("The input to send to the process stdin"),
          newline: tool.schema
            .boolean()
            .optional()
            .default(true)
            .describe("Append a newline after the input (default: true)"),
        },
        async execute(args) {
          const info = processes.get(args.id)
          if (!info) {
            return `Error: No process found with ID "${args.id}".`
          }

          if (info.exited) {
            return `Error: Process "${args.id}" has already exited.`
          }

          const data = args.newline ? `${args.input}\n` : args.input
          const stdin = info.proc.stdin
          if (!stdin || typeof stdin === "number") {
            return `Error: Process "${args.id}" stdin is not available.`
          }
          stdin.write(data)

          return `Sent input to process "${args.id}": ${JSON.stringify(args.input)}`
        },
      }),

      background_process_kill: tool({
        description:
          "Kill a background process. Sends SIGTERM by default, or SIGKILL for force kill. Optionally removes the process from tracking.",
        args: {
          id: tool.schema.string().describe("The process ID to kill"),
          signal: tool.schema
            .enum(["SIGTERM", "SIGKILL", "SIGINT"])
            .optional()
            .default("SIGTERM")
            .describe("Signal to send (default: SIGTERM)"),
          remove: tool.schema
            .boolean()
            .optional()
            .default(false)
            .describe("Remove process from tracking after killing (default: false)"),
        },
        async execute(args) {
          const info = processes.get(args.id)
          if (!info) {
            return `Error: No process found with ID "${args.id}".`
          }

          const status = getProcessStatus(info)
          if (info.exited) {
            if (args.remove) {
              processes.delete(args.id)
              return `Process "${args.id}" already exited (${status}). Removed from tracking.`
            }
            return `Process "${args.id}" already exited (${status}). Use remove=true to clear it.`
          }

          const signalNum = args.signal === "SIGKILL" ? 9 : args.signal === "SIGINT" ? 2 : 15
          info.proc.kill(signalNum)

          // Wait for process to exit
          await Bun.sleep(200)

          const newStatus = getProcessStatus(info)

          if (args.remove) {
            processes.delete(args.id)
            return `Process "${args.id}" killed with ${args.signal} (${newStatus}). Removed from tracking.`
          }

          return `Process "${args.id}" killed with ${args.signal} (${newStatus}).`
        },
      }),

      background_process_cleanup: tool({
        description:
          "Remove all exited processes from tracking, or kill all processes and clean up. Useful for housekeeping.",
        args: {
          killAll: tool.schema
            .boolean()
            .optional()
            .default(false)
            .describe("Kill all running processes before cleanup (default: false, only removes exited)"),
        },
        async execute(args) {
          const removed: string[] = []
          const killed: string[] = []

          for (const [id, info] of processes) {
            if (info.exited) {
              processes.delete(id)
              removed.push(id)
            } else if (args.killAll) {
              info.proc.kill(15) // SIGTERM
              killed.push(id)
              processes.delete(id)
            }
          }

          const parts: string[] = []
          if (killed.length) parts.push(`Killed: ${killed.join(", ")}`)
          if (removed.length) parts.push(`Removed: ${removed.join(", ")}`)
          if (parts.length === 0) parts.push("No processes to clean up.")

          return parts.join("\n")
        },
      }),
    },
  }
}
