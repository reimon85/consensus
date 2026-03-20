---
title: Configuration
---

[Home](index) | [Getting Started](getting-started) | [Configuration](configuration) | [API](api) | [CLI](cli) | [Scripts](collab-scripts) | [Architecture](architecture)

# Configuration

## Environment variables

| Variable | Default | Description |
|---|---|---|
| `ENSEMBLE_PORT` | `23000` | Server listening port |
| `ENSEMBLE_URL` | `http://localhost:23000` | CLI target URL |
| `ENSEMBLE_DATA_DIR` | `~/.ensemble` | Data directory for team persistence |
| `ENSEMBLE_CORS_ORIGIN` | localhost only | Comma-separated allowed CORS origins |
| `ENSEMBLE_PROJECT` | auto-detect | Project name for summaries |
| `ENSEMBLE_AGENTS_CONFIG` | `./agents.json` | Path to custom agents config |
| `ENSEMBLE_AGENT_FLAGS` | — | Override agent CLI flags |
| `ENSEMBLE_WATCHDOG_NUDGE_MS` | `90000` | Time (ms) before idle agent nudge |
| `ENSEMBLE_WATCHDOG_STALL_MS` | `180000` | Time (ms) before stall detection |
| `ENSEMBLE_TELEGRAM_BOT_TOKEN` | — | Telegram bot token for notifications |
| `ENSEMBLE_TELEGRAM_CHAT_ID` | — | Telegram chat ID for notifications |
| `ENSEMBLE_CREATED_BY` | `$USER` | Creator ID for team metadata |

### Example `.env`

```bash
ENSEMBLE_PORT=23000
ENSEMBLE_TELEGRAM_BOT_TOKEN=123456:ABC-DEF
ENSEMBLE_TELEGRAM_CHAT_ID=your-chat-id
```

---

## Agent programs (agents.json)

The `agents.json` file defines which AI agents ensemble can spawn. Located in the project root by default, override with `ENSEMBLE_AGENTS_CONFIG`.

```json
{
  "codex": {
    "name": "codex",
    "command": "codex",
    "flags": ["--full-auto", "-m", "gpt-5.4"],
    "readyMarker": "›",
    "inputMethod": "pasteFromFile",
    "color": "blue",
    "icon": "◆"
  },
  "claude": {
    "name": "claude",
    "command": "claude",
    "flags": ["--dangerously-skip-permissions"],
    "readyMarker": "❯",
    "inputMethod": "sendKeys",
    "color": "green",
    "icon": "●"
  }
}
```

### Fields

| Field | Type | Description |
|---|---|---|
| `name` | string | Unique identifier (used in API) |
| `command` | string | CLI command to launch the agent |
| `flags` | string[] | Default CLI arguments |
| `readyMarker` | string | Terminal prompt character (readiness detection) |
| `inputMethod` | `"pasteFromFile"` or `"sendKeys"` | How to deliver multi-line prompts |
| `color` | string | Display color in TUI monitor |
| `icon` | string | Single character icon for TUI |

### Adding a custom agent

Any CLI tool that reads from stdin and writes to stdout can be an ensemble agent. Add it to `agents.json`:

```json
{
  "my-agent": {
    "name": "my-agent",
    "command": "/usr/local/bin/my-agent",
    "flags": ["--auto"],
    "readyMarker": ">",
    "inputMethod": "sendKeys",
    "color": "cyan",
    "icon": "▶"
  }
}
```

The agent must support `team-say` and `team-read` shell commands in its PATH for inter-agent communication.

### Input methods

- **`sendKeys`** — Types the prompt character by character into the tmux pane. Works with most agents. Simpler but slower for large prompts.
- **`pasteFromFile`** — Writes the prompt to a temp file and pastes it via tmux buffer. Faster for large prompts. Codex requires this method.

---

## Collab templates (collab-templates.json)

Pre-defined team configurations for common tasks. Each template assigns specialized roles to the agents:

| Template | Description | Roles |
|---|---|---|
| `review` | Code Review | Reviewer + Critic |
| `implement` | Implementation | Architect + Developer |
| `research` | Research | Researcher-A + Researcher-B |
| `debug` | Debug | Reproducer + Analyst |

Use via API: `"templateName": "review"` in the create team request. The template assigns roles and focus areas automatically.

---

## Multi-host setup

Run agents on different machines. Configure in `~/.ensemble/hosts.json`:

```json
{
  "hosts": [
    {
      "id": "local",
      "name": "laptop",
      "url": "http://localhost:23000",
      "enabled": true
    },
    {
      "id": "gpu-server",
      "name": "Remote GPU",
      "url": "http://192.168.1.100:23000",
      "enabled": true
    }
  ]
}
```

Each host runs its own ensemble server. Agents specify `hostId` to control placement:

```json
{
  "agents": [
    { "program": "claude", "hostId": "local" },
    { "program": "codex", "hostId": "gpu-server" }
  ]
}
```

Host discovery order: exact hostname match → `"local"` keyword → IP match → URL match.

---

## Telegram notifications

Get notified when teams finish. Set up:

1. Create a bot via [@BotFather](https://t.me/BotFather)
2. Get your chat ID (send `/start` to your bot, then check `https://api.telegram.org/bot<token>/getUpdates`)
3. Set environment variables:

```bash
export ENSEMBLE_TELEGRAM_BOT_TOKEN="123456:ABC-DEF..."
export ENSEMBLE_TELEGRAM_CHAT_ID="your-chat-id"
```

Notifications include: team name, duration, message count, and a brief summary.

---

## Claude Code integration

Ensemble integrates with [Claude Code](https://docs.anthropic.com/en/docs/claude-code) as a `/collab` slash command. This lets you type `/collab "review the auth module"` and Claude will spawn a Codex + Claude team, monitor their conversation, and present results — all without leaving your terminal.

### Quick setup (one command)

From the ensemble directory, run:

```bash
./scripts/setup-claude-code.sh
```

This automatically:
- Installs the `/collab` skill to `~/.claude/skills/collab/`
- Adds script permissions to `~/.claude/settings.json`
- Verifies all prerequisites (Node.js, tmux, Python, agent CLIs)
- Confirms everything is ready

### Manual setup

If you prefer to set things up manually:

**Step 1:** Copy the skill file:

```bash
mkdir -p ~/.claude/skills/collab
cp /path/to/ensemble/skill/SKILL.md ~/.claude/skills/collab/SKILL.md
```

**Step 2:** Add permissions to `~/.claude/settings.json`:

```json
{
  "permissions": {
    "allow": [
      "Bash(/path/to/ensemble/scripts/collab-launch.sh:*)",
      "Bash(/path/to/ensemble/scripts/collab-poll.sh:*)",
      "Bash(/path/to/ensemble/scripts/collab-status.sh:*)"
    ]
  }
}
```

Replace `/path/to/ensemble` with the actual path where you cloned the repo.

### Use it

In any Claude Code session:

```
/collab "Review the authentication module for security issues"
```

Claude Code will:
1. Start the ensemble server (if not running)
2. Spawn a Codex + Claude team
3. Show the agent conversation inline as it happens
4. Present a summary when the team finishes

You can also say things like "werk samen met Codex" or "start a collab team" — Claude Code recognizes these as triggers for the collab skill.

### How it works

The `/collab` skill tells Claude Code to:
1. Run `collab-launch.sh` to create the team
2. Poll `collab-poll.sh` for new messages every 15-30 seconds
3. Present each agent's messages as formatted dialogue
4. Clean up when the team finishes or is disbanded

In tmux, the TUI monitor opens in a split pane. Without tmux, messages are polled and displayed inline.

---

## Git worktrees (optional)

Each agent can work in an isolated git worktree:

```json
{
  "useWorktrees": true
}
```

When enabled:
- Each agent gets a separate branch (`team-{name}-{agent}`)
- Changes are automatically merged back on disband
- Prevents file conflicts between agents working on the same repo

---

## Security notes

Ensemble is designed for **local development use**. Be aware:

- No built-in API authentication (rate limiting by IP only)
- Agents run with permissive flags to support unattended execution
- Server binds to localhost by default
- Do **not** expose to the internet without adding authentication

For production use, consider running behind a reverse proxy with auth.

### Why agents need permissive flags

Ensemble agents run autonomously inside `tmux` sessions without a human at the terminal. The flags in `agents.json` remove interactive confirmation prompts so the agents can actually complete work:

| Flag | Agent | Purpose |
|---|---|---|
| `--dangerously-skip-permissions` | Claude Code | Allows tool execution, file edits, and shell commands without interactive permission prompts. |
| `--full-auto` | Codex | Enables fully autonomous execution without confirmation prompts. |

These flags are acceptable in the ensemble context because:

- The server binds to `127.0.0.1` only
- Agents operate inside the working directory you specify
- Each team is isolated in its own `tmux` session
- You can monitor agent behavior live via the TUI and message feed

If you add custom agents, grant only the minimum flags required for autonomous operation.
