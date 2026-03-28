export interface EnsembleTeam {
  id: string
  name: string
  description: string
  status: 'forming' | 'active' | 'paused' | 'completed' | 'disbanded' | 'failed'
  agents: EnsembleTeamAgent[]
  createdBy: string
  createdAt: string
  completedAt?: string
  feedMode: 'silent' | 'summary' | 'live'
  result?: EnsembleTeamResult
}

export interface EnsembleTeamAgent {
  agentId: string
  name: string
  program: string
  role: string
  hostId: string
  status: 'spawning' | 'active' | 'idle' | 'done' | 'failed'
  worktreePath?: string
  worktreeBranch?: string
}

export interface EnsembleTeamResult {
  summary: string
  decisions: string[]
  discoveries: string[]
  filesChanged: string[]
  duration: number
}

export type MessageType = 'chat' | 'decision' | 'question' | 'result' | 'completion_signal' | 'heartbeat' | 'phase_ack' | 'progress'

export interface EnsembleMessage {
  id: string
  teamId: string
  from: string
  to: string
  content: string
  type: MessageType
  timestamp: string
  options?: string[]
}

export interface CreateTeamRequest {
  name: string
  description: string
  agents: Array<{
    program: string
    role?: string
    hostId?: string
  }>
  feedMode?: 'silent' | 'summary' | 'live'
  workingDirectory?: string
  templateName?: string
  useWorktrees?: boolean
  staged?: boolean
  stagedConfig?: StagedWorkflowConfig
}

export interface ValidationResult {
  valid: boolean
  errors: string[]
}

export function validateCreateTeamRequest(req: unknown): ValidationResult {
  const errors: string[] = []
  if (!req || typeof req !== 'object') {
    return { valid: false, errors: ['Request must be an object'] }
  }
  const r = req as Record<string, unknown>

  if (!r.name || typeof r.name !== 'string' || r.name.trim().length === 0) {
    errors.push('name is required and must be a non-empty string')
  }
  if (!r.description || typeof r.description !== 'string') {
    errors.push('description is required and must be a string')
  }
  if (!r.agents || !Array.isArray(r.agents) || r.agents.length < 1) {
    errors.push('agents must be a non-empty array')
  } else {
    r.agents.forEach((a: unknown, i: number) => {
      if (!a || typeof a !== 'object') {
        errors.push(`agents[${i}] must be an object`)
        return
      }
      const ag = a as Record<string, unknown>
      if (!ag.program || typeof ag.program !== 'string') {
        errors.push(`agents[${i}].program is required and must be a string`)
      }
      if (ag.role !== undefined && typeof ag.role !== 'string') {
        errors.push(`agents[${i}].role must be a string`)
      }
      if (ag.hostId !== undefined && typeof ag.hostId !== 'string') {
        errors.push(`agents[${i}].hostId must be a string`)
      }
    })
  }

  if (r.feedMode !== undefined && !['silent', 'summary', 'live'].includes(r.feedMode as string)) {
    errors.push('feedMode must be one of: silent, summary, live')
  }
  if (r.workingDirectory !== undefined && typeof r.workingDirectory !== 'string') {
    errors.push('workingDirectory must be a string')
  }
  if (r.staged !== undefined && typeof r.staged !== 'boolean') {
    errors.push('staged must be a boolean')
  }

  return { valid: errors.length === 0, errors }
}

export type StagedPhase = 'plan' | 'exec' | 'verify'

export interface StagedWorkflowConfig {
  planTimeoutMs?: number   // Max time for PLAN phase before auto-advancing (default: 120000 = 2min)
  execTimeoutMs?: number   // Max time for EXEC phase before auto-advancing (default: 300000 = 5min)
  verifyTimeoutMs?: number // Max time for VERIFY phase before completing (default: 120000 = 2min)
  pollIntervalMs?: number  // How often to check for phase completion (default: 5000 = 5s)
  minSessionDurationMs?: number // Minimum session duration before auto-disband can trigger (default: 300000 = 5min)
}

export interface CollabTemplateRole {
  role: string
  focus: string
}

export interface CollabTemplate {
  name: string
  description: string
  suggestedTaskPrefix: string
  roles: CollabTemplateRole[]
}

export interface CollabTemplatesFile {
  templates: Record<string, CollabTemplate>
}
