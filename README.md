# opencode-background-process

An OpenCode plugin for managing background processes. Launch, monitor, and control long-running tasks like dev servers, watchers, and build processes.

![background-process](https://github.com/user-attachments/assets/e7b84201-09af-45c5-8bf5-711e5a59164f)

## Installation

Add to your `opencode.json`:

```json
{
  "plugin": ["opencode-background-process"]
}
```

OpenCode automatically installs plugin dependencies at runtime.

## Tools

### `background_process_launch`

Start a command as a background process.

| Argument         | Type   | Required | Description                                |
| ---------------- | ------ | -------- | ------------------------------------------ |
| `command`        | string | yes      | The shell command to run                   |
| `cwd`            | string | no       | Working directory (defaults to current)    |
| `id`             | string | no       | Custom ID (auto-generated if not provided) |
| `maxOutputLines` | number | no       | Output buffer size (default: 500)          |

### `background_process_list`

List all background processes with status, PID, runtime, and command.

### `background_process_read`

Read captured output from a background process.

| Argument | Type    | Required | Description                                 |
| -------- | ------- | -------- | ------------------------------------------- |
| `id`     | string  | yes      | Process ID to read from                     |
| `lines`  | number  | no       | Number of lines to return (default: 50)     |
| `clear`  | boolean | no       | Clear buffer after reading (default: false) |

### `background_process_write`

Send input to a running process's stdin.

| Argument  | Type    | Required | Description                    |
| --------- | ------- | -------- | ------------------------------ |
| `id`      | string  | yes      | Process ID                     |
| `input`   | string  | yes      | Input to send                  |
| `newline` | boolean | no       | Append newline (default: true) |

### `background_process_kill`

Kill a background process.

| Argument | Type    | Required | Description                                         |
| -------- | ------- | -------- | --------------------------------------------------- |
| `id`     | string  | yes      | Process ID to kill                                  |
| `signal` | enum    | no       | SIGTERM, SIGKILL, or SIGINT (default: SIGTERM)      |
| `remove` | boolean | no       | Remove from tracking after killing (default: false) |

### `background_process_cleanup`

Remove exited processes or kill all processes.

| Argument  | Type    | Required | Description                                                      |
| --------- | ------- | -------- | ---------------------------------------------------------------- |
| `killAll` | boolean | no       | Kill all running processes (default: false, only removes exited) |

## Usage Examples

```
Start a dev server with 'bun run dev' in the background

List all background processes

Read the last 100 lines from process 'bun-1'

Send 'q' to process 'bun-1' to quit

Kill process 'bun-1'
```

## Notes

- Processes are tracked per OpenCode session
- Output is buffered (last 500 lines by default)
- Auto-generated IDs use the command name (e.g., `bun-1`, `npm-2`)

## License

MIT
