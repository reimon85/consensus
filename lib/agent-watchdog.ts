import fs from 'fs'
import path from 'path'
import { v4 as uuidv4 } from 'uuid'
import type { AgentRuntime } from './agent-runtime'
import type { EnsembleMessage, EnsembleTeam } from '../types/ensemble'
import { detectBlockingPrompt, getResponseForPrompt } from './blocking-prompt-detector'
import { messageBus, createAgentEvent } from './message-bus'

const DEFAULT_POLL_INTERVAL_MS = 30_000
const DEFAULT_NUDGE_MS = 90_000
const DEFAULT_STALL_MS = 180_000
const WATCHDOG_NUDGE_TEXT = 'Are you still working? Share your progress with team-say.'

interface AgentWatchdogState {
  lastMessageAt: string
  nudgedAt?: string
  stalledAt?: string
}

interface AgentWatchdogDeps {
  loadTeams: () => EnsembleTeam[]
  getMessages: (teamId: string) => Promise<EnsembleMessage[]>
  appendMessage: (teamId: string, message: EnsembleMessage) => Promise<void>
  getRuntime: () => Pick<AgentRuntime, 'sendKeys' | 'pasteFromFile' | 'capturePane'>
  resolveAgentProgram: (program: string) => { inputMethod: 'pasteFromFile' | 'sendKeys' }
  isSelf: (hostId?: string) => boolean
  getHostById: (hostId: string) => { url: string } | undefined
  postRemoteSessionCommand: (url: string, sessionName: string, text: string) => Promise<void>
  collabDeliveryFile: (teamId: string, sessionName: string) => string
  now?: () => number
  nudgeAfterMs?: number
  stallAfterMs?: number
  pollIntervalMs?: number
}

function parseDuration(rawValue: string | undefined, fallback: number): number {
  const parsed = Number(rawValue)
  return Number.isFinite(parsed) && parsed > 0 ? parsed : fallback
}

export function getWatchdogNudgeMs(): number {
  return parseDuration(process.env.ENSEMBLE_WATCHDOG_NUDGE_MS, DEFAULT_NUDGE_MS)
}

export function getWatchdogStallMs(): number {
  return parseDuration(process.env.ENSEMBLE_WATCHDOG_STALL_MS, DEFAULT_STALL_MS)
}

export class AgentWatchdog {
  private readonly state = new Map<string, AgentWatchdogState>()
  private readonly timer: NodeJS.Timeout
  private readonly now: () => number
  private readonly nudgeAfterMs: number
  private readonly stallAfterMs: number

  constructor(private readonly deps: AgentWatchdogDeps) {
    this.now = deps.now ?? Date.now
    this.nudgeAfterMs = deps.nudgeAfterMs ?? getWatchdogNudgeMs()
    this.stallAfterMs = deps.stallAfterMs ?? getWatchdogStallMs()

    this.timer = setInterval(() => {
      void this.poll().catch(err => {
        console.error('[Watchdog] poll error:', err)
      })
    }, deps.pollIntervalMs ?? DEFAULT_POLL_INTERVAL_MS)
    this.timer.unref()
  }

  async poll(): Promise<void> {
    const activeTeams = this.deps.loadTeams().filter(team => team.status === 'active')
    const activeTeamIds = new Set(activeTeams.map(team => team.id))

    for (const key of this.state.keys()) {
      const teamId = key.split(':', 1)[0]
      if (!activeTeamIds.has(teamId)) this.state.delete(key)
    }

    for (const team of activeTeams) {
      await this.pollTeam(team)
    }
  }

  stop(): void {
    clearInterval(this.timer)
    this.state.clear()
  }

  private async pollTeam(team: EnsembleTeam): Promise<void> {
    const messages = await this.deps.getMessages(team.id)
    const activeAgents = team.agents.filter(candidate => candidate.status === 'active')
    const activeAgentNames = new Set(activeAgents.map(agent => agent.name))

    for (const key of this.state.keys()) {
      if (!key.startsWith(`${team.id}:`)) continue
      const agentName = key.slice(team.id.length + 1)
      if (!activeAgentNames.has(agentName)) this.state.delete(key)
    }

    for (const agent of activeAgents) {
      const stateKey = `${team.id}:${agent.name}`
      const lastAgentMessage = [...messages].reverse().find(message => message.from === agent.name)
      const lastMessageAt = lastAgentMessage?.timestamp || team.createdAt
      const previousState = this.state.get(stateKey)

      if (!previousState) {
        this.state.set(stateKey, { lastMessageAt })
      } else if (previousState.lastMessageAt !== lastMessageAt) {
        this.state.set(stateKey, { lastMessageAt })
        continue
      }

      const lastMessageMs = new Date(lastMessageAt).getTime()
      if (Number.isNaN(lastMessageMs)) continue

      const nowMs = this.now()
      const idleMs = nowMs - lastMessageMs
      const currentState = this.state.get(stateKey) ?? { lastMessageAt }

      if (!currentState.nudgedAt && idleMs >= this.nudgeAfterMs) {
        try {
          await this.nudgeAgent(team, agent, currentState.lastMessageAt)
          this.state.set(stateKey, {
            lastMessageAt,
            nudgedAt: new Date(nowMs).toISOString(),
          })
        } catch (err) {
          const reason = err instanceof Error ? err.message : String(err)
          try {
            await this.deps.appendMessage(team.id, {
              id: uuidv4(),
              teamId: team.id,
              from: 'ensemble',
              to: 'team',
              content: `❌ Watchdog failed to nudge ${agent.name}: ${reason}`,
              type: 'chat',
              timestamp: new Date(nowMs).toISOString(),
            })
          } catch (appendErr) {
            console.error('[Watchdog] Failed to log nudge error:', appendErr)
          }
        }
        continue
      }

      if (!currentState.nudgedAt || currentState.stalledAt) continue

      const nudgedMs = new Date(currentState.nudgedAt).getTime()
      if (Number.isNaN(nudgedMs) || nowMs - nudgedMs < this.stallAfterMs) continue

      console.warn(`[Watchdog] Agent ${agent.name} in team ${team.id} stalled after watchdog nudge`)
      await this.deps.appendMessage(team.id, {
        id: uuidv4(),
        teamId: team.id,
        from: 'ensemble',
        to: 'team',
        content: `⚠️ Watchdog marked ${agent.name} as stalled after ${Math.round((nowMs - nudgedMs) / 1000)}s without progress after nudge`,
        type: 'chat',
        timestamp: new Date(nowMs).toISOString(),
      })
      messageBus.emitAgentEvent(createAgentEvent('stalled', team.id, agent.name, { idleMs }))
      this.state.set(stateKey, {
        ...currentState,
        stalledAt: new Date(nowMs).toISOString(),
      })
    }
  }

  private async nudgeAgent(
    team: EnsembleTeam,
    agent: { name: string; program: string; hostId?: string },
    lastMessageAt: string,
  ): Promise<void> {
    const timestamp = new Date(this.now()).toISOString()
    await this.deps.appendMessage(team.id, {
      id: uuidv4(),
      teamId: team.id,
      from: 'ensemble',
      to: 'team',
      content: `👀 Watchdog nudged ${agent.name}: ${WATCHDOG_NUDGE_TEXT}`,
      type: 'chat',
      timestamp,
    })
    messageBus.emitAgentEvent(createAgentEvent('nudged', team.id, agent.name, { idleMs: Date.now() - new Date(lastMessageAt).getTime() }))

    const sessionName = `${team.name}-${agent.name}`
    if (agent.hostId && !this.deps.isSelf(agent.hostId)) {
      const host = this.deps.getHostById(agent.hostId)
      if (host) {
        await this.deps.postRemoteSessionCommand(host.url, sessionName, WATCHDOG_NUDGE_TEXT)
      }
      return
    }

    // Always use pasteFromFile to avoid shell escaping issues with sendKeys
    const runtime = this.deps.getRuntime()
    const filePath = this.deps.collabDeliveryFile(team.id, sessionName)
    fs.mkdirSync(path.dirname(filePath), { recursive: true })
    fs.writeFileSync(filePath, WATCHDOG_NUDGE_TEXT)
    await runtime.pasteFromFile(sessionName, filePath)

    // After nudging, capture pane and check for blocking prompts
    // Use a small delay to let the agent process the nudge
    await new Promise(resolve => setTimeout(resolve, 2000))
    await this.checkAndUnblockAgent(team, agent.name, sessionName)
  }

  private async checkAndUnblockAgent(team: EnsembleTeam, agentName: string, sessionName: string): Promise<void> {
    const runtime = this.deps.getRuntime()

    // Check if the pane contains a blocking prompt
    const paneContent = await runtime.capturePane(sessionName)
    if (!paneContent) return

    const detection = detectBlockingPrompt(paneContent)
    if (!detection.detected) return

    const response = getResponseForPrompt(detection)
    messageBus.emitAgentEvent(createAgentEvent('blocked', team.id, agentName, {
      blockedPrompt: detection.matchedText,
      response,
    }))

    console.log(`[Watchdog] Detected blocking prompt in ${agentName}: "${detection.matchedText}" -> "${response}"`)

    // Send the response to unblock
    const filePath = this.deps.collabDeliveryFile(team.id, sessionName)
    fs.writeFileSync(filePath, response)
    await runtime.pasteFromFile(sessionName, filePath)
  }
}

export { DEFAULT_POLL_INTERVAL_MS, DEFAULT_NUDGE_MS, DEFAULT_STALL_MS, WATCHDOG_NUDGE_TEXT }
