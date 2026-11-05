// A Cylon-style scanner under the prompt. While Claude works, a red orb sweeps
// the full width; when it goes idle the orb slows into the center, turns blue,
// and pulses. Claude counts as working during a turn and for as long as a
// background shell, subagent or workflow is still going. The motion lives in
// scanner.ts; this module draws it into the hint line under the prompt (keeping
// the engine's own hint below it) and repaints it every frame with $.ui.blit.

import type { AgentInfo, Register } from 'claude-code'

import { FRAME_MS, createScanner, renderCells, stepScanner } from './scanner.ts'

const KEY = 'scanner'
const RULER = 'ruler'
const MAX_COLUMNS = 512 // a Raster's limit
const HINT_INDENT = 2 // the hint row's inset, on each side
/** How often to read the session's agents: a change of status raises no event. */
const AGENT_POLL_MS = 500
/**
 * The hint line's pill for background shells: `1 shell`, `2 shells, 1 monitor`,
 * or `3 background tasks` beside another kind of task. A mod gets no list of
 * shells and the pill is the only live signal. Should its wording change, shells
 * stop counting and the orb rests as it would have without this.
 */
const SHELL_PILL = /\b\d+ (?:shells?|background tasks?)\b/

/** True while the hint line's text shows a background shell running. */
export const hasRunningShell = (hint: string): boolean => SHELL_PILL.test(hint)

/** True while an agent has work left. `idle` is a teammate awaiting a message. */
export const hasActiveAgent = (agents: readonly Pick<AgentInfo, 'status'>[]): boolean =>
  agents.some(({ status }) => status === 'pending' || status === 'running' || status === 'waiting')

export const register: Register = on => {
  const scanner = createScanner()
  let working = false // a turn of the main loop is running
  let shellRunning = false
  let agentActive = false
  let workflowRunning = false
  let rowColumns: number | undefined // the hint row's width, once ruler.ts measures it
  let site: { requestId: string; columns: number } | undefined
  let last = Date.now()

  on('session.start', async ($, e, next) => {
    const result = await next(e)
    $.clock.every(FRAME_MS, () => {
      const now = Date.now()
      const dt = (now - last) / 1000
      last = now
      if (!site) return
      const { requestId, columns } = site
      stepScanner(scanner, dt, working || shellRunning || agentActive || workflowRunning, columns)
      // A blit that misses (not mounted yet, mid-resize) is simply skipped.
      $.ui.blit({ requestId, key: KEY, cells: encode(renderCells(scanner, columns)) }).catch(() => {})
    })
    $.clock.every(AGENT_POLL_MS, () => {
      $.agent.list().then(agents => {
        agentActive = hasActiveAgent(agents)
      }).catch(() => {})
    })
    return result
  })

  // The hint line knows whether a turn is running; the turn events cover the
  // moments between its redraws. Subagents raise these too, for turns of their
  // own, and one ending says nothing about the main loop's.
  on('turn.start', ($, e, next) => {
    if (!e.agentId) working = true
    return next(e)
  })
  on('turn.complete', ($, e, next) => {
    if (!e.agentId) working = false
    return next(e)
  })
  on('turn.abort', ($, e, next) => {
    working = false
    return next(e)
  })

  // A workflow's agents are in no list and no pill. Each turn's end reports the
  // work still in flight, and a workflow ending wakes the session for a turn
  // that reports again.
  on('classic.Stop', ($, e, next) => {
    workflowRunning = (e.background_tasks ?? []).some(task => task.type === 'workflow')
    return next(e)
  })

  on('ui.message', ($, e, next) => {
    if (e.element === RULER && typeof e.data === 'number' && e.data > 0 && e.data !== rowColumns) {
      rowColumns = e.data
      $.ui.invalidate('ui.render')
    }
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    working = e.props.isWorking
    shellRunning = hasRunningShell(e.props.hint)
    const hint = await next(e)
    if (e.surface !== 'terminal') return hint

    // From the row's left inset to the screen's right edge. Until the ruler answers,
    // the viewport stands in, which is short while a pane is docked. A wider Raster
    // is clipped at the right.
    const room = rowColumns === undefined ? (e.viewport?.columns ?? 80) - HINT_INDENT : rowColumns + HINT_INDENT
    const columns = Math.max(1, Math.min(MAX_COLUMNS, room))
    site = { requestId: e.requestId, columns }
    const { Box, Client, Raster } = $.ui.resolve(e)
    // The Raster stands outside the flow, so its width can't change what the ruler reads.
    return (
      <Box flexDirection="column">
        <Box flexDirection="row">
          <Client key={RULER} module="./ruler.ts" flexGrow={1} height={1} />
          <Box position="absolute">
            <Raster key={KEY} columns={columns} rows={1} cells={encode(renderCells(scanner, columns))} />
          </Box>
        </Box>
        {hint}
      </Box>
    )
  })
}

const ALPHABET = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789+/'

/** Raster cells as standard padded base64 of their little-endian u32 words. */
function encode(cells: Uint32Array): string {
  const bytes = new Uint8Array(cells.buffer, cells.byteOffset, cells.byteLength)
  let out = ''
  for (let i = 0; i < bytes.length; i += 3) {
    const [a, b, c] = [bytes[i]!, bytes[i + 1], bytes[i + 2]]
    const n = (a << 16) | ((b ?? 0) << 8) | (c ?? 0)
    out += ALPHABET[(n >> 18) & 63]! + ALPHABET[(n >> 12) & 63]!
    out += b === undefined ? '=' : ALPHABET[(n >> 6) & 63]!
    out += c === undefined ? '=' : ALPHABET[n & 63]!
  }
  return out
}
