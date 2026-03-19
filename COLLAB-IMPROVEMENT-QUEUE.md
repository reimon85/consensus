# Collab Self-Improvement Queue

Based on competitive analysis of oh-my-claudecode (10k⭐), overstory (1k⭐), myclaude (2.5k⭐), agents (31k⭐).

## What ensemble already uniquely has
- Multi-host support (remote agents via HTTP)
- True peer-to-peer agent communication (team-say/team-read)
- REST API first-class interface
- Agent-program abstraction (agents.json)
- Claude-mem session persistence
- Simultaneous prompt injection

## Improvement Queue (one per /collab iteration)

### Round 1: Telegram notifications on collab complete
- When team disbands, send summary to Telegram
- Bot token and chat ID already in global CLAUDE.md
- Add to orchestra-service.ts disbandTeam()
- Users LOVE getting pinged when their agents finish

### Round 2: Smart agent role assignment
- Instead of both agents doing everything, assign roles:
  - Lead agent: architecture, planning, code review
  - Worker agent: implementation, testing
- Update buildPrompt() in orchestra-service.ts
- Better prompts = better collab output

### Round 3: Cost/token awareness in summary
- Track approximate token usage per agent session
- Show in disband summary: "codex-1: ~12k tokens, claude-2: ~8k tokens"
- Parse from tmux pane output (both CLIs show token counts)

### Round 4: Collab templates / presets
- Pre-defined collab types: "review", "implement", "research", "debug"
- Each with optimized prompts and role assignments
- e.g. /collab review → one agent reads code, other checks for bugs

### Round 5: Git worktree isolation
- Each agent gets its own git worktree (overstory's #1 feature)
- Prevents file conflicts when both agents write
- Merge back on disband

### Round 6: Staged workflow (plan → exec → verify)
- Phase 1: agents plan together
- Phase 2: agents execute the plan
- Phase 3: agents verify each other's work
- Auto-loop if verification fails

### Round 7: Session replay / trace
- collab-replay.sh that replays a past collab session
- Interleaved timeline view
- Useful for debugging and learning

### Round 8: Watchdog / stall detection
- Detect when an agent stops producing output
- Auto-nudge with "Are you still working? Share your progress."
- Kill and restart if truly stuck

## Status
- [x] Round 1
- [x] Round 2
- [x] Round 3
- [x] Round 4
- [x] Round 5
- [x] Round 6
- [ ] Round 7
- [ ] Round 8
