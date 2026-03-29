---
title: Architecture
nav_order: 7
---

# Architecture

## Overview

```
                    ┌─────────────┐
                    │  HTTP API   │
                    │  server.ts  │
                    └──────┬──────┘
                           │
                    ┌──────▼──────┐
                    │  Ensemble   │
                    │   Service   │
                    └──┬───┬───┬──┘
                       │   │   │
              ┌────────┘   │   └────────┐
              ▼            ▼            ▼
        ┌──────────┐ ┌──────────┐ ┌──────────┐
        │ Registry │ │ Spawner  │ │ Watchdog │
        │  (JSONL) │ │  (tmux)  │ │  (idle)  │
        └──────────┘ └──────────┘ └──────────┘
                           │
                    ┌──────▼──────┐
                    │ tmux panes  │
                    │  agent-1    │
                    │  agent-2    │
                    └─────────────┘
```

## Directory structure

```
ensemble/
├── server.ts                  # HTTP server (port 23000)
├── agents.json                # Agent program definitions
├── collab-templates.json      # Pre-built team templates
├── cli/
│   ├── ensemble.ts            # CLI entry point
│   └── monitor.ts             # TUI monitor (blessed-based)
├── services/
│   └── ensemble-service.ts   # Team lifecycle, messaging, auto-disband
├── lib/
│   ├── agent-config.ts        # agents.json loader + program resolver
│   ├── agent-runtime.ts       # AgentRuntime interface + TmuxRuntime
│   ├── agent-spawner.ts       # Local/remote agent spawn lifecycle
│   ├── agent-watchdog.ts      # Idle detection + nudge + blocking prompt detection
│   ├── blocking-prompt-detector.ts # Pattern matching for Y/N prompts
│   ├── collab-paths.ts        # /tmp/ensemble/* path resolver
│   ├── ensemble-paths.ts      # Data directory paths
│   ├── ensemble-registry.ts  # JSONL persistence (async, emits to messageBus)
│   ├── hosts-config.ts        # Multi-host discovery + lookup
│   ├── message-bus.ts         # EventEmitter singleton for real-time events
│   ├── staged-workflow.ts     # Multi-phase workflows (event-driven)
│   └── worktree-manager.ts    # Git worktree isolation
├── types/
│   ├── agent-program.ts       # AgentProgram interface
│   ├── ensemble.ts            # Team, Message, Agent types
│   └── messages.ts            # Event and topic types for pub/sub
├── scripts/
│   ├── collab-launch.sh       # All-in-one team launcher
│   ├── collab-poll.sh         # Single-shot message poller
│   ├── collab-livefeed.sh     # Continuous live feed
│   ├── collab-status.sh       # Multi-team dashboard
│   ├── collab-replay.sh       # Session replay
│   ├── collab-cleanup.sh      # Temp file cleanup
│   ├── team-say.sh            # Agent message send
│   ├── team-read.sh           # Agent message read
│   ├── ensemble-bridge.sh    # File→HTTP message bridge
│   ├── parse-messages.py      # Shared JSONL parser
│   └── collab-paths.sh        # Shared path functions
└── tests/
    ├── ensemble.test.ts      # Integration tests
    └── agent-watchdog.test.ts # Watchdog unit tests
```

## Key components

### Ensemble Service

The brain. Manages team lifecycle:

- **Create** — Validate request, persist team, spawn agents, start watchdog
- **Message routing** — Deliver messages between agents via tmux sessions
- **Auto-disband** — Detect completion signals, idle teams, failed agents
- **Disband** — Stop agents, merge worktrees, write summary, send notifications

### Ensemble Registry

Persistence layer using JSONL flat files. File locking prevents corruption from concurrent access. Stores:

- Team metadata (`teams.json`)
- Message logs (`messages.jsonl` per team)
- Runtime state (PID files, markers)

### Agent Runtime (tmux)

Each agent runs in an isolated tmux session:

1. Session created with working directory
2. Agent CLI launched with configured flags
3. Readiness detected via prompt marker
4. Prompts delivered via `sendKeys` or `pasteFromFile`
5. Graceful shutdown on disband

### Agent Watchdog

Monitors agent activity and prevents stalls:

- **Nudge** — After 90s idle, sends a gentle reminder
- **Stall detection** — After 180s, marks agent as stalled
- Configurable via `ENSEMBLE_WATCHDOG_NUDGE_MS` and `ENSEMBLE_WATCHDOG_STALL_MS`

### Ensemble Bridge

Shell process that bridges the gap between file-based agent communication (`team-say.sh` writes to JSONL) and the HTTP API:

- Polls `messages.jsonl` for new lines
- POSTs each message to the ensemble API
- Exponential backoff on failures
- Skips client errors (4xx), retries server errors (5xx)
- Single-instance guard prevents duplicates

## Data flow

```
Agent writes message
       │
       ▼
team-say.sh → messages.jsonl (atomic write with flock)
       │
       ▼
ensemble-bridge.sh polls file
       │
       ▼
POST /api/ensemble/teams/:id (HTTP)
       │
       ▼
ensemble-service routes message
       │
       ▼
Delivers to target agent's tmux session
       │
       ▼
Agent reads via team-read.sh (polls HTTP API)
```

## Runtime files

All runtime data lives in `/tmp/ensemble/<team-id>/`:

| File | Purpose |
|---|---|
| `messages.jsonl` | Full message log (deprecated) |
| `summary.txt` | Written on disband |
| `.finished` | Cleanup signal marker |
| `bridge.pid` | Bridge process ID |
| `bridge.log` | Bridge debug output |
| `poller.pid` | Background poller PID |
| `feed.txt` | Feed cache |
| `team-id` | Team ID marker |
| `prompts/*.txt` | Per-agent initial prompts |
| `delivery/*.txt` | Multi-line prompt delivery files |
| `.poll-seen` | Poll state tracker |

---

## Event-Driven Architecture (post-refactor)

### The Problem (before)

- File-based polling everywhere: `team-say.sh` writes JSONL, bridge polls and POSTs to API
- 6 independent polling loops at different intervals
- Zero real-time messaging; monitor, watchdog, and workflow all polled separately
- Watchdog could not detect blocking prompts (Y/N dialogs, "Press Enter to continue")
- ~2-4 second latency for message delivery due to polling intervals

### The Solution (after)

- `appendMessage()` is now `async` and non-blocking
- After persisting to `feed.jsonl`, immediately emits to `messageBus` (EventEmitter singleton)
- All subscribers (watchdog, staged workflow, monitor, future consumers) receive messages instantly
- Watchdog captures tmux pane on nudge to detect blocking prompts and auto-responds
- BlockingPromptDetector pattern-matches common prompts and sends the appropriate response

### New Modules

| Module | Purpose |
|---|---|
| `lib/message-bus.ts` | EventEmitter facade with typed events for messages, agents, teams, phases |
| `lib/blocking-prompt-detector.ts` | Pattern matching for "Continue? [Y/n]", "Proceed? [y/N]", etc. |
| `types/messages.ts` | Event and topic types for pub/sub |

### Key Files Changed

| File | Change |
|---|---|
| `lib/ensemble-registry.ts` | `appendMessage()` is now `async`; after persist, calls `messageBus.emitMessage()` |
| `lib/agent-watchdog.ts` | Event-driven idle detection; captures tmux pane on nudge to detect blocking prompts |
| `lib/staged-workflow.ts` | Polling replaced with `messageBus.on('message', ...)` subscription |
| `services/ensemble-service.ts` | All `appendMessage` calls are now `await`-ed |

### Events Emitted

```typescript
// New chat message (from any agent)
messageBus.on('message', (message: EnsembleMessage) => void)

// Agent blocked at Y/N prompt (watchdog captured pane and auto-responded)
messageBus.on('agent:blocked', (event: AgentEvent) => void)

// Watchdog nudged an idle agent
messageBus.on('agent:nudged', (event: AgentEvent) => void)

// Agent marked as stalled after nudge with no recovery
messageBus.on('agent:stalled', (event: AgentEvent) => void)

// Staged workflow phase advanced or timed out
messageBus.on('phase:advance', (event: PhaseEvent) => void)
```

### Blocking Prompt Patterns Detected

| Pattern | Response |
|---|---|
| `continue? [Y/n]` | `y` |
| `proceed? [y/N]` | `n` |
| `overwrite? [y/N]` | `n` |
| `skip? [y/N]` | `n` |
| `cancel? [y/N]` | `n` |
| `do you want to continue?` | `y` |
| `confirm? [y/N]` | `y` |
| `press enter to continue` | `\r` |
| `hit enter to proceed` | `\r` |
| `permission denied [y/N]` | `y` (retry) |
| `sudo password` | `\x03` (Ctrl+C) |
| `error... retry? [y/N]` | `y` |
| `failed... try again? [y/N]` | `y` |
| Generic `[y/N]` | `y` |
| Generic `?[Y/n]` | `y` |

### Data Flow (post-refactor)

```
Agent sends message
       │
       ▼
team-say.sh → messages.jsonl (file)
       │
       ▼
ensemble-bridge.sh polls file
       │
       ▼
POST /api/ensemble/teams/:id
       │
       ▼
appendMessage() async persist to feed.jsonl
       │
       ├──────────────────────────┐
       ▼                          ▼
messageBus.emitMessage()    monitor polls feed.jsonl
       │                          │
       ▼                          │
All subscribers receive         │
instantly (no polling):          │
- staged-workflow                │
- agent-watchdog                  │
- future consumers               │
```
