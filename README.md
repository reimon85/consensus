# ensemble

**Multi-agent collaboration engine** — AI agents that work as one.

Ensemble orchestrates multiple AI agents (Claude Code, Codex, Aider) into collaborative teams that communicate, share findings, and solve problems together in real time. Built on tmux-based session management for transparent, observable agent interactions.

> **Status:** Experimental developer tool. macOS and Linux only.

## Features

- **Team orchestration** — Spawn multi-agent teams with a single command
- **Real-time messaging** — Agents communicate via a structured message bus
- **TUI monitor** — Watch agent collaboration live from your terminal
- **Auto-disband** — Intelligent completion detection ends teams when work is done
- **Multi-host support** — Run agents across local and remote machines
- **CLI & HTTP API** — Full control via command line or REST endpoints

**[Full documentation →](https://michelhelsdingen.github.io/ensemble/)**

## Quick Start

### Prerequisites

- Node.js 18+, Python 3.6+, [tmux](https://github.com/tmux/tmux), curl
- At least one AI agent CLI installed (`claude`, `codex`, or `aider`)

### Install & Run

```bash
git clone https://github.com/michelhelsdingen/ensemble.git
cd ensemble
npm install

# Start the server (keep this running)
npm run dev
```

### Verify (in a second terminal)

```bash
curl http://localhost:23000/api/v1/health
# → {"status":"healthy","version":"1.0.0"}
```

### Create your first team

```bash
# Via CLI
npx ensemble status

# Via API — create a team of two agents
curl -X POST http://localhost:23000/api/ensemble/teams \
  -H "Content-Type: application/json" \
  -d '{
    "name": "review-team",
    "description": "Review the authentication module",
    "agents": [
      { "program": "claude", "role": "lead" },
      { "program": "codex", "role": "worker" }
    ],
    "workingDirectory": "'$(pwd)'"
  }'

# Watch the collaboration live
npx ensemble monitor --latest

# Steer the team
npx ensemble steer <team-id> "focus on the auth module"
```

Or use the all-in-one collab script:

```bash
./scripts/collab-launch.sh "$(pwd)" "Review the authentication module"
```

## Claude Code: `/collab` command

Ensemble ships with a skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Once installed, just type:

```
/collab "Review the auth module for security issues"
```

Claude spawns a Codex + Claude team, shows their conversation live in your terminal, and presents a summary when done. One-command setup:

```bash
./scripts/setup-claude-code.sh
```

This installs the skill, configures permissions, and verifies prerequisites. See the [full setup guide](https://michelhelsdingen.github.io/ensemble/configuration#claude-code-integration) for details.

## How It Works

1. **Create a team** — Define agents and their task via API or CLI
2. **Agents spawn** — Each agent gets a tmux session with the task prompt
3. **Communication** — Agents use `team-say`/`team-read` scripts to exchange messages
4. **Monitor** — Watch the collaboration unfold in real-time via the TUI monitor
5. **Auto-disband** — When agents signal completion, results are summarized and persisted

## Configuration

Copy `.env.example` to `.env` and adjust as needed. Key variables:

| Variable | Default | Description |
|---|---|---|
| `ENSEMBLE_PORT` | `23000` | Server port |
| `ENSEMBLE_URL` | `http://localhost:23000` | CLI target URL |
| `ENSEMBLE_DATA_DIR` | `~/.ensemble` | Data directory |
| `ENSEMBLE_CORS_ORIGIN` | localhost only | Allowed CORS origins |

See [full configuration docs](https://michelhelsdingen.github.io/ensemble/configuration) for all options including Telegram notifications, multi-host setup, and agent customization.

## Documentation

- [Getting Started](https://michelhelsdingen.github.io/ensemble/getting-started) — Prerequisites, install, first team
- [Configuration](https://michelhelsdingen.github.io/ensemble/configuration) — Environment variables, agents, hosts
- [API Reference](https://michelhelsdingen.github.io/ensemble/api) — All HTTP endpoints
- [CLI Reference](https://michelhelsdingen.github.io/ensemble/cli) — Commands and monitor keybindings
- [Collab Scripts](https://michelhelsdingen.github.io/ensemble/collab-scripts) — Shell scripts for automation
- [Architecture](https://michelhelsdingen.github.io/ensemble/architecture) — How it all fits together

## License

[MIT](LICENSE)
