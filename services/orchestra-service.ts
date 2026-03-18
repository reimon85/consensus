/**
 * Orchestra Service — Standalone
 * No dependency on ai-maestro's agent-registry or agents-core-service.
 * Uses agent-spawner.ts for local/remote agent lifecycle.
 */

import { v4 as uuidv4 } from 'uuid'
import type { OrchestraTeam, OrchestraMessage, CreateTeamRequest } from '../types/orchestra'
import {
  createTeam, getTeam, updateTeam, loadTeams,
  appendMessage, getMessages,
} from '../lib/orchestra-registry'
import {
  spawnLocalAgent, killLocalAgent,
  spawnRemoteAgent as spawnRemote, killRemoteAgent,
  postRemoteSessionCommand, isRemoteSessionReady,
} from '../lib/agent-spawner'
import { isSelf, getHostById, getSelfHostId } from '../lib/hosts-config'
import { getRuntime } from '../lib/agent-runtime'
import { resolveAgentProgram } from '../lib/agent-config'
import fs from 'fs'

interface ServiceResult<T> {
  data?: T
  error?: string
  status: number
}

const IDLE_DISBAND_THRESHOLD_MS = 60_000
const IDLE_CHECK_INTERVAL_MS = 15_000
const COMPLETION_PATTERNS = [
  /\bafgerond\b/i,
  /\bdone\b/i,
  /\bcomplete(?:d)?\b/i,
  /\bklaar\b/i,
  /\btot de volgende\b/i,
]

class OrchestraService {
  private readonly disbandingTeams = new Set<string>()
  private readonly idleCheckTimer: NodeJS.Timeout

  constructor() {
    this.idleCheckTimer = setInterval(() => {
      void this.checkIdleTeams()
    }, IDLE_CHECK_INTERVAL_MS)
    this.idleCheckTimer.unref()

    for (const signal of ['SIGINT', 'SIGTERM', 'beforeExit', 'exit'] as const) {
      process.once(signal, () => this.stop())
    }
  }

  async checkIdleTeams(): Promise<void> {
    const teams = loadTeams().filter(team => team.status === 'active')

    for (const team of teams) {
      if (this.disbandingTeams.has(team.id)) continue
      if (!this.shouldAutoDisband(team)) continue

      this.disbandingTeams.add(team.id)

      try {
        appendMessage(team.id, {
          id: uuidv4(),
          teamId: team.id,
          from: 'orchestra',
          to: 'team',
          content: 'Auto-disband triggered after 60s idle and completion-like agent messages',
          type: 'chat',
          timestamp: new Date().toISOString(),
        })

        writeDisbandSummary(team.id)
        await disbandTeam(team.id)
      } catch (err) {
        console.error(`[Orchestra] Auto-disband failed for ${team.id}:`, err)
      } finally {
        this.disbandingTeams.delete(team.id)
      }
    }
  }

  private shouldAutoDisband(team: OrchestraTeam): boolean {
    const messages = getMessages(team.id)
    const nonOrchestraMessages = messages.filter(message => message.from !== 'orchestra')
    const lastMessage = nonOrchestraMessages[nonOrchestraMessages.length - 1]
    if (!lastMessage) return false

    // Robust timestamp handling: skip idle check if no timestamp available
    const lastTimestamp = lastMessage.timestamp
      ? new Date(lastMessage.timestamp).getTime()
      : NaN
    if (Number.isNaN(lastTimestamp)) return false

    const idleForMs = Date.now() - lastTimestamp
    if (idleForMs <= IDLE_DISBAND_THRESHOLD_MS) return false

    const activeAgents = team.agents.filter(agent => agent.status === 'active')
    if (activeAgents.length === 0) return false

    return activeAgents.every(agent => {
      const lastAgentMessage = [...messages].reverse().find(message => message.from === agent.name)
      return Boolean(lastAgentMessage && this.hasCompletionSignal(lastAgentMessage.content))
    })
  }

  private hasCompletionSignal(content: string): boolean {
    return COMPLETION_PATTERNS.some(pattern => pattern.test(content))
  }

  private stop(): void {
    clearInterval(this.idleCheckTimer)
  }
}

const orchestraService = new OrchestraService()

async function routeToHost(_program: string, preferredHostId?: string): Promise<string> {
  if (preferredHostId) {
    const host = getHostById(preferredHostId)
    if (host) return preferredHostId
    console.warn(`[Orchestra] Unknown host ${preferredHostId}, falling back to self`)
  }
  return getSelfHostId()
}

export async function createOrchestraTeam(
  request: CreateTeamRequest
): Promise<ServiceResult<{ team: OrchestraTeam }>> {
  const team = createTeam(request)
  const cwd = request.workingDirectory || process.cwd()

  const buildPrompt = (agentName: string, otherNames: string[]) => {
    const teamSayCmd = `/usr/local/bin/team-say ${team.id} ${agentName} ${otherNames[0] || 'team'}`
    const teamReadCmd = `/usr/local/bin/team-read ${team.id}`
    return [
      `You are ${agentName} in team "${team.name}" with teammate ${otherNames.join(', ')}.`,
      `Task: ${team.description}`,
      `COMMUNICATION RULES:`,
      `1. Send findings: ${teamSayCmd} "your message"`,
      `2. Read teammate messages: ${teamReadCmd}`,
      `3. After EVERY analysis step, run team-say to share what you found`,
      `4. After EVERY team-say, run team-read to check for responses`,
      `5. If teammate shared findings, RESPOND to them`,
      `6. Keep alternating: analyze, share, read, respond, analyze`,
      `Start NOW: greet your teammate with team-say, then begin.`,
    ].join(' ')
  }

  // Phase 1: Spawn all agents
  for (let i = 0; i < team.agents.length; i++) {
    const agentSpec = team.agents[i]
    const hostId = await routeToHost(agentSpec.program, request.agents[i].hostId)
    const agentName = `${team.name}-${agentSpec.name}`
    const prompt = buildPrompt(agentSpec.name, team.agents.filter((_, j) => j !== i).map(a => a.name))

    const promptFile = `/tmp/orchestra-prompt-${agentName}.txt`
    fs.writeFileSync(promptFile, prompt)

    try {
      let agentId: string
      console.log(`[Orchestra] Spawning ${agentName} (${agentSpec.program}) on ${hostId} (self=${isSelf(hostId)})`)

      if (isSelf(hostId)) {
        const spawned = await spawnLocalAgent({
          name: agentName,
          program: agentSpec.program,
          workingDirectory: cwd,
          hostId,
        })
        agentId = spawned.id
      } else {
        const host = getHostById(hostId)
        if (!host) throw new Error(`Unknown host: ${hostId}`)
        const remote = await spawnRemote(host.url, agentName, agentSpec.program, cwd, team.description, team.name)
        agentId = remote.id
      }

      team.agents[i].agentId = agentId
      team.agents[i].hostId = hostId
      team.agents[i].status = 'active'

      appendMessage(team.id, {
        id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
        content: `${agentSpec.name} (${agentSpec.program} @ ${hostId}) has joined #${team.name}`,
        type: 'chat', timestamp: new Date().toISOString(),
      })
    } catch (err: unknown) {
      const message = err instanceof Error ? err.message : String(err)
      console.error(`[Orchestra] Failed to spawn ${agentName}:`, message)
      team.agents[i].status = 'idle'
      appendMessage(team.id, {
        id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
        content: `Failed to spawn ${agentName}: ${message}`,
        type: 'chat', timestamp: new Date().toISOString(),
      })
    }
  }

  updateTeam(team.id, { ...team, status: 'active' })

  // Phase 2: Wait for ALL agents to be ready, then inject prompts
  const activeAgents = team.agents.filter(a => a.status === 'active')
  if (activeAgents.length >= 2) {
    const runtime = getRuntime()

    const waitForReady = async (
      sessionName: string, program: string, hostId?: string, maxWait = 60000,
    ): Promise<boolean> => {
      const start = Date.now()
      const agentConfig = resolveAgentProgram(program)
      const readyMarker = agentConfig.readyMarker
      while (Date.now() - start < maxWait) {
        try {
          if (hostId && !isSelf(hostId)) {
            const host = getHostById(hostId)
            if (host && await isRemoteSessionReady(host.url, sessionName)) {
              console.log(`[Orchestra] ${sessionName} is remotely reachable (${Math.round((Date.now() - start) / 1000)}s)`)
              return true
            }
          } else {
            const output = await runtime.capturePane(sessionName, 50)
            if (output.includes(readyMarker)) {
              console.log(`[Orchestra] ${sessionName} is ready (${Math.round((Date.now() - start) / 1000)}s)`)
              return true
            }
          }
        } catch { /* not ready yet */ }
        await new Promise(r => setTimeout(r, 1000))
      }
      console.error(`[Orchestra] ${sessionName} did not become ready within ${maxWait / 1000}s`)
      return false
    }

    console.log(`[Orchestra] Waiting for all ${activeAgents.length} agents to be ready...`)
    const readyResults = await Promise.all(
      activeAgents.map(agent => {
        const sessionName = `${team.name}-${agent.name}`
        return waitForReady(sessionName, agent.program, agent.hostId).then(ready => ({ agent, sessionName, ready }))
      })
    )

    const ready = readyResults.filter(r => r.ready)
    const notReady = readyResults.filter(r => !r.ready)

    for (const nr of notReady) {
      appendMessage(team.id, {
        id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
        content: `❌ ${nr.agent.name} failed to start — timed out`,
        type: 'chat', timestamp: new Date().toISOString(),
      })
    }

    if (ready.length < 2) {
      appendMessage(team.id, {
        id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
        content: `❌ Team start aborted: only ${ready.length}/${activeAgents.length} agents ready`,
        type: 'chat', timestamp: new Date().toISOString(),
      })
      return { data: { team }, status: 201 }
    }

    await new Promise(r => setTimeout(r, 2000))

    // Phase 3: Inject prompts simultaneously
    console.log(`[Orchestra] All ${ready.length} agents ready — injecting prompts simultaneously`)
    await Promise.all(
      ready.map(async ({ agent, sessionName }) => {
        const promptFile = `/tmp/orchestra-prompt-${sessionName}.txt`
        try {
          if (agent.hostId && !isSelf(agent.hostId)) {
            const host = getHostById(agent.hostId)
            if (host) {
              const prompt = fs.readFileSync(promptFile, 'utf-8')
              await postRemoteSessionCommand(host.url, sessionName, prompt)
            }
          } else {
            const agentCfg = resolveAgentProgram(agent.program)
            if (agentCfg.inputMethod === 'pasteFromFile') {
              await runtime.pasteFromFile(sessionName, promptFile)
            } else {
              const prompt = fs.readFileSync(promptFile, 'utf-8')
              await runtime.sendKeys(sessionName, prompt, { literal: true, enter: true })
            }
          }
          console.log(`[Orchestra] ✓ Prompt injected into ${sessionName}`)
        } catch (err) {
          const message = err instanceof Error ? err.message : String(err)
          appendMessage(team.id, {
            id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
            content: `❌ Delivery to ${agent.name} failed: ${message}`,
            type: 'chat', timestamp: new Date().toISOString(),
          })
          console.error(`[Orchestra] ✗ Failed to inject prompt into ${sessionName}:`, err)
        }
      })
    )

    appendMessage(team.id, {
      id: uuidv4(), teamId: team.id, from: 'orchestra', to: 'team',
      content: `🚀 All ${ready.length} agents received their task — collaboration started`,
      type: 'chat', timestamp: new Date().toISOString(),
    })
  }

  return { data: { team }, status: 201 }
}

export function getOrchestraTeam(teamId: string): ServiceResult<{ team: OrchestraTeam; messages: OrchestraMessage[] }> {
  const team = getTeam(teamId)
  if (!team) return { error: 'Team not found', status: 404 }
  return { data: { team, messages: getMessages(teamId) }, status: 200 }
}

export function listOrchestraTeams(): ServiceResult<{ teams: OrchestraTeam[] }> {
  return { data: { teams: loadTeams() }, status: 200 }
}

export async function checkIdleTeams(): Promise<void> {
  await orchestraService.checkIdleTeams()
}

export function getTeamFeed(teamId: string, since?: string): ServiceResult<{ messages: OrchestraMessage[] }> {
  const team = getTeam(teamId)
  if (!team) return { error: 'Team not found', status: 404 }
  return { data: { messages: getMessages(teamId, since) }, status: 200 }
}

export async function sendTeamMessage(
  teamId: string, to: string, content: string, from?: string,
): Promise<ServiceResult<{ message: OrchestraMessage }>> {
  const team = getTeam(teamId)
  if (!team) return { error: 'Team not found', status: 404 }

  const message: OrchestraMessage = {
    id: uuidv4(), teamId, from: from || 'user', to, content,
    type: 'chat', timestamp: new Date().toISOString(),
  }
  appendMessage(teamId, message)

  // Determine which agents should receive this message in their tmux pane
  const sender = from || 'user'
  const recipients = to === 'team'
    ? team.agents.filter(a => a.status === 'active' && a.name !== sender)
    : team.agents.filter(a => a.status === 'active' && a.name === to)

  const runtime = getRuntime()

  for (const targetAgent of recipients) {
    try {
      const sessionName = `${team.name}-${targetAgent.name}`
      // Wrap message with sender context + response nudge
      const deliveryText = [
        `[Team message from ${sender}]: ${content}`,
        `→ Respond with team-say. Then run team-read to check for more messages.`,
      ].join('\n')

      if (targetAgent.hostId && !isSelf(targetAgent.hostId)) {
        const host = getHostById(targetAgent.hostId)
        if (host) await postRemoteSessionCommand(host.url, sessionName, deliveryText)
      } else {
        const agentCfg = resolveAgentProgram(targetAgent.program)
        if (agentCfg.inputMethod === 'pasteFromFile') {
          const tmpFile = `/tmp/orchestra-delivery-${sessionName}.txt`
          fs.writeFileSync(tmpFile, deliveryText)
          await runtime.pasteFromFile(sessionName, tmpFile)
        } else {
          await runtime.sendKeys(sessionName, deliveryText, { literal: true, enter: true })
        }
      }
    } catch (err) {
      const reason = err instanceof Error ? err.message : String(err)
      appendMessage(teamId, {
        id: uuidv4(), teamId, from: 'orchestra', to: 'team',
        content: `❌ Delivery to ${targetAgent.name} failed: ${reason}`,
        type: 'chat', timestamp: new Date().toISOString(),
      })
    }
  }

  return { data: { message }, status: 200 }
}

/**
 * Write a summary file for a disbanded team — used by auto-disband and can be
 * picked up by the background watcher in the Claude Code session.
 * Mirrors the format from cli/monitor.ts disbandTeam().
 */
export function writeDisbandSummary(teamId: string): void {
  const team = getTeam(teamId)
  if (!team) return

  const messages = getMessages(teamId)
  const agentMsgs = messages.filter(m => m.from !== 'orchestra' && m.from !== 'user')
  if (agentMsgs.length === 0) return

  const now = new Date()
  const createdAt = new Date(team.createdAt)
  const durationMs = now.getTime() - createdAt.getTime()
  const durationMin = Math.round(durationMs / 60000)
  const duration = durationMin >= 60
    ? `${Math.floor(durationMin / 60)}h ${durationMin % 60}m`
    : `${durationMin}m`

  const agents = [...new Set(agentMsgs.map(m => m.from))]
  const summaryText = agents.map(agent => {
    const msgs = agentMsgs.filter(m => m.from === agent)
    const first = msgs[0]?.content.replace(/\/tmp\/orchestra-msgs/g, '').trim() || ''
    const last = msgs[msgs.length - 1]?.content.replace(/\/tmp\/orchestra-msgs/g, '').trim() || ''
    return `${agent} (${msgs.length} msgs):\n  Start: ${first.slice(0, 300)}\n  Eind: ${last.slice(0, 500)}`
  }).join('\n\n')

  const summaryFile = `/tmp/collab-summary-${teamId}.txt`
  fs.writeFileSync(
    summaryFile,
    `Task: ${team.description || 'unknown'}\nDuration: ${duration}\nMessages: ${agentMsgs.length}\n\n${summaryText}`,
  )
  console.log(`[Orchestra] Summary written to ${summaryFile}`)
}

export async function disbandTeam(teamId: string): Promise<ServiceResult<{ team: OrchestraTeam }>> {
  const team = getTeam(teamId)
  if (!team) return { error: 'Team not found', status: 404 }

  for (const agent of team.agents) {
    if (agent.status === 'active') {
      appendMessage(teamId, {
        id: uuidv4(), teamId, from: 'orchestra', to: 'team',
        content: `${agent.name} has left #${team.name}`,
        type: 'chat', timestamp: new Date().toISOString(),
      })

      try {
        if (agent.hostId && !isSelf(agent.hostId)) {
          const host = getHostById(agent.hostId)
          if (host && agent.agentId) await killRemoteAgent(host.url, agent.agentId)
        } else {
          await killLocalAgent(`${team.name}-${agent.name}`)
        }
      } catch { /* session may already be gone */ }
    }
  }

  const updated = updateTeam(teamId, {
    status: 'disbanded',
    completedAt: new Date().toISOString(),
  })

  // Optional: save session summary to claude-mem
  try {
    const messages = getMessages(teamId)
    const agentMessages = messages.filter(m => m.from !== 'orchestra' && m.from !== 'user')
    if (agentMessages.length > 0) {
      const duration = updated!.completedAt && team.createdAt
        ? Math.round((new Date(updated!.completedAt).getTime() - new Date(team.createdAt).getTime()) / 60000)
        : 0

      // Build a concise summary: first message (plan) + last 2 messages (conclusion) per agent
      const agents = [...new Set(agentMessages.map(m => m.from))]
      const summaryParts = agents.map(agent => {
        const msgs = agentMessages.filter(m => m.from === agent)
        const first = msgs[0]?.content.slice(0, 300) || ''
        const last = msgs[msgs.length - 1]?.content.slice(0, 500) || ''
        return `${agent} (${msgs.length} msgs):\n  Start: ${first}\n  Eind: ${last}`
      })

      // Detect the working directory as project hint
      const cwdMatch = team.description.match(/workingDirectory[:\s]*([^\s,}]+)/)
      const project = process.env.ENSEMBLE_PROJECT
        || (cwdMatch ? cwdMatch[1].split('/').pop() : undefined)
        || 'ensemble'

      fetch('http://localhost:37777/api/observations', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        body: JSON.stringify({
          title: `Collab: ${team.description.slice(0, 80)}`,
          subtitle: `${agents.join(' + ')} — ${duration}min, ${agentMessages.length} messages`,
          type: 'discovery',
          narrative: `Team "${team.name}" (${duration}min):\nTask: ${team.description.slice(0, 200)}\n\n${summaryParts.join('\n\n')}`,
          project,
        }),
      }).catch(() => {})
    }
  } catch { /* non-fatal */ }

  return { data: { team: updated! }, status: 200 }
}
