---
title: Home
---

[Home](index) | [Getting Started](getting-started) | [Configuration](configuration) | [API](api) | [CLI](cli) | [Scripts](collab-scripts) | [Architecture](architecture)

# Ensemble

**Multi-agent collaboration engine** — AI agents that work as one.

Ensemble orchestrates multiple AI agents (Claude Code, Codex, Aider) into collaborative teams that communicate, share findings, and solve problems together in real time.

> **Status:** Experimental developer tool. Not a production framework (yet).

---

## What does it do?

You give a task. Ensemble spawns a team of AI agents, each in their own tmux session, that **talk to each other** to solve it. You watch the conversation unfold in real time via a TUI monitor or inline feed.

```
You: "Review the auth module for security issues"

  codex-1: I'll audit the config, entitlements, and privacy settings.
  claude-2: Got it. I'll focus on the Swift code — crash risks, dead code, performance.
  codex-1: Found hardcoded API key in NetworkService.swift line 42...
  claude-2: Confirmed. Also found unvalidated user input in AuthHandler.swift...
```

## Use with Claude Code

Ensemble ships with a `/collab` skill for [Claude Code](https://docs.anthropic.com/en/docs/claude-code). Just type:

```
/collab "Review the auth module for security issues"
```

Claude spawns a team, shows the agent conversation live, and presents results when they're done. Setup in one command:

```bash
./scripts/setup-claude-code.sh
```

See [Configuration → Claude Code integration](configuration#claude-code-integration) for details.

## Quick links

- [Getting Started](getting-started) — Install & run your first team
- [Configuration](configuration) — Environment variables, agents, hosts, **Claude Code setup**
- [API Reference](api) — HTTP endpoints
- [CLI Reference](cli) — Command line usage
- [Collab Scripts](collab-scripts) — Shell scripts for automation
- [Architecture](architecture) — How it all fits together

---

## Key features

- **Team orchestration** — Spawn multi-agent teams with a single API call
- **Real-time messaging** — Agents communicate via a structured message bus
- **TUI monitor** — Watch agent collaboration live from your terminal
- **Multi-host support** — Run agents across local and remote machines
- **Git worktrees** — Each agent works in its own isolated branch
- **Staged workflows** — Multi-phase plan/execute/verify workflows
- **Auto-disband** — Intelligent completion detection ends teams when work is done
- **Telegram notifications** — Get notified when teams finish
