/**
 * Agent Config Loader — reads agents.json and provides lookup helpers.
 * Single source of truth for agent-specific behavior across spawner, ensemble, and monitor.
 */

import fs from 'fs'
import path from 'path'
import { fileURLToPath } from 'url'
import type { AgentProgram, AgentsConfig } from '../types/agent-program'

const __dirname = path.dirname(fileURLToPath(import.meta.url))

let _cache: AgentsConfig | null = null

/** Load agents.json from repo root (cached after first read) */
export function loadAgentsConfig(): AgentsConfig {
  if (_cache) return _cache

  const configPath = process.env['ENSEMBLE_AGENTS_CONFIG']
    || path.join(__dirname, '..', 'agents.json')

  const raw = fs.readFileSync(configPath, 'utf-8')
  _cache = JSON.parse(raw) as AgentsConfig
  return _cache
}

/** Clear cached config (useful for tests) */
export function clearAgentsConfigCache(): void {
  _cache = null
}

/**
 * Resolve a program string (e.g. "codex", "claude code", "claude-code") to its AgentProgram config.
 * Falls back to "claude" if no match found.
 */
export function resolveAgentProgram(program: string): AgentProgram {
  const config = loadAgentsConfig()
  const p = program.toLowerCase()

  // Direct key match
  if (config[p]) return config[p]

  // Substring match (e.g. "claude code" matches "claude")
  for (const [key, agent] of Object.entries(config)) {
    if (p.includes(key)) return agent
  }

  // Default to claude
  return config['claude'] || {
    name: program,
    command: program.toLowerCase(),
    flags: [],
    readyMarker: '❯',
    inputMethod: 'sendKeys' as const,
    color: 'white',
    icon: '○',
  }
}

/**
 * Build the full CLI command for an agent, including env-level flags.
 */
export function buildAgentCommand(program: string): string {
  const agent = resolveAgentProgram(program)
  const envFlags = (process.env['ENSEMBLE_AGENT_FLAGS'] ?? '').trim()
  const allowPermissive = process.env['ENSEMBLE_ALLOW_PERMISSIVE_FLAGS'] === 'true'

  const envTokens = envFlags ? envFlags.split(/\s+/).filter(Boolean) : []
  const envFlagKeys = new Set(envTokens.filter(token => token.startsWith('-')))

  const activeFlags = [...agent.flags]
  if (allowPermissive && agent.permissiveFlags) {
    activeFlags.push(...agent.permissiveFlags)
  }

  const defaultTokens: string[] = []

  for (let i = 0; i < activeFlags.length; i++) {
    const token = activeFlags[i]
    if (!token.startsWith('-')) {
      defaultTokens.push(token)
      continue
    }
    if (envFlagKeys.has(token)) {
      if (i + 1 < activeFlags.length && !activeFlags[i + 1].startsWith('-')) i++
      continue
    }
    defaultTokens.push(token)
    if (i + 1 < activeFlags.length && !activeFlags[i + 1].startsWith('-')) {
      defaultTokens.push(activeFlags[++i])
    }
  }

  return [agent.command, envFlags, defaultTokens.join(' ')].filter(Boolean).join(' ')
}
