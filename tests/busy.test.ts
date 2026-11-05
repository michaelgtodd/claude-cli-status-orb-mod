import { expect, test } from 'claude-code/testing'

import { hasActiveAgent, hasRunningShell } from '../hooks/register'

test('a background shell in the hint line counts as running', () => {
  expect(hasRunningShell('1 shell · ↓ to manage')).toBe(true)
  expect(hasRunningShell('2 shells · esc to interrupt · ↓ to manage')).toBe(true)
  expect(hasRunningShell('1 shell, 1 monitor · ↓ to manage')).toBe(true)
  expect(hasRunningShell('1 shell · /tasks to see subagents · ↓ to manage')).toBe(true)
  // A shell beside another kind of task, which shares one pill with it.
  expect(hasRunningShell('2 background tasks · ↓ to manage')).toBe(true)
})

test('a hint line without one does not', () => {
  expect(hasRunningShell('(shift+tab to cycle)')).toBe(false)
  expect(hasRunningShell('(shift+tab to cycle) · /tasks to see subagents')).toBe(false)
  expect(hasRunningShell('esc to interrupt')).toBe(false)
  expect(hasRunningShell('1 monitor · ↓ to manage')).toBe(false)
})

test('an agent with work left counts as active', () => {
  expect(hasActiveAgent([{ status: 'pending' }])).toBe(true)
  expect(hasActiveAgent([{ status: 'running' }])).toBe(true)
  expect(hasActiveAgent([{ status: 'waiting' }])).toBe(true)
  expect(hasActiveAgent([{ status: 'completed' }, { status: 'running' }])).toBe(true)
})

test('one that has ended or awaits a message does not', () => {
  expect(hasActiveAgent([])).toBe(false)
  expect(hasActiveAgent([{ status: 'idle' }])).toBe(false)
  expect(hasActiveAgent([{ status: 'completed' }, { status: 'failed' }, { status: 'killed' }])).toBe(false)
})
