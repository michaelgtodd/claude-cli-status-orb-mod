// A Cylon-style scanner under the prompt. While Claude works, a red orb sweeps
// the full width; when it goes idle the orb slows into the center, turns blue,
// and pulses. The motion lives in scanner.ts; this module draws it into the
// hint line under the prompt (keeping the engine's own hint below it) and
// repaints it every frame with $.ui.blit.

import type { Register } from 'claude-code'

import { FRAME_MS, createScanner, renderCells, stepScanner } from './scanner.ts'

const KEY = 'scanner'
const MAX_COLUMNS = 512 // a Raster's limit
const HINT_INDENT = 2

export const register: Register = on => {
  const scanner = createScanner()
  let working = false
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
      stepScanner(scanner, dt, working, columns)
      // A blit that misses (not mounted yet, mid-resize) is simply skipped.
      $.ui.blit({ requestId, key: KEY, cells: encode(renderCells(scanner, columns)) }).catch(() => {})
    })
    return result
  })

  // The hint line knows whether a turn is running; the turn events cover the
  // moments between its redraws.
  on('turn.start', ($, e, next) => {
    working = true
    return next(e)
  })
  on('turn.complete', ($, e, next) => {
    working = false
    return next(e)
  })
  on('turn.abort', ($, e, next) => {
    working = false
    return next(e)
  })

  on('ui.render', { component: 'PromptHint' }, async ($, e, next) => {
    working = e.props.isWorking
    const hint = await next(e)
    if (e.surface !== 'terminal') return hint

    // The hint row is indented two columns; a wider Raster is clipped at the right.
    const columns = Math.max(1, Math.min(MAX_COLUMNS, (e.viewport?.columns ?? 80) - HINT_INDENT))
    site = { requestId: e.requestId, columns }
    const { Box, Raster } = $.ui.resolve(e)
    return (
      <Box flexDirection="column">
        <Raster key={KEY} columns={columns} rows={1} cells={encode(renderCells(scanner, columns))} />
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
