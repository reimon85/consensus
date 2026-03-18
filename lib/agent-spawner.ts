/**
 * Agent Spawner — Standalone agent lifecycle management for Orchestra
 * Replaces ai-maestro's agent-registry + agents-core-service with a minimal implementation.
 * Handles: tmux session creation, program launching, and session cleanup.
 */

import { v4 as uuidv4 } from 'uuid'
import { getRuntime } from './agent-runtime'
import { getSelfHostId } from './hosts-config'
import { buildAgentCommand } from './agent-config'

export interface SpawnedAgent {
  id: string
  name: string
  program: string
  sessionName: string
  workingDirectory: string
  hostId: string
}

interface SpawnAgentOptions {
  name: string
  program: string
  workingDirectory: string
  hostId?: string
}

/** Compute tmux session name from agent name */
function computeSessionName(agentName: string): string {
  return agentName.replace(/[^a-zA-Z0-9\-_.]/g, '')
}

/** Resolve program name to CLI command using agents.json config */
function resolveStartCommand(program: string): string {
  return buildAgentCommand(program)
}

/**
 * Spawn a local agent: create tmux session + start the AI program
 */
export async function spawnLocalAgent(options: SpawnAgentOptions): Promise<SpawnedAgent> {
  const runtime = getRuntime()
  const agentId = uuidv4()
  const sessionName = computeSessionName(options.name)
  const cwd = options.workingDirectory || process.cwd()
  const hostId = options.hostId || getSelfHostId()

  // Create tmux session
  await runtime.createSession(sessionName, cwd)

  // Small delay for session init
  await new Promise(r => setTimeout(r, 300))

  // Start the AI program
  const startCommand = resolveStartCommand(options.program)
  await runtime.sendKeys(sessionName, `unset CLAUDECODE; ${startCommand}`, { literal: true, enter: true })

  console.log(`[Spawner] Agent ${options.name} started in tmux session ${sessionName}`)

  return {
    id: agentId,
    name: options.name,
    program: options.program,
    sessionName,
    workingDirectory: cwd,
    hostId,
  }
}

/**
 * Kill a local agent's tmux session
 */
export async function killLocalAgent(sessionName: string): Promise<void> {
  const runtime = getRuntime()
  try {
    // Try graceful exit first
    await runtime.sendKeys(sessionName, 'C-c', { enter: false })
    await new Promise(r => setTimeout(r, 500))
    await runtime.sendKeys(sessionName, '"exit"', { enter: true })
    await new Promise(r => setTimeout(r, 500))
    await runtime.killSession(sessionName)
  } catch {
    // Session may already be gone
    try { await runtime.killSession(sessionName) } catch { /* ok */ }
  }
}

/**
 * Spawn a remote agent via Maestro API on another machine
 */
export async function spawnRemoteAgent(
  hostUrl: string,
  agentName: string,
  program: string,
  cwd: string,
  taskDescription?: string,
  teamName?: string,
): Promise<{ id: string }> {
  // Create agent on remote host (15s timeout)
  const createCtrl = new AbortController()
  const createTimer = setTimeout(() => createCtrl.abort(), 15000)
  let createRes: Response
  try {
    createRes = await fetch(`${hostUrl}/api/agents`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({
        name: agentName,
        program,
        workingDirectory: cwd,
        taskDescription,
        team: teamName,
      }),
      signal: createCtrl.signal,
    })
  } finally {
    clearTimeout(createTimer)
  }

  if (!createRes.ok) {
    const body = await createRes.text()
    throw new Error(`Remote agent create failed: ${createRes.status} ${body}`)
  }

  const { agent } = await createRes.json()

  // Wake agent on remote host (15s timeout)
  const wakeCtrl = new AbortController()
  const wakeTimer = setTimeout(() => wakeCtrl.abort(), 15000)
  try {
    const wakeRes = await fetch(`${hostUrl}/api/agents/${agent.id}/wake`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ startProgram: true, sessionIndex: 0 }),
      signal: wakeCtrl.signal,
    })
    if (!wakeRes.ok) {
      const body = await wakeRes.text()
      throw new Error(`Remote agent wake failed: ${wakeRes.status} ${body}`)
    }
  } finally {
    clearTimeout(wakeTimer)
  }

  return { id: agent.id }
}

/**
 * Kill a remote agent via Maestro API
 */
export async function killRemoteAgent(hostUrl: string, agentId: string): Promise<void> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    await fetch(`${hostUrl}/api/agents/${agentId}`, {
      method: 'DELETE',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ killSession: true }),
      signal: ctrl.signal,
    })
  } catch { /* non-fatal */ }
  finally { clearTimeout(timer) }
}

/**
 * Send command to a remote agent's session
 */
export async function postRemoteSessionCommand(
  hostUrl: string,
  sessionName: string,
  command: string,
): Promise<void> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 10000)
  try {
    const response = await fetch(`${hostUrl}/api/sessions/${encodeURIComponent(sessionName)}/command`, {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ command, requireIdle: false, addNewline: true }),
      signal: ctrl.signal,
    })
    if (!response.ok) {
      const body = await response.text()
      throw new Error(`Remote session command failed: ${response.status} ${body}`)
    }
  } finally {
    clearTimeout(timer)
  }
}

/**
 * Check if a remote session exists and is ready
 */
export async function isRemoteSessionReady(hostUrl: string, sessionName: string): Promise<boolean> {
  const ctrl = new AbortController()
  const timer = setTimeout(() => ctrl.abort(), 5000)
  try {
    const response = await fetch(`${hostUrl}/api/sessions/${encodeURIComponent(sessionName)}/command`, {
      method: 'GET',
      headers: { Accept: 'application/json' },
      cache: 'no-store',
      signal: ctrl.signal,
    })
    if (!response.ok) return false
    const body = await response.json().catch(() => null)
    return Boolean(body?.exists)
  } catch {
    return false
  } finally {
    clearTimeout(timer)
  }
}
