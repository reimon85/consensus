/**
 * MessageBus — Central EventEmitter for all in-process event communication.
 *
 * Replaces setInterval polling with event-driven architecture.
 *
 * Events:
 *   'message'       - New chat message received (from any agent)
 *   'agent:ready'   - Agent tmux pane is ready for input
 *   'agent:blocked' - Agent is blocked on a Y/N prompt
 *   'agent:nudged'   - Watchdog nudged an idle agent
 *   'agent:stalled'  - Agent marked as stalled after nudge
 *   'team:created'   - New team created
 *   'team:disbanded' - Team disbanded
 *   'phase:advance' - Staged workflow phase advanced
 */

import { EventEmitter } from 'events'
import type { EnsembleMessage } from '../types/ensemble'
import type { AgentEvent, TeamEvent, PhaseEvent } from '../types/messages'

class MessageBusImpl extends EventEmitter {
  constructor() {
    super()
    // Allow infinite listeners for high-frequency message events
    this.setMaxListeners(Infinity)
  }

  // Emit a new chat message
  emitMessage(message: EnsembleMessage): void {
    this.emit('message', message)
  }

  // Subscribe to chat messages
  onMessage(handler: (message: EnsembleMessage) => void): void {
    this.on('message', handler)
  }

  // Emit agent status change
  emitAgentEvent(event: AgentEvent): void {
    this.emit(`agent:${event.type}`, event)
    this.emit('agent:*', event)
  }

  // Subscribe to specific agent event
  onAgentEvent(
    eventType: AgentEvent['type'],
    handler: (event: AgentEvent) => void
  ): void {
    this.on(`agent:${eventType}`, handler)
  }

  // Subscribe to all agent events
  onAnyAgentEvent(handler: (event: AgentEvent) => void): void {
    this.on('agent:*', handler)
  }

  // Emit team lifecycle event
  emitTeamEvent(event: TeamEvent): void {
    this.emit(`team:${event.type}`, event)
    this.emit('team:*', event)
  }

  onTeamEvent(
    eventType: TeamEvent['type'],
    handler: (event: TeamEvent) => void
  ): void {
    this.on(`team:${eventType}`, handler)
  }

  // Emit phase transition
  emitPhaseEvent(event: PhaseEvent): void {
    this.emit('phase:advance', event)
    this.emit('phase:*', event)
  }

  onPhaseEvent(handler: (event: PhaseEvent) => void): void {
    this.on('phase:*', handler)
  }

  // Utility: track last message time per agent for idle detection
  private lastMessageTimes = new Map<string, string>() // key: `${teamId}:${agentName}`

  recordMessage(teamId: string, agentName: string): void {
    const key = `${teamId}:${agentName}`
    this.lastMessageTimes.set(key, new Date().toISOString())
  }

  getLastMessageTime(teamId: string, agentName: string): string | undefined {
    return this.lastMessageTimes.get(`${teamId}:${agentName}`)
  }

  getIdleMs(teamId: string, agentName: string): number {
    const lastTime = this.getLastMessageTime(teamId, agentName)
    if (!lastTime) return Infinity
    return Date.now() - new Date(lastTime).getTime()
  }
}

// Singleton instance
export const messageBus = new MessageBusImpl()

// Helper to create agent event objects
export function createAgentEvent(
  type: AgentEvent['type'],
  teamId: string,
  agentName: string,
  details?: AgentEvent['details']
): AgentEvent {
  return {
    type,
    teamId,
    agentName,
    timestamp: new Date().toISOString(),
    details,
  }
}

// Helper to create team event objects
export function createTeamEvent(
  type: TeamEvent['type'],
  teamId: string,
  data?: Record<string, unknown>
): TeamEvent {
  return {
    type,
    teamId,
    timestamp: new Date().toISOString(),
    data,
  }
}

// Helper to create phase event objects
export function createPhaseEvent(
  teamId: string,
  phase: PhaseEvent['phase'],
  type: PhaseEvent['type'],
  details?: PhaseEvent['details']
): PhaseEvent {
  return {
    type,
    teamId,
    phase,
    timestamp: new Date().toISOString(),
    details,
  }
}
