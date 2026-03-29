/**
 * Message types for ZeroMQ pub/sub communication.
 */

export interface TeamMessage {
  type: 'team' | 'direct' | 'system'
  teamId: string
  from: string
  to: string
  content: string
  timestamp: string
  id: string
}

export interface AgentEvent {
  type: 'ready' | 'blocked' | 'stalled' | 'idle' | 'nudged'
  teamId: string
  agentName: string
  timestamp: string
  details?: {
    blockedPrompt?: string
    response?: string
    idleMs?: number
  }
}

export interface TeamEvent {
  type: 'created' | 'disbanded' | 'active' | 'paused'
  teamId: string
  timestamp: string
  data?: Record<string, unknown>
}

export interface PhaseEvent {
  type: 'phase_advance' | 'phase_complete' | 'phase_timeout'
  teamId: string
  phase: 'plan' | 'exec' | 'verify'
  timestamp: string
  details?: {
    nextPhase?: 'plan' | 'exec' | 'verify'
    reason?: string
  }
}

// Topic prefixes for ZMQ pub/sub
export const TOPIC_PREFIX = {
  TEAM: 'team',
  AGENT: 'agent',
  EVENTS: 'events',
  PHASE: 'phase',
} as const

export function teamTopic(teamId: string): string {
  return `${TOPIC_PREFIX.TEAM}.${teamId}`
}

export function agentTopic(teamId: string, agentName: string): string {
  return `${TOPIC_PREFIX.AGENT}.${teamId}.${agentName}`
}

export function eventsTopic(teamId: string): string {
  return `${TOPIC_PREFIX.EVENTS}.${teamId}`
}

export function phaseTopic(teamId: string): string {
  return `${TOPIC_PREFIX.PHASE}.${teamId}`
}
