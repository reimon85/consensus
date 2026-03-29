import { describe, expect, it, beforeEach } from 'vitest'
import { buildAgentCommand, clearAgentsConfigCache } from '../lib/agent-config'
import fs from 'fs'
import path from 'path'

describe('agent-config', () => {
  beforeEach(() => {
    delete process.env.ENSEMBLE_ALLOW_PERMISSIVE_FLAGS
    delete process.env.ENSEMBLE_AGENT_FLAGS
    clearAgentsConfigCache()
  })

  it('builds command without permissive flags by default', () => {
    const cmd = buildAgentCommand('claude')
    expect(cmd).toBe('claude')
  })

  it('builds command with permissive flags when enabled', () => {
    process.env.ENSEMBLE_ALLOW_PERMISSIVE_FLAGS = 'true'
    const cmd = buildAgentCommand('claude')
    expect(cmd).toBe('claude --permission-mode bypassPermissions')
  })

  it('builds command with ENSEMBLE_AGENT_FLAGS', () => {
    process.env.ENSEMBLE_AGENT_FLAGS = '--model gpt-4'
    const cmd = buildAgentCommand('claude')
    expect(cmd).toBe('claude --model gpt-4')
  })

  it('handles gemini yolo flag correctly', () => {
    const cmdDefault = buildAgentCommand('gemini')
    expect(cmdDefault).toBe('gemini')

    process.env.ENSEMBLE_ALLOW_PERMISSIVE_FLAGS = 'true'
    clearAgentsConfigCache()
    const cmdPermissive = buildAgentCommand('gemini')
    expect(cmdPermissive).toBe('gemini --yolo')
  })
})
